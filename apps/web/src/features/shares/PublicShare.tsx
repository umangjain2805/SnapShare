import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { opaqueTokenSchema, type ClaimView } from '@snapshare/contracts';
import { resourceApi } from '../../lib/resource-api';
import { Button } from '../../components/ui/button';
function claimKey(token: string) {
  const key = `snapshare-claim:${token}`;
  try { const existing = sessionStorage.getItem(key); if (opaqueTokenSchema.safeParse(existing).success) return existing!; } catch { /* Memory fallback when storage is unavailable. */ }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { sessionStorage.setItem(key, value); } catch { /* Reload recovery is unavailable with blocked storage. */ }
  return value;
}
function ShareContent({ token }: { token: string }) {
  const valid = opaqueTokenSchema.safeParse(token).success;
  const metadata = useQuery({ queryKey: ['public-share', token], queryFn: () => resourceApi(`/shares/${token}`), enabled: valid, retry: false });
  const [key] = useState(() => claimKey(token)); const [password, setPassword] = useState('');
  const [claim, setClaim] = useState<ClaimView>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [started, setStarted] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { setClaim(await resourceApi<ClaimView>(`/shares/${token}/claim`, { password, idempotencyKey: key })); setPassword(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not claim this share. Retry with the same password.'); }
    finally { setBusy(false); }
  }
  return <main className="public-share"><Link className="brand" to="/">SnapShare</Link><section className="asset-panel"><span className="eyebrow">PRIVATE BY DESIGN</span><h1>A moment, shared with you.</h1><p className="muted">One claim. A required password. Access ends when the link expires.</p>
    {!valid ? <p role="alert" className="error">This link is invalid.</p> : metadata.isPending ? <p role="status">Opening share...</p> : metadata.error ? <p role="alert">{metadata.error.message} <button onClick={() => void metadata.refetch()}>Try again</button></p> : claim ? <div className="claimed-share"><h2>{claim.filename}</h2><p>{claim.size.toLocaleString()} bytes · Claimed</p><p>Start your download before {new Date(claim.startBefore).toLocaleTimeString()}. This download can be started once. Interrupted or failed downloads cannot be restarted.</p>{!started ? <Button asChild><a href={`/api/transfers/${claim.ticket}`} onClick={() => setStarted(true)} referrerPolicy="no-referrer">Download once</a></Button> : <p role="status">Download requested. Your browser handles the file. A claim does not guarantee that it was saved.</p>}<p className="hint">If the request never reached the server, reload and enter the same password before the start deadline to recover your download. Downloads that already started remain consumed.</p></div> : <form className="snippet-form" onSubmit={event => void submit(event)}><label>Share password<input type="password" required maxLength={128} autoComplete="off" value={password} onChange={event => setPassword(event.target.value)}/></label><p className="hint">Claiming reserves the only transfer. Files and code are downloaded as attachments.</p><Button disabled={busy} type="submit">{busy ? 'Authorizing...' : 'Claim share'}</Button></form>}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="share-footnote">Link details stay private until the password is accepted. If authorization is interrupted, retry here with the same password.</p>
  </section></main>;
}
export function PublicShare() {
  const { token = '' } = useParams();
  return <ShareContent key={token} token={token}/>;
}
