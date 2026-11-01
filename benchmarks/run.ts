import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import argon2 from 'argon2';
import { startStorage } from '../tests/helpers/storage.js';
import { connectDatabase, disconnectDatabase } from '../packages/backend/dist/database.js';
import { initializeModels } from '../packages/backend/dist/initialize.js';
import { User, Session, Share, UploadSession, TransferTicket, AssetQuota } from '../packages/backend/dist/index.js';
import { parseEnv } from '../packages/backend/dist/env.js';
import { createApp } from '../apps/api/src/app.js';
import { hashToken, createAuthService } from '../apps/api/src/modules/auth/service.js';
import { baselineAnalytics } from './baseline.js';
import { readAnalytics } from '../apps/api/src/modules/analytics/repository.js';
const opaque = () => randomBytes(32).toString('base64url');
const storage = await startStorage(); let mongo: MongoMemoryReplSet | undefined; let server: ReturnType<typeof createServer> | undefined;
try {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await connectDatabase(mongo.getUri()); await initializeModels();
  const user = await User.create({ name: 'Benchmark', email: 'benchmark@example.com', passwordHash: 'fixture' }); const ownerId = user.id as string;
  const session = opaque(); await Session.create({ userId: user._id, tokenHash: hashToken(session), expiresAt: new Date(Date.now() + 86400000) });
  const cookie = `snapshare_session=${session}`; const origin = 'http://localhost:5173'; const password = 'benchmark-share-password';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  const payload = Buffer.alloc(1048576, 'b'); const sha256 = createHash('sha256').update(payload).digest('hex'); const key = 'quarantine/benchmark/file';
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: payload, ContentType: 'text/plain', ACL: 'bucket-owner-full-control' }));
  const upload = await UploadSession.create({ ownerId, filename: 'benchmark.txt', size: payload.length, mimeType: 'text/plain', fingerprint: sha256, objectKey: key, status: 'quarantined', scanStatus: 'clean', expiresAt: new Date(Date.now() + 86400000) });
  await AssetQuota.create({ _id: ownerId, bytes: payload.length, items: 1 });
  const input = () => ({ ownerId, sourceType: 'upload', sourceId: upload.id as string, title: 'benchmark.txt', tokenHash: hashToken(opaque()), passwordHash, expiresAt: new Date(Date.now() + 86400000) });
  const records = await Share.insertMany(Array.from({ length: 400 }, (_, i) => ({ ...input(), status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'claimed' : 'revoked', downloadCount: i % 3 === 1 ? 1 : 0 })));
  await Share.insertMany(Array.from({ length: 1600 }, () => ({ ...input(), ownerId: 'another-owner' })));
  await TransferTicket.insertMany(records.filter(s => s.status === 'claimed').map((s, i) => ({ shareId: s.id as string, claimHash: hashToken(opaque()), tokenHash: hashToken(opaque()), status: 'redeemed', startBefore: new Date(Date.now() + 120000), delivery: i % 2 === 0 ? 'finished' : 'failed' })));
  const claims: { token: string; key: string }[] = []; const tickets: string[] = [];
  for (let i = 0; i < 10; i++) {
    const token = opaque(); await Share.create({ ...input(), tokenHash: hashToken(token) }); claims.push({ token, key: opaque() });
    const raw = opaque(); const share = await Share.create({ ...input(), status: 'claimed', downloadCount: 1 }); tickets.push(raw);
    await TransferTicket.create({ shareId: share.id as string, claimHash: hashToken(opaque()), tokenHash: hashToken(raw), startBefore: new Date(Date.now() + 120000) });
  }
  const baseline = await baselineAnalytics(ownerId, 7); const optimized = await readAnalytics(ownerId, 7); assert.deepEqual({ ...optimized, sampledAt: '' }, { ...baseline, sampledAt: '' });
  const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), APP_URL: origin, LOG_LEVEL: 'silent', S3_ENDPOINT: storage.endpoint, S3_BUCKET: storage.bucket, S3_ACCESS_KEY_ID: storage.credentials.accessKeyId, S3_SECRET_ACCESS_KEY: storage.credentials.secretAccessKey });
  const app = createApp(env); const auth = createAuthService(7);
  // A loopback fixture-only route allows an equivalent uncached baseline without shipping a production switch.
  server = createServer((req, res) => {
    if (req.url !== '/bench/analytics-baseline') { app(req, res); return; }
    void (async () => { const raw = req.headers.cookie?.split('snapshare_session=')[1]?.split(';')[0]; const current = await auth.current(raw); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(await baselineAnalytics(current.id, 7))); })().catch(() => { res.statusCode = 500; res.end('{}'); });
  });
  server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  await mkdir('test-results/benchmarks', { recursive: true }); const directory = resolve('test-results/benchmarks');
  const fixture = { url: `http://127.0.0.1:${address.port}`, cookie, origin, password, lookup: claims[0]!.token, claims, tickets, size: payload.length, sha256 };
  const fixturePath = resolve(directory, 'fixture.json'); await writeFile(fixturePath, JSON.stringify(fixture));
  // Warm both code paths; the cache freshness tradeoff is included explicitly in the report.
  await fetch(`${fixture.url}/api/me/analytics`, { headers: { Cookie: cookie } }); await baselineAnalytics(ownerId, 7);
  const runs: { operation: string; round: number; metrics: unknown }[] = [];
  for (const [index, operation] of ['analytics-baseline', 'analytics-optimized', 'analytics-baseline', 'analytics-optimized', 'initiate', 'lookup', 'claim', 'download'].entries()) {
    const output = resolve(directory, `summary-${index}.json`);
    await new Promise<void>((resolve, reject) => { const child = spawn(process.env.K6_PATH ?? 'k6', ['run', '--quiet', 'benchmarks/api.k6.js'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, K6_NO_USAGE_REPORT: 'true', BENCH_FIXTURE: fixturePath, BENCH_OPERATION: operation, BENCH_OUTPUT: output } }); let error = ''; child.stderr.on('data', chunk => { error += String(chunk).slice(0, 2000); }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`k6 ${operation} failed: ${error}`))); });
    const summary = JSON.parse(await readFile(output, 'utf8')) as { metrics: unknown }; runs.push({ operation, round: index, metrics: summary.metrics });
    process.stdout.write(`Measured ${operation}.\n`);
  }
  const k6Version = await new Promise<string>((resolve, reject) => { const child = spawn(process.env.K6_PATH ?? 'k6', ['version'], { windowsHide: true }); let version = ''; child.stdout.on('data', data => { version += String(data); }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve(version.trim()) : reject(new Error('Could not read k6 version'))); });
  const mongoInfo = await Share.db.db!.admin().command({ buildInfo: 1 });
  const report = { measuredAt: new Date().toISOString(), environment: { node: process.version, k6: k6Version, platform: platform(), os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: Math.round(totalmem() / 1073741824), mongo: `${mongoInfo.version} isolated replica set`, storage: 'Moto 5.2.5 on loopback', network: 'same-host loopback', dataset: '420 owner shares + 1600 foreign shares, 143 tickets, 1 MiB file', virtualUsers: 2, analytics: 'two runs of 20 requests per candidate; cached optimized endpoint vs uncached projected-document JavaScript baseline; equal outputs verified before measurement' }, runs };
  await writeFile(resolve('docs/performance-results.json'), JSON.stringify(report, null, 2));
  process.stdout.write('Measured results saved to docs/performance-results.json; credentials and raw URLs remain only in ignored test-results.\n');
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); await disconnectDatabase(); await mongo?.stop(); storage.client.destroy(); await storage.stop(); }
