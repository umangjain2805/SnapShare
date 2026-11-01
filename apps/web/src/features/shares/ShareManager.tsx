import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createShareSchema, type ShareView, type UploadView, type SnippetView } from '@snapshare/contracts';
import { resourceApi } from '../../lib/resource-api';
import { Button } from '../../components/ui/button';
type SharePage = { shares: ShareView[]; nextCursor: string | null };
export function ShareManager({ ownerId }: { ownerId: string }) {
  const cache = useQueryClient(); const [before, setBefore] = useState<string>();
  const uploads = useQuery({ queryKey: ['uploads', ownerId], queryFn: () => resourceApi<{ uploads: UploadView[] }>('/uploads') });
  const snippets = useQuery({ queryKey: ['snippets', ownerId], queryFn: () => resourceApi<{ snippets: SnippetView[] }>('/snippets') });
  const shares = useQuery({ queryKey: ['shares', ownerId, before], queryFn: () => resourceApi<SharePage>(`/me/shares${before ? `?before=${before}` : ''}`) });
  const [source, setSource] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [url, setUrl] = useState(''); const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setUrl('');
    try {
      const [sourceType, sourceId] = source.split(':'); const parsed = createShareSchema.safeParse({ sourceType, sourceId, password });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Choose an item and enter a password');
      const result = await resourceApi<{ share: { url: string } }>('/shares', parsed.data);
      setUrl(result.share.url); setPassword(''); setBefore(undefined); await cache.invalidateQueries({ queryKey: ['shares', ownerId] });
    } catch (error) { setError(error instanceof Error ? error.message : 'Share creation failed'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError(''); setMessage('');
    try { await resourceApi(`/me/shares/${id}`, {}, 'DELETE'); await cache.invalidateQueries({ queryKey: ['shares', ownerId] }); setMessage('Share revoked. New transfers are blocked.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Revocation failed'); }
    finally { setBusy(false); }
  }
  return <section className="asset-panel share-panel" aria-labelledby="shares-heading"><span className="eyebrow">ONE MOMENT. ONE CLAIM.</span><h2 id="shares-heading">Create a secure share</h2><p className="muted">Expires in 24 hours. One claim. Password required. A failed download still consumes the claim.</p>
    <form className="snippet-form" onSubmit={event => void submit(event)}>
      <label htmlFor="share-source">Item to share</label><select id="share-source" value={source} required onChange={event => setSource(event.target.value)}><option value="">Choose a private item</option>{uploads.data?.uploads.filter(u => u.status === 'quarantined' && u.scanStatus === 'clean').map(u => <option key={u.id} value={`upload:${u.id}`}>File: {u.filename}</option>)}{snippets.data?.snippets.map(s => <option key={s.id} value={`snippet:${s.id}`}>Snippet: {s.title}</option>)}</select>
      <p className="hint">Files awaiting a trusted malware scan cannot be shared.</p>
      {(uploads.isError || snippets.isError) && <p role="alert">Could not load your items. <button type="button" onClick={() => { void uploads.refetch(); void snippets.refetch(); }}>Retry</button></p>}
      <label>Share password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/></label><p className="hint">At least 12 characters. Send the password separately from the link. Notifications are enabled for this share; delivery is not available yet.</p>
      <Button disabled={busy || uploads.isPending || snippets.isPending} type="submit">{busy ? 'Please wait...' : 'Create share'}</Button>
    </form>
    {url && <div className="created-share"><label>New share link<input readOnly value={url} onFocus={event => event.currentTarget.select()}/></label><p>Save this link now. It cannot be recovered after leaving this page.</p><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(url).then(() => setMessage('Share link copied.'), () => setError('Copy failed. Select and copy the link above.')); }}>Copy share link</Button></div>}
    {error && <p role="alert" className="error">{error}</p>}<p role="status">{message}</p>
    <h3>My shares</h3>{shares.isPending && <p>Loading shares...</p>}{shares.error && <p role="alert">{shares.error.message} <button onClick={() => void shares.refetch()}>Retry</button></p>}{shares.data?.shares.length === 0 && <p className="muted">No shares yet.</p>}
    <ul className="asset-list">{shares.data?.shares.map(share => <li key={share.id}><div><strong>{share.title}</strong><small>{share.status} · {share.downloadCount} / {share.maxDownloads} claims · Expires {new Date(share.expiresAt).toLocaleString()}</small></div>{share.status !== 'revoked' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(share.id)}>Revoke {share.title}</Button>}</li>)}</ul>
    <div className="upload-actions">{before && <Button size="sm" variant="outline" onClick={() => setBefore(undefined)}>Newest shares</Button>}{shares.data?.nextCursor && <Button size="sm" variant="outline" onClick={() => setBefore(shares.data!.nextCursor!)}>Older shares</Button>}</div>
  </section>;
}
