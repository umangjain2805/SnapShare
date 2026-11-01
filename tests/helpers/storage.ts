import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
export async function startStorage() {
  const socket = createServer(); socket.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => socket.once('listening', resolve));
  const address = socket.address(); if (!address || typeof address === 'string') throw new Error('Port unavailable');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(process.env.PYTHON ?? 'python', ['-m', 'moto.server', '-H', '127.0.0.1', '-p', String(port)], { windowsHide: true, stdio: 'ignore' });
  let startupError: Error | undefined; child.on('error', error => { startupError = error; });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited;
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (startupError || child.exitCode !== null) throw new Error('Install the test S3 emulator: python -m pip install -r tests/requirements-storage.txt');
      try { const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* Waiting for the child to bind. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('Test S3 emulator startup timed out');
    const credentials = { accessKeyId: 'local-test', secretAccessKey: 'local-test' };
    const bucket = 'snapshare-browser-test';
    const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
    await new Promise<void>((resolve, reject) => {
      const setup = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/scripts/setup-storage.ts'], { windowsHide: true, stdio: 'ignore', env: {
        ...process.env, NODE_ENV: 'test', APP_URL: 'http://localhost:5173', MONGODB_URI: 'mongodb://localhost/test',
        S3_REGION: 'us-east-1', S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_ACCESS_KEY_ID: credentials.accessKeyId, S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      } });
      setup.once('error', reject); setup.once('exit', code => code === 0 ? resolve() : reject(new Error('Local storage setup failed')));
    });
    return { endpoint, bucket, client, stop, credentials };
  } catch (error) { await stop(); throw error; }
}
