import { useState } from 'react';
import { api } from '../api.js';
import { ErrorNote, Icon } from '../ui.jsx';
import { go } from '../nav.js';

function Hero() {
  return (
    <div className="auth-hero">
      <div className="falling-leaves" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ '--i': i }}><Icon name="leaf" size={22 + i * 4} /></span>)}
      </div>
      <h1>Catch the leaf!</h1>
      <p>First to catch a falling leaf wins.</p>
    </div>
  );
}

// Opened from the emailed link: #/reset/<token>
export function ResetPassword({ token, onSignedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const d = await api('/auth/reset', { method: 'POST', json: { token, new_password: password } });
      go('/');
      onSignedIn(d.token, d.user);
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="auth">
      <Hero />
      <form className="auth-form" onSubmit={submit}>
        <h2>Choose a new password</h2>
        <label>New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </label>
        <ErrorNote error={error} />
        <button className="button">Save and log in</button>
      </form>
    </div>
  );
}

export function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('signup'); // signup | login | forgot
  const [form, setForm] = useState({ username: '', alias: '', email: '', password: '', login: '' });
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const switchTo = (m) => { setMode(m); setError(''); setSent(false); };

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'signup') {
        if (Boolean(form.email) !== Boolean(form.password)) throw new Error('Fill in both email and password, or leave both empty');
        const d = await api('/auth/signup', { method: 'POST', json: { username: form.username, alias: form.alias, email: form.email, password: form.password } });
        onSignedIn(d.token, d.user);
      } else if (mode === 'login') {
        const d = await api('/auth/login', { method: 'POST', json: { login: form.login, password: form.password } });
        onSignedIn(d.token, d.user);
      } else {
        await api('/auth/forgot', { method: 'POST', json: { email: form.email } });
        setSent(true);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <Hero />
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label>Username
              <input value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={24} />
            </label>
            <label>Alias <span className="hint">(optional, shown instead of your username)</span>
              <input value={form.alias} onChange={set('alias')} maxLength={40} />
            </label>
            <details className="optional-creds">
              <summary>Email and password <span className="hint">(optional)</span></summary>
              <p className="muted small">Add both to log in on other devices and to reset your password. Without them, your account lives on this phone only. You can add them later in Settings.</p>
              <label>Email
                <input type="email" value={form.email} onChange={set('email')} autoComplete="email" />
              </label>
              <label>Password <span className="hint">(8+ characters)</span>
                <input type="password" value={form.password} onChange={set('password')} minLength={8} autoComplete="new-password" />
              </label>
            </details>
          </>
        )}
        {mode === 'login' && (
          <>
            <label>Username or email
              <input value={form.login} onChange={set('login')} autoComplete="username" autoCapitalize="none" required />
            </label>
            <label>Password
              <input type="password" value={form.password} onChange={set('password')} required autoComplete="current-password" />
            </label>
          </>
        )}
        {mode === 'forgot' && (
          sent ? <p className="notice">If an account uses that email, a reset link is on its way. It works for one hour.</p> : (
            <label>Your account's email
              <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
            </label>
          )
        )}
        <ErrorNote error={error} />
        {!(mode === 'forgot' && sent) && (
          <button className="button" disabled={busy}>{{ signup: 'Start catching', login: 'Log in', forgot: 'Email me a reset link' }[mode]}</button>
        )}
      </form>
      <div className="auth-switch">
        {mode !== 'login' && <button className="link" onClick={() => switchTo('login')}>I have an account</button>}
        {mode !== 'signup' && <button className="link" onClick={() => switchTo('signup')}>Create an account</button>}
        {mode === 'login' && <button className="link" onClick={() => switchTo('forgot')}>Forgot password?</button>}
      </div>
    </div>
  );
}
