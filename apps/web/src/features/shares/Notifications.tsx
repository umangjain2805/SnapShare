import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceApi } from '../../lib/resource-api';
import { Button } from '../../components/ui/button';
type Notice = { id: string; message: string; createdAt: string; readAt: string | null; emailStatus: string };
export function Notifications({ ownerId }: { ownerId: string }) {
  const cache = useQueryClient(); const [error, setError] = useState(''); const [before, setBefore] = useState<string>();
  const result = useQuery({ queryKey: ['notifications', ownerId, before], queryFn: () => resourceApi<{ notifications: Notice[]; unreadCount: number; nextCursor: string | null }>(`/me/notifications${before ? `?before=${before}` : ''}`), refetchInterval: 15000 });
  async function read(id: string) { setError(''); try { await resourceApi(`/me/notifications/${id}/read`, {}); await cache.invalidateQueries({ queryKey: ['notifications', ownerId] }); } catch { setError('Could not mark notification read.'); } }
  return <section className="asset-panel share-panel"><h2>Notifications</h2><p className="muted">{result.data?.unreadCount ?? 0} unread. Claim notifications do not confirm that a download was saved.</p>{result.isPending && <p>Loading notifications...</p>}{(result.isError || error) && <p role="alert">{error || 'Could not load notifications.'}<button onClick={() => void result.refetch()}>Retry</button></p>}{result.data?.notifications.length === 0 && <p>No notifications yet.</p>}<ul className="asset-list">{result.data?.notifications.map(n => <li key={n.id}><div><strong>{n.message}</strong><small>{new Date(n.createdAt).toLocaleString()} · {n.emailStatus === 'disabled' ? 'In-app only' : `Email: ${n.emailStatus}`}</small></div>{!n.readAt && <Button variant="outline" size="sm" onClick={() => void read(n.id)}>Mark read</Button>}</li>)}</ul><div className="upload-actions">{before && <Button size="sm" variant="outline" onClick={() => setBefore(undefined)}>Newest notifications</Button>}{result.data?.nextCursor && <Button size="sm" variant="outline" onClick={() => setBefore(result.data!.nextCursor!)}>Older notifications</Button>}</div></section>;
}
