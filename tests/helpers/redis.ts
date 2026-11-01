import { spawn } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
export async function startRedis(requestedPort?: number) {
  const reservation = createServer(); reservation.listen(requestedPort ?? 0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { reservation.once('listening', resolve); reservation.once('error', reject); });
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Redis port unavailable');
  const port = address.port; await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.env.REDIS_SERVER_PATH ?? 'redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no', '--protected-mode', 'yes'], { windowsHide: true, stdio: 'ignore' });
  let spawnError = false; child.on('error', () => { spawnError = true; });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await done;
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError || child.exitCode !== null) throw new Error('Set REDIS_SERVER_PATH to a Redis 6.2+ executable, or install redis-server in PATH');
      const ready = await new Promise<boolean>(resolve => {
        const socket = createConnection({ host: '127.0.0.1', port });
        const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
        socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n')); socket.once('data', data => finish(data.toString().startsWith('+PONG')));
        socket.once('error', () => finish(false)); socket.setTimeout(500, () => finish(false));
      });
      if (ready) return { port, url: `redis://127.0.0.1:${port}`, stop };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Redis test server startup timed out');
  } catch (error) { await stop(); throw error; }
}
