import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';
import { Auth } from './screens/Auth.jsx';
import { Leaderboard } from './screens/Leaderboard.jsx';
import { Profile } from './screens/Profile.jsx';
import { Friends } from './screens/Friends.jsx';
import { CatchLeaf } from './screens/CatchLeaf.jsx';
import { Settings } from './screens/Settings.jsx';
import { GroupEditor } from './screens/GroupEditor.jsx';
import { Avatar, Icon } from './ui.jsx';

const Session = createContext(null);
export const useSession = () => useContext(Session);

// Tiny hash router: #/, #/u/<name>, #/u/<name>/friends, #/catch, #/settings, #/groups/new, #/groups/<id>
function useRoute() {
  const read = () => (window.location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
export const go = (path) => { window.location.hash = path; };

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

  if (loading) return <div className="splash"><Icon name="leaf" size={48} /></div>;
  if (!user) return <Auth onSignedIn={signIn} />;

  const [first, second, third] = route;
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
      <main className="screen">{screen}</main>
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
