import { useEffect, useState } from 'react';
import { api, displayName, formatDate } from '../api.js';
import { Empty, ErrorNote, Icon, PlayerLink } from '../ui.jsx';

const BOARDS = [
  { id: 'season', label: 'First catch', blurb: 'Who caught their first leaf earliest this season' },
  { id: 'wealth', label: 'Leaf wealth', blurb: 'Most leaves caught this season' },
  { id: 'alltime', label: 'All time', blurb: 'Every season: season places count double, plus one point per leaf' },
];

function remember(key, fallback) {
  try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; }
}
function store(key, v) { try { sessionStorage.setItem(key, v); } catch { /* ignore */ } }

export function Leaderboard() {
  const [board, setBoard] = useState(() => remember('ctl.board', 'season'));
  const [scope, setScope] = useState(() => remember('ctl.scope', 'all'));
  const [groups, setGroups] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api('/groups').then((d) => setGroups(d.groups)).catch(() => {}); }, []);
  useEffect(() => {
    store('ctl.board', board); store('ctl.scope', scope);
    setData(null); setError('');
    api(`/leaderboards/${board}?scope=${encodeURIComponent(scope)}`)
      .then(setData)
      .catch((e) => { if (e.status === 404 && scope !== 'all') setScope('all'); else setError(e.message); });
  }, [board, scope]);

  const info = BOARDS.find((b) => b.id === board);

  return (
    <div className="leaderboard">
      <header className="board-header">
        <h1>Catch the leaf!</h1>
        <p className="season-name">{board === 'alltime' ? 'All seasons' : data?.season?.name || 'No season running'}</p>
      </header>

      <div className="segmented" role="tablist">
        {BOARDS.map((b) => (
          <button key={b.id} role="tab" aria-selected={board === b.id} className={board === b.id ? 'on' : ''} onClick={() => setBoard(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      <p className="board-blurb">{info.blurb}</p>

      <div className="chips" aria-label="Show">
        <button className={scope === 'all' ? 'chip on' : 'chip'} onClick={() => setScope('all')}>Everyone</button>
        <button className={scope === 'friends' ? 'chip on' : 'chip'} onClick={() => setScope('friends')}>Friends</button>
        {groups.map((g) => (
          <button key={g.id} className={scope === g.id ? 'chip on' : 'chip'} onClick={() => setScope(g.id)}>{g.name}</button>
        ))}
        <a className="chip add" href="#/groups/new"><Icon name="plus" size={16} /> Group</a>
      </div>
      {groups.some((g) => g.id === scope) && (
        <a className="edit-group" href={`#/groups/${scope}`}>Group settings</a>
      )}

      <ErrorNote error={error} />
      {!data && !error && <div className="loading">Loading…</div>}
      {data && !data.entries.length && (
        <Empty>No leaves caught {scope === 'all' ? 'yet' : 'by this crowd yet'}. Go outside, it's windy!</Empty>
      )}
      {data && data.entries.length > 0 && (
        <ol className="ranking">
          {data.entries.map((e) => (
            <li key={e.user_id} className={`${e.is_me ? 'me' : ''} place-${e.place}`}>
              <span className="place">{e.place}</span>
              <PlayerLink user={e.user} size={44} />
              <a className="who" href={`#/u/${e.user.username}`}>
                <strong>{displayName(e.user)}</strong>
                {e.user.alias && <small>@{e.user.username}</small>}
              </a>
              <span className="value">
                {board === 'season' && <><strong>{formatDate(e.first_at)}</strong><small>{new Date(e.first_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></>}
                {board === 'wealth' && <><strong>{e.leaves}</strong><small>{e.leaves === 1 ? 'leaf' : 'leaves'}</small></>}
                {board === 'alltime' && <><strong>{e.score}</strong><small>pts · {e.seasons} {e.seasons === 1 ? 'season' : 'seasons'}</small></>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
