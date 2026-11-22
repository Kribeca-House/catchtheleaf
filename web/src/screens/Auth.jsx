import { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Icon } from '../ui.jsx';

export function RecoveryCode({ code, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="recovery">
      <h2>Keep this recovery code</h2>
      <p>We don't ask for your email, so this code is the only way back in if you forget your password. Screenshot it or save it in your password manager.</p>
      <code className="recovery-code">{code}</code>
      <button className="button secondary" onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true))}>
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <button className="button" onClick={onDone}>I've saved it</button>
    </div>
  );
}

export function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('login'); // login | signup | recover
  const [form, setForm] = useState({ username: '', password: '', alias: '', recovery_code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // signed in, waiting for the recovery code to be saved

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'login') {
        const d = await api('/auth/login', { method: 'POST', json: { username: form.username, password: form.password } });
        onSignedIn(d.token, d.user);
      } else if (mode === 'signup') {
        const d = await api('/auth/signup', { method: 'POST', json: { username: form.username, password: form.password, alias: form.alias } });
        setPending(d);
      } else {
        const d = await api('/auth/recover', { method: 'POST', json: { username: form.username, recovery_code: form.recovery_code, new_password: form.password } });
        setPending(d);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (pending) {
    return <div className="auth"><RecoveryCode code={pending.recovery_code} onDone={() => onSignedIn(pending.token, pending.user)} /></div>;
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="falling-leaves" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ '--i': i }}><Icon name="leaf" size={22 + i * 4} /></span>)}
        </div>
        <h1>Catch the leaf!</h1>
        <p>First to catch a falling leaf wins.</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label>Username
          <input value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={24} />
        </label>
        {mode === 'signup' && (
          <label>Alias <span className="hint">(optional, shown instead of your username)</span>
            <input value={form.alias} onChange={set('alias')} maxLength={40} />
          </label>
        )}
        {mode === 'recover' && (
          <label>Recovery code
            <input value={form.recovery_code} onChange={set('recovery_code')} placeholder="LEAF-XXXX-XXXX-XXXX" autoCapitalize="characters" required />
          </label>
        )}
        <label>{mode === 'recover' ? 'New password' : 'Password'}
          <input type="password" value={form.password} onChange={set('password')} minLength={mode === 'login' ? 1 : 8} required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        <ErrorNote error={error} />
        <button className="button" disabled={busy}>
          {{ login: 'Log in', signup: 'Create account', recover: 'Set new password' }[mode]}
        </button>
      </form>
      <div className="auth-switch">
        {mode !== 'login' && <button className="link" onClick={() => { setMode('login'); setError(''); }}>I have an account</button>}
        {mode !== 'signup' && <button className="link" onClick={() => { setMode('signup'); setError(''); }}>Create an account</button>}
        {mode === 'login' && <button className="link" onClick={() => { setMode('recover'); setError(''); }}>Forgot password?</button>}
      </div>
    </div>
  );
}
