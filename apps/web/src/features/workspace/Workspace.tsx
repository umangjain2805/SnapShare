import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism-tomorrow.css';
import { languages, snippetInputSchema, uploadInputSchema, MAX_FILE_SIZE, type UploadView, type SnippetView } from '@snapshare/contracts';
import { Button } from '../../components/ui/button';
import { resourceApi as workspaceApi } from '../../lib/resource-api';
function tokens(nodes: (string | Prism.Token)[]): ReactNode {
  return nodes.map((node, i) => typeof node === 'string' ? node : <span key={i} className={`token ${node.type}`}>{typeof node.content === 'string' ? node.content : tokens(Array.isArray(node.content) ? node.content : [node.content])}</span>);
}
function Preview({ text, language }: { text: string; language: string }) {
  if (!text) return null;
  // Token strings become React text nodes. Never insert user-controlled HTML.
  return <pre className="code-preview" tabIndex={0} aria-label="Snippet preview"><code>{tokens(Prism.tokenize(text, Prism.languages[language] ?? Prism.languages.plain!))}</code></pre>;
}
const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MiB`;
export function Workspace({ ownerId }: { ownerId: string }) {
  const cache = useQueryClient();
  const uploads = useQuery({ queryKey: ['uploads', ownerId], queryFn: () => workspaceApi<{ uploads: UploadView[] }>('/uploads') });
  const snippets = useQuery({ queryKey: ['snippets', ownerId], queryFn: () => workspaceApi<{ snippets: SnippetView[] }>('/snippets') });
  const [file, setFile] = useState<File>(); const [selected, setSelected] = useState<UploadView>();
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [text, setText] = useState(''); const [title, setTitle] = useState(''); const [language, setLanguage] = useState<(typeof languages)[number]>('javascript');
  const [saving, setSaving] = useState(false); const [snippetError, setSnippetError] = useState(''); const [saved, setSaved] = useState('');
  const paused = useRef(false); const xhr = useRef<XMLHttpRequest | null>(null);
  useEffect(() => () => { paused.current = true; xhr.current?.abort(); }, []);
  const refresh = () => cache.invalidateQueries({ queryKey: ['uploads', ownerId] });
  async function upload() {
    if (!file) { setError('Select a file first.'); return; }
    setBusy(true); setError(''); setMessage('Checking file identity…'); paused.current = false;
    try {
      if (file.size < 1 || file.size > MAX_FILE_SIZE) throw new Error('Choose a file between 1 byte and 256 MiB.');
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
      if (paused.current) throw new Error('Paused. Select Resume upload to continue.');
      let upload = selected;
      if (!upload) {
        const input = uploadInputSchema.parse({ filename: file.name, size: file.size, mimeType: file.type || 'application/octet-stream', fingerprint });
        upload = (await workspaceApi<{ upload: UploadView }>('/uploads/initiate', input)).upload;
        setSelected(upload); await refresh();
      }
      if (upload.size !== file.size || upload.fingerprint !== fingerprint) throw new Error('This is a different file. Reselect the original file to resume.');
      upload = (await workspaceApi<{ upload: UploadView }>(`/uploads/${upload.id}`)).upload;
      if (upload.status === 'quarantined' || upload.status === 'completing') {
        await workspaceApi(`/uploads/${upload.id}/complete`, {});
      } else {
        let done = 0; const partCount = Math.ceil(file.size / upload.partSize);
        for (let partNumber = 1; partNumber <= partCount; partNumber++) {
          if (paused.current) throw new Error('Paused. Select Resume upload to continue.');
          const start = (partNumber - 1) * upload.partSize; const blob = file.slice(start, start + upload.partSize);
          if (!upload.parts.some(p => p.partNumber === partNumber && p.size === blob.size)) {
            setMessage(`Uploading part ${partNumber} of ${partCount}…`);
            const { url } = await workspaceApi<{ url: string }>(`/uploads/${upload.id}/parts`, { partNumber });
            if (paused.current) throw new Error('Paused. Select Resume upload to continue.');
            const completed = done;
            await new Promise<void>((resolve, reject) => {
              const request = new XMLHttpRequest(); xhr.current = request; request.open('PUT', url); request.timeout = 120000;
              request.upload.onprogress = event => setProgress(Math.round((completed + event.loaded) / file.size * 100));
              request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Part upload failed. Resume to retry.'));
              request.onerror = request.ontimeout = () => reject(new Error('Network interrupted. Resume when connected.'));
              request.onabort = () => reject(new Error('Paused. Select Resume upload to continue.'));
              request.send(blob);
            });
          }
          done += blob.size; setProgress(Math.round(done / file.size * 100));
        }
        if (paused.current) throw new Error('Paused. Select Resume upload to continue.');
        setMessage('Verifying completed file…'); await workspaceApi(`/uploads/${upload.id}/complete`, {});
      }
      setMessage('Uploaded privately. Awaiting malware scanning; sharing is unavailable.'); setSelected(undefined); setFile(undefined); setProgress(100); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Upload failed'); setMessage(''); await refresh(); }
    finally { setBusy(false); xhr.current = null; }
  }
  async function abort(upload: UploadView) {
    setBusy(true); setError('');
    try { await workspaceApi(`/uploads/${upload.id}`, {}, 'DELETE'); if (selected?.id === upload.id) { setSelected(undefined); setProgress(0); } await refresh(); setMessage('Upload aborted. Reserved quota released.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Abort failed'); }
    finally { setBusy(false); }
  }
  async function saveSnippet(event: FormEvent) {
    event.preventDefault(); setSaving(true); setSnippetError(''); setSaved('');
    try { const input = snippetInputSchema.parse({ title, language, text }); await workspaceApi('/snippets', input); await cache.invalidateQueries({ queryKey: ['snippets', ownerId] }); setSaved('Snippet saved privately.'); }
    catch (error) { setSnippetError(error instanceof Error ? error.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  return <div className="workspace-tools">
    <section className="asset-panel" aria-labelledby="upload-heading"><span className="eyebrow">PRIVATE FILES</span><h2 id="upload-heading">Upload a file</h2><p className="muted">PDF, PNG, JPEG, plain text or ZIP · Up to 256 MiB. Workspace limit: 1 GiB and 100 files/snippets.</p>
      <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) { setFile(event.dataTransfer.files[0]); setError(''); } }}>
        <label htmlFor="upload-file">{selected ? `Reselect the original file: ${selected.filename}` : 'Drop a file here or choose a file'}</label>
        <input id="upload-file" type="file" disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.txt,.zip" onChange={event => { setFile(event.target.files?.[0]); setError(''); }}/>
        {file && <p>{file.name} · {sizeLabel(file.size)}</p>}
      </div>
      <div className="upload-actions"><Button disabled={busy || !file} onClick={() => void upload()}>{selected ? 'Resume upload' : 'Upload file'}</Button>{busy && <Button variant="outline" onClick={() => { paused.current = true; xhr.current?.abort(); }}>Pause upload</Button>}{selected && !busy && <Button variant="outline" onClick={() => { setSelected(undefined); setProgress(0); }}>Start another file</Button>}</div>
      {(busy || progress > 0) && <progress max={100} value={progress} aria-label="Upload progress"/>}<p role="status">{message || (busy ? `${progress}% uploaded` : '')}</p>{error && <p role="alert" className="error">{error}</p>}
      <h3>Your files</h3>{uploads.isPending && <p>Loading files…</p>}{uploads.error && <p role="alert">{uploads.error.message} <button onClick={() => void uploads.refetch()}>Retry</button></p>}{uploads.data?.uploads.length === 0 && <p className="muted">Your first private upload will appear here.</p>}
      <ul className="asset-list">{uploads.data?.uploads.map(upload => <li key={upload.id}><div><strong>{upload.filename}</strong><small>{sizeLabel(upload.size)} · {upload.status === 'quarantined' ? (upload.scanStatus === 'clean' ? 'Ready to share' : upload.scanStatus === 'rejected' ? 'Scan rejected' : 'Awaiting scan') : upload.status} · {upload.status === 'quarantined' ? 'Private' : `Session expires ${new Date(upload.expiresAt).toLocaleString()}`}</small></div><div className="upload-actions">{['uploading', 'completing'].includes(upload.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setSelected(upload); setFile(undefined); setMessage('Choose the original file, then resume.'); setProgress(0); }}>Resume {upload.filename}</Button>}{['uploading', 'aborting'].includes(upload.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void abort(upload)}>Abort {upload.filename}</Button>}</div></li>)}</ul>
    </section>
    <section className="asset-panel" aria-labelledby="snippet-heading"><span className="eyebrow">A HOME FOR YOUR CODE</span><h2 id="snippet-heading">Create a snippet</h2>
      <form className="snippet-form" onSubmit={event => void saveSnippet(event)}><label>Snippet title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)}/></label><label>Language<select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value as typeof language)}>{languages.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Code<textarea required maxLength={32768} spellCheck={false} value={text} onChange={event => setText(event.target.value)}/></label><p className="hint">{new TextEncoder().encode(text).length} / 32768 bytes. Text is displayed safely and never executed.</p><Preview text={text} language={language}/><Button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save snippet'}</Button>{snippetError && <p role="alert" className="error">{snippetError}</p>}<p role="status">{saved}</p></form>
      <h3>Your snippets</h3>{snippets.isPending && <p>Loading snippets…</p>}{snippets.error && <p role="alert">{snippets.error.message} <button onClick={() => void snippets.refetch()}>Retry</button></p>}{snippets.data?.snippets.length === 0 && <p className="muted">No snippets yet.</p>}{snippets.data?.snippets.map(snippet => <details className="saved-snippet" key={snippet.id}><summary>{snippet.title} · {snippet.language}</summary><Preview text={snippet.text} language={snippet.language}/><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(snippet.text).then(() => setSaved('Snippet copied.'), () => setSnippetError('Copy failed. Select text in the preview to copy.')); }}>Copy snippet</Button></details>)}
    </section>
  </div>;
}
