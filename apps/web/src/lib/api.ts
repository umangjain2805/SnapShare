import { publicUserSchema, type PublicUser } from '@snapshare/contracts';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api(path: string, body?: unknown): Promise<{ user: PublicUser } | undefined> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'Request failed');
  return { user: publicUserSchema.parse(data.user) };
}
