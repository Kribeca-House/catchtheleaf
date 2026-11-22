import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';
import { Auth, ResetPassword } from './screens/Auth.jsx';
import { Leaderboard } from './screens/Leaderboard.jsx';
import { Profile } from './screens/Profile.jsx';
import { Friends } from './screens/Friends.jsx';
import { CatchLeaf } from './screens/CatchLeaf.jsx';
import { Settings } from './screens/Settings.jsx';
import { GroupEditor } from './screens/GroupEditor.jsx';
import { Avatar, Icon } from './ui.jsx';
import { DialogHost } from './dialog.jsx';
import { currentPath, subscribe, go } from './nav.js';

export { go };

const Session = createContext(null);
export const useSession = () => useContext(Session);

// Routes: /, /u/<name>, /u/<name>/friends, /catch, /settings, /groups/new, /groups/<id>, /reset/<token>
function useRoute() {
  const split = (p) => p.split('/').filter(Boolean);
  const [parts, setParts] = useState(() => split(currentPath()));
  useEffect(() => subscribe((p) => { setParts(split(p)); window.scrollTo(0, 0); }), []);
  return parts;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const route = useRoute();

  useEffect(() => {
    if (!getToken()) return;
    api('/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const signIn = useCallback((token, u) => { setToken(token); setUser(u); }, []);
  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null); setUser(null); go('/');
  }, []);

  const [first, second, third] = route;
  if (first === 'reset' && second) return <><ResetPassword token={second} onSignedIn={signIn} /><DialogHost /></>;
  if (loading) return <div className="splash"><Icon name="leaf" size={48} /></div>;
  if (!user) return <><DemoBanner /><Auth onSignedIn={signIn} /></>;

  let screen;
  let tab = 'board';
  if (first === 'u' && second && third === 'friends') { screen = <Friends key={second} username={second} />; tab = second === user.username ? 'profile' : 'board'; }
  else if (first === 'u' && second) { screen = <Profile key={second} username={second} />; tab = second.toLowerCase() === user.username.toLowerCase() ? 'profile' : 'board'; }
  else if (first === 'catch') { screen = <CatchLeaf />; tab = 'catch'; }
  else if (first === 'settings') { screen = <Settings />; tab = 'profile'; }
  else if (first === 'groups' && second) { screen = <GroupEditor id={second === 'new' ? null : second} />; }
  else screen = <Leaderboard />;

  return (
    <Session.Provider value={{ user, setUser, signIn, signOut }}>
      <DemoBanner />
      <main className="screen">{screen}</main>
      <DialogHost />
      <nav className="bottom-nav" aria-label="Main">
        <a href="#/" className={tab === 'board' ? 'active' : ''}>
          <Icon name="trophy" /><span>Leaderboard</span>
        </a>
        <a href="#/catch" className={`catch-button ${tab === 'catch' ? 'active' : ''}`} aria-label="Catch a leaf">
          <Icon name="leaf-plus" size={30} />
        </a>
        <a href={`#/u/${user.username}`} className={tab === 'profile' ? 'active' : ''}>
          <Avatar user={user} size={26} /><span>Profile</span>
        </a>
      </nav>
    </Session.Provider>
  );
}

// Only in the preview build.
function DemoBanner() {
  if (!import.meta.env.VITE_DEMO) return null;
  return <p className="demo-banner">Preview with sample players. Nothing is saved: it all resets when you reload.</p>;
}
