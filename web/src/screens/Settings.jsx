import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../App.jsx';
import { resizeToJpeg } from '../cutout.js';
import { Avatar, ErrorNote, TopBar } from '../ui.jsx';
import { RecoveryCode } from './Auth.jsx';

export function Settings() {
  const { user, setUser, signOut } = useSession();
  const [alias, setAlias] = useState(user.alias || '');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const [code, setCode] = useState(null);
  const fileRef = useRef(null);

  const done = (m) => { setMsg(m); setError(''); setTimeout(() => setMsg(''), 2500); };
  const oops = (e) => { setError(e.message); setMsg(''); };

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
  async function changePassword(e) {
    e.preventDefault();
    try { await api('/me/password', { method: 'POST', json: pw }); setPw({ current_password: '', new_password: '' }); done('Password changed'); } catch (err) { oops(err); }
  }
  async function newCode() {
    if (!pw.current_password) { setError('Type your current password above first'); return; }
    try { const d = await api('/me/recovery-code', { method: 'POST', json: { current_password: pw.current_password } }); setCode(d.recovery_code); } catch (err) { oops(err); }
  }
  async function deleteAccount() {
    const current_password = window.prompt('This deletes your account and all your leaves for good. Type your password to confirm.');
    if (!current_password) return;
    try { await api('/me', { method: 'DELETE', json: { current_password } }); signOut(); } catch (err) { oops(err); }
  }

  if (code) return <div className="settings"><RecoveryCode code={code} onDone={() => setCode(null)} /></div>;

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
          <span>Private profile<small>You still appear on leaderboards, but only friends can see your leaves and friends.</small></span>
        </label>
      </section>

      <form onSubmit={changePassword}>
        <h3 className="section-title">Password</h3>
        <label>Current password
          <input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} autoComplete="current-password" />
        </label>
        <label>New password
          <input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} minLength={8} autoComplete="new-password" />
        </label>
        <div className="row">
          <button className="button secondary" disabled={!pw.new_password}>Change password</button>
          <button type="button" className="link" onClick={newCode}>Get a new recovery code</button>
        </div>
      </form>

      <section className="danger-zone">
        <button className="button secondary" onClick={signOut}>Log out</button>
        <button className="link danger" onClick={deleteAccount}>Delete my account</button>
      </section>
    </div>
  );
}
