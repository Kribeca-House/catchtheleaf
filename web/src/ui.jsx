import { displayName } from './api.js';
import { back as goBack } from './nav.js';

const PATHS = {
  leaf: 'M20 3C10 3 4 8.5 4 15c0 1.6.4 3 1.1 4.2C6.5 15 9.5 11.6 14 9.5c-3.5 2.7-6.3 6-7.6 10.3 1.2.8 2.9 1.2 4.6 1.2C19 21 21 12 20 3z',
  'leaf-plus': 'M20 3C10 3 4 8.5 4 15c0 1.6.4 3 1.1 4.2C6.5 15 9.5 11.6 14 9.5c-3.5 2.7-6.3 6-7.6 10.3 1.2.8 2.9 1.2 4.6 1.2C19 21 21 12 20 3z',
  trophy: 'M7 4h10v3a5 5 0 0 1-10 0V4zm0 1H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 12v4m-4 4h8m-6-4h4l1 4H9l1-4z',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm8-3.5-.1-1.3 2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15 3h-4l-.4 2.5a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3L11 21h4l.4-2.5a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6.1-1.2z',
  back: 'M15 5l-7 7 7 7',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6m2 16a6 6 0 0 0-3-5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
};

export function Icon({ name, size = 24 }) {
  const filled = name === 'leaf';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`icon icon-${name}`}
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
      {name === 'leaf-plus' && <path d="M17 15v6m-3-3h6" strokeWidth="2.2" />}
    </svg>
  );
}

export function Avatar({ user, size = 40 }) {
  if (user?.avatar) return <img className="avatar" src={user.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  const letter = (user?.alias || user?.username || '?').charAt(0).toUpperCase();
  return <span className="avatar avatar-letter" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">{letter}</span>;
}

export function PlayerLink({ user, size = 40 }) {
  return (
    <a href={`#/u/${user.username}`} className="player-link" aria-label={`${displayName(user)}'s profile`}>
      <Avatar user={user} size={size} />
    </a>
  );
}

export function TopBar({ title, back, right }) {
  return (
    <header className="top-bar">
      {back ? <button className="icon-button" onClick={goBack} aria-label="Back"><Icon name="back" /></button> : <span className="spacer" />}
      <h1>{title}</h1>
      {right || <span className="spacer" />}
    </header>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <p className="error-note" role="alert">{error}</p>;
}

export function Empty({ children }) {
  return <div className="empty"><Icon name="leaf" size={40} /><p>{children}</p></div>;
}
