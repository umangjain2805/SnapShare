import { useQuery } from '@tanstack/react-query';
import type { ShareDetail } from '@snapshare/contracts';
import { resourceApi } from '../../lib/resource-api';
import { Button } from '../../components/ui/button';
export function ShareDetails({ id, ownerId, close }: { id: string; ownerId: string; close: () => void }) {
  const query = useQuery({ queryKey: ['share-detail', ownerId, id], queryFn: () => resourceApi<{ share: ShareDetail }>(`/me/shares/${id}`), refetchInterval: 15000 });
  const share = query.data?.share;
  return <section className="share-details" aria-label="Share details"><div className="panel-heading"><h3>Share details</h3><Button size="sm" variant="outline" onClick={close}>Close details</Button></div>{query.isPending && <p role="status">Loading share details...</p>}{query.error && <p role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>}{share && <><h4>{share.title}</h4><dl><div><dt>Status</dt><dd>{share.status}</dd></div><div><dt>Created</dt><dd>{new Date(share.createdAt).toLocaleString()}</dd></div><div><dt>Expires</dt><dd>{new Date(share.expiresAt).toLocaleString()}</dd></div><div><dt>Claims</dt><dd>{share.downloadCount} / {share.maxDownloads}</dd></div><div><dt>Cleanup</dt><dd>{share.cleanupStatus}</dd></div><div><dt>Claim notifications</dt><dd>{share.notificationsEnabled ? 'Enabled' : 'Disabled'}</dd></div><div><dt>Transfer</dt><dd>{share.transfer ? `${share.transfer.status} · ${share.transfer.delivery}` : 'No transfer claimed'}</dd></div></dl><p className="hint">A claimed share stays consumed if delivery fails. Finished means the API streamed bytes; it does not confirm that the recipient saved them.</p></>}</section>;
}
