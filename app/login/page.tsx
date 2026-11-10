'use client';
import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [canSignup, setCanSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setCanSignup(!!d.signupOpen)).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Something went wrong. Try again.'); setBusy(false); return; }
      window.location.href = '/';
    } catch {
      setError('Cannot reach the server. Check your internet connection.');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card login-card">
        <div className="card-body">
          <div className="brand"><span className="brand-mark" /><span>Sunmount<small>360</small></span></div>
          <h1>{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
          <p className="muted lead">
            {mode === 'login' ? 'Use the email and password of your Sunmount360 account.' : 'You need the sign-up code from the owner of this app.'}
          </p>
          {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
          {mode === 'signup' && <div style={{ marginBottom: 10 }}><label className="small">Your name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>}
          <div style={{ marginBottom: 10 }}><label className="small">Email</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
          <div style={{ marginBottom: 10 }}><label className="small">Password{mode === 'signup' ? ' (at least 10 characters)' : ''}</label><input className="input" type="password" required minLength={mode === 'signup' ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>
          {mode === 'signup' && <div style={{ marginBottom: 10 }}><label className="small">Sign-up code</label><input className="input" required value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          {canSignup && (
            <p className="small switch-mode">
              {mode === 'login'
                ? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setError(''); }}>Create an account</a>
                : <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(''); }}>I already have an account</a>}
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
