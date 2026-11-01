import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../../apps/api/src/infrastructure/database.js';
import { User, Session } from '../../apps/api/src/modules/auth/model.js';
import { UploadSession, Snippet, AssetQuota } from '../../apps/api/src/modules/assets/model.js';
import { startStorage } from '../helpers/storage.js';

const storage = await startStorage();
let mongo: MongoMemoryReplSet | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let api: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), Session.init(), UploadSession.init(), Snippet.init(), AssetQuota.init()]);
  const env = parseEnv({ NODE_ENV: 'test', APP_URL: 'http://localhost:5173', MONGODB_URI: mongo.getUri(), LOG_LEVEL: 'silent', S3_ENDPOINT: storage.endpoint, S3_BUCKET: storage.bucket, S3_ACCESS_KEY_ID: storage.credentials.accessKeyId, S3_SECRET_ACCESS_KEY: storage.credentials.secretAccessKey });
  api = createApp(env).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => api!.once('listening', resolve));
  const address = api.address(); if (!address || typeof address === 'string') throw new Error('API did not bind');
  vite = await createServer({ root: 'apps/web', server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': `http://127.0.0.1:${address.port}` } } });
  await vite.listen();
  browser = await chromium.launch({ channel: process.env.CHROMIUM_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173/signup');
  await page.getByLabel('Full name').fill('Phase Two'); await page.getByLabel('Email address').fill('workspace@example.com');
  await page.getByLabel('Password', { exact: true }).fill('browser-workspace-passphrase'); await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Upload a file' })).toBeVisible();
  let interrupt = true; const requests = new Map<number, number>();
  await page.route(`${storage.endpoint}/**`, async route => {
    const number = Number(new URL(route.request().url()).searchParams.get('partNumber'));
    if (route.request().method() === 'PUT' && number) {
      requests.set(number, (requests.get(number) ?? 0) + 1);
      if (number === 2 && interrupt) { interrupt = false; await route.abort('internetdisconnected'); return; }
    }
    await route.continue();
  });
  const buffer = Buffer.alloc(17 * 1024 * 1024 + 7, 'a');
  const file = { name: 'resumable.txt', mimeType: 'text/plain', buffer };
  await page.locator('#upload-file').setInputFiles(file); await page.getByRole('button', { name: 'Upload file', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Network interrupted', { timeout: 30000 });
  await page.reload();
  await page.getByRole('button', { name: 'Resume resumable.txt', exact: true }).click();
  await page.locator('#upload-file').setInputFiles({ ...file, buffer: Buffer.alloc(buffer.length, 'b') });
  await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different file');
  await page.locator('#upload-file').setInputFiles(file); await page.getByRole('button', { name: 'Resume upload', exact: true }).click();
  await expect(page.getByText('Uploaded privately. Awaiting malware scanning; sharing is unavailable.', { exact: true })).toBeVisible({ timeout: 30000 });
  expect(requests.get(1)).toBe(1); expect(requests.get(2)).toBe(2); expect(requests.get(3)).toBe(1);
  const record = await UploadSession.findOne(); expect(record!.status).toBe('quarantined');
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: record!.objectKey }));
  const actual = await result.Body!.transformToByteArray();
  expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(buffer).digest('hex'));
  expect((await fetch(`${storage.endpoint}/${storage.bucket}/${record!.objectKey}`)).status).toBe(403);
  const malicious = '<script>window.snapSharePwned=true</script><img src=x onerror="window.snapSharePwned=true">';
  await page.getByLabel('Snippet title', { exact: true }).fill('Safe HTML example'); await page.getByLabel('Language', { exact: true }).selectOption('markup');
  await page.getByLabel('Code', { exact: true }).fill(malicious); await page.getByRole('button', { name: 'Save snippet', exact: true }).click();
  await expect(page.getByText('Snippet saved privately.', { exact: true })).toBeVisible();
  await page.reload(); await page.getByText('Safe HTML example · markup', { exact: true }).click();
  await expect(page.locator('details .code-preview')).toHaveText(malicious);
  expect(await page.locator('.code-preview script, .code-preview img').count()).toBe(0);
  expect(await page.evaluate(() => 'snapSharePwned' in window)).toBe(false);
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-results/workspace-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
  process.stdout.write('Workspace browser passed: real HTTP multipart upload, interruption, reload, file identity, skipped existing part, private object, byte verification, inert snippet, mobile layout.\n');
} finally {
  await browser?.close(); await vite?.close();
  if (api) await new Promise<void>(resolve => api!.close(() => resolve()));
  await disconnectDatabase(); await mongo?.stop(); storage.client.destroy(); await storage.stop();
}
