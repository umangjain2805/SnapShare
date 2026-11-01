import type { Env } from '@snapshare/backend/env';
export interface EmailProvider {
  send(input: { idempotencyKey: string; to: string; subject: string; text: string }): Promise<void>;
}
export function createEmailProvider(env: Env): EmailProvider | undefined {
  if (env.EMAIL_PROVIDER === 'disabled') return;
  return { async send(input) {
    const result = await fetch(env.EMAIL_WEBHOOK_URL!, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.EMAIL_WEBHOOK_TOKEN}`, 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(input) });
    await result.body?.cancel();
    if (!result.ok) throw new Error('Email provider rejected delivery');
  } };
}
