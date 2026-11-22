import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { resizeToJpeg } from '../cutout.js';
import { Avatar, ErrorNote, TopBar } from '../ui.jsx';

export function Settings() {
  const { user, setUser, signOut } = useSession();
  const [alias, setAlias] = useState(user.alias || '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [creds, setCreds] = useState({ email: user.email || '', current_password: '', new_password: '' });
  const fileRef = useRef(null);

  const done = (m) => { setMsg(m); setError(''); setTimeout(() => setMsg(''), 2500); };
  const oops = (e) => { setError(e.message); setMsg(''); };
  const setC = (k) => (e) => setCreds({ ...creds, [k]: e.target.value });

  async function saveProfile(patch) {
    try { const d = await api('/me', { method: 'PATCH', json: patch }); setUser(d.user); done('Saved'); } catch (e) { oops(e); }
  }
  async function onAvatar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const form = new FormData();
      form.append('avatar', await resizeToJpeg(f, 400, 0.85, true), 'avatar.jpg');
      const d = await api('/me/avatar', { method: 'POST', form });
      setUser({ ...user, avatar: d.avatar }); done('New profile picture');
    } catch (err) { oops(err); }
  }
  async function saveCredentials(e) {
    e.preventDefault();
    try {
      const d = await api('/me/credentials', { method: 'PUT', json: creds });
      setUser(d.user);
      setCreds({ email: d.user.email || '', current_password: '', new_password: '' });
      done(user.has_password ? 'Saved' : 'Email and password added');
    } catch (err) { oops(err); }
  }
  async function deleteAccount() {
    let current_password;
    if (user.has_password) {
      current_password = window.prompt('This deletes your account and all your leaves for good. Type your password to confirm.');
      if (!current_password) return;
    } else if (!window.confirm('This deletes your account and all your leaves for good. Delete it?')) return;
    try { await api('/me', { method: 'DELETE', json: { current_password } }); signOut(); } catch (err) { oops(err); }
  }

  return (
    <div className="settings">
      <TopBar back title="Settings" />
      {msg && <p className="toast" role="status">{msg}</p>}
      <ErrorNote error={error} />

      <section>
        <button className="avatar-edit" onClick={() => fileRef.current.click()} aria-label="Change profile picture">
          <Avatar user={user} size={88} /><span>Change picture</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
        <label>Alias
          <input value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} placeholder={`Shown instead of @${user.username}`} />
        </label>
        <button className="button secondary" onClick={() => saveProfile({ alias })}>Save alias</button>
      </section>

      <section>
        <label className="toggle">
          <input type="checkbox" checked={user.is_private} onChange={(e) => saveProfile({ is_private: e.target.checked })} />
          <span>Private profile<small>Only your friends see your profile picture. Your leaves stay visible to everyone.</small></span>
        </label>
      </section>

      <form onSubmit={saveCredentials}>
        <h3 className="section-title">Email and password</h3>
        {!user.has_password && (
          <p className="notice">Your account only lives on this phone. Add an email and password to log in on other devices and to reset your password if you forget it.</p>
        )}
        <label>Email
          <input type="email" value={creds.email} onChange={setC('email')} autoComplete="email" required={!user.has_password} />
        </label>
        {user.has_password && (
          <label>Current password
            <input type="password" value={creds.current_password} onChange={setC('current_password')} autoComplete="current-password" required />
          </label>
        )}
        <label>{user.has_password ? 'New password' : 'Password'} {user.has_password && <span className="hint">(leave empty to keep it)</span>}
          <input type="password" value={creds.new_password} onChange={setC('new_password')} minLength={8} autoComplete="new-password" required={!user.has_password} />
        </label>
        <button className="button secondary">{user.has_password ? 'Save changes' : 'Add email and password'}</button>
      </form>

      <section className="danger-zone">
        <button className="button secondary" onClick={() => {
          if (user.has_password || window.confirm("Your account has no password, so after logging out you can't log back in. Log out anyway?")) signOut();
        }}>Log out</button>
        <button className="link danger" onClick={deleteAccount}>Delete my account</button>
      </section>
    </div>
  );
}
