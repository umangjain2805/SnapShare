import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Check, LockKeyhole, LogOut, ShieldCheck, Zap } from 'lucide-react';
import { loginSchema, registerSchema } from '@snapshare/contracts';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { useSession } from '../features/auth/use-session';
import { Workspace } from '../features/workspace/Workspace';
import { ShareManager } from '../features/shares/ShareManager';
import { Notifications } from '../features/shares/Notifications';
import { PublicShare } from '../features/shares/PublicShare';

function Brand() { return <Link to="/" className="brand"><span className="brand-icon"><Zap size={22} fill="currentColor" /></span>SnapShare<span className="brand-tag">workspace</span></Link>; }
function Status({ error, retry }: { error?: boolean; retry?: () => void }) {
  return <div className="status" role={error ? 'alert' : 'status'}>{error ? <><p>We couldn?t connect to your workspace.</p><Button variant="outline" onClick={retry}>Try again</Button></> : 'Opening your workspace?'}</div>;
}
function AuthPage({ signup = false }: { signup?: boolean }) {
  const session = useSession();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [validation, setValidation] = useState('');
  const mutation = useMutation({ mutationFn: (body: unknown) => api(signup ? '/auth/register' : '/auth/login', body), onSuccess: result => { cache.setQueryData(['session'], result?.user); navigate('/dashboard', { replace: true }); } });
  if (session.isPending) return <Status />;
  if (session.isError) return <Status error retry={() => void session.refetch()} />;
  if (session.data) return <Navigate to="/dashboard" replace />;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = (signup ? registerSchema : loginSchema).safeParse(data);
    if (!parsed.success) { setValidation(parsed.error.issues[0]?.message ?? 'Check your details'); return; }
    mutation.mutate(parsed.data);
  }
  return <div className="auth-layout">
    <aside className="auth-story"><Brand /><div className="story-copy"><span className="eyebrow">A LITTLE LESS PERMANENT.</span><h1>Share a moment.<br />Keep control.</h1><p>A dedicated home for temporary files and code. Your secure workspace starts here.</p><div className="story-card"><ShieldCheck size={28}/><div><strong>Built with privacy in mind</strong><p>Password-protected account access and private sessions.</p></div></div></div><span className="story-footer">SMALL MOMENTS. THOUGHTFULLY SHARED.</span></aside>
    <main className="auth-main"><div className="mobile-brand"><Brand /></div><div className="auth-box"><span className="pill"><LockKeyhole size={14}/> YOUR PRIVATE WORKSPACE</span><h2>{signup ? 'Make yourself at home.' : 'Welcome back.'}</h2><p className="muted">{signup ? 'Create an account to get your workspace ready.' : 'Sign in to pick up where you left off.'}</p>
    <form onSubmit={submit} className="auth-form">
      {signup && <label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="Alex Morgan" /></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" /></label>
      <label>Password<input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 12 : 1} maxLength={128} required aria-describedby={signup ? 'password-help' : undefined} placeholder={signup ? 'At least 12 characters' : 'Enter your password'} /></label>
      {signup && <p id="password-help" className="hint">Use at least 12 characters. A long, unique passphrase works well.</p>}
      {(validation || mutation.error) && <p role="alert" className="error">{validation || mutation.error?.message}</p>}
      <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Please wait?' : signup ? 'Create account' : 'Sign in'}<ArrowUpRight size={17}/></Button>
    </form><p className="switch">{signup ? 'Already have an account?' : 'New to SnapShare?'} <Link to={signup ? '/signin' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p><div className="auth-note"><ShieldCheck size={16}/><span>Your account keeps your workspace private.</span></div></div><footer className="auth-footer">Thoughtful sharing. Built one step at a time.</footer></main>
  </div>;
}
function Dashboard() {
  const session = useSession(); const cache = useQueryClient(); const navigate = useNavigate();
  const logout = useMutation({ mutationFn: () => api('/auth/logout', {}), onSuccess: () => { cache.clear(); navigate('/signin', { replace: true }); } });
  if (session.isPending) return <Status />;
  if (session.isError) return <Status error retry={() => void session.refetch()} />;
  if (!session.data) return <Navigate to="/signin" replace />;
  return <div className="dashboard"><header className="topbar"><Brand /><div className="account"><span className="account-email">{session.data.email}</span><Button variant="outline" size="sm" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut size={15}/>{logout.isPending ? 'Signing out?' : 'Sign out'}</Button></div></header><main className="workspace"><div className="workspace-label"><span className="dot"/> YOUR WORKSPACE</div><div className="welcome"><div><h1>Hello, {session.data.name.split(' ')[0]}.</h1><p className="muted">A fresh space for the things you?ll share.</p></div><span className="pill"><Check size={14}/> ACCOUNT READY</span></div>{logout.error && <p className="error" role="alert">{logout.error.message}</p>}
  <Workspace ownerId={session.data.id} /><ShareManager ownerId={session.data.id} /><Notifications ownerId={session.data.id} /><div className="foundation-note"><ShieldCheck size={20}/><p><strong>A space of your own.</strong> Your workspace is private and protected by your account.</p></div></main><footer className="dashboard-footer">SnapShare <span>Small moments. Thoughtfully shared.</span></footer></div>;
}
export function App() { return <Routes><Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/signin" element={<AuthPage key="signin"/>}/><Route path="/signup" element={<AuthPage key="signup" signup/>}/><Route path="/dashboard" element={<Dashboard/>}/><Route path="/s/:token" element={<PublicShare/>}/><Route path="*" element={<main className="status"><h1>Page not found</h1><Link to="/">Return to your workspace</Link></main>}/></Routes>; }
