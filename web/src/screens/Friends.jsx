import { useEffect, useState } from 'react';
import { api, displayName } from '../api.js';
import { useSession } from '../App.jsx';
import { Empty, ErrorNote, Icon, PlayerLink, TopBar } from '../ui.jsx';

function PersonRow({ user, children }) {
  return (
    <li className="person">
      <PlayerLink user={user} size={44} />
      <a className="who" href={`#/u/${user.username}`}>
        <strong>{displayName(user)}</strong>
        {user.alias && <small>@{user.username}</small>}
      </a>
      <span className="person-actions">{children}</span>
    </li>
  );
}

export function Friends({ username }) {
  const { user: me } = useSession();
  const self = username.toLowerCase() === me.username.toLowerCase();
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState(null);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [groups, setGroups] = useState([]);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    api(`/users/${encodeURIComponent(username)}/friends`).then((d) => setFriends(d.friends)).catch((e) => setError(e.message));
    if (self) {
      api('/friends/requests').then(setRequests).catch(() => {});
      api('/groups').then((d) => setGroups(d.groups)).catch(() => {});
    }
  };
  useEffect(load, [username]);

  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api(`/users?q=${encodeURIComponent(term.trim())}`).then((d) => setResults(d.users)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [term]);

  async function act(name, method) {
    try { await api(`/friends/${encodeURIComponent(name)}`, { method }); load(); } catch (e) { setError(e.message); }
  }

  async function leave(g) {
    const note = g.is_owner && g.size > 1 ? ' Someone else in it becomes the owner.' : '';
    if (!window.confirm(`Leave ${g.name}?${note}`)) return;
    try { await api(`/groups/${g.id}/leave`, { method: 'POST' }); load(); } catch (e) { setError(e.message); }
  }

  const friendIds = new Set((friends || []).map((f) => f.id));
  const outgoing = new Set(requests.outgoing.map((f) => f.id));
  const incoming = new Set(requests.incoming.map((f) => f.id));

  return (
    <div className="friends">
      <TopBar back title={self ? 'Friends' : `${username}'s friends`} />
      {self && (
        <div className="segmented" role="tablist">
          {[['friends', 'Friends'], ['requests', `Requests${requests.incoming.length ? ` (${requests.incoming.length})` : ''}`], ['find', 'Find'], ['groups', 'Groups']]
            .map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
      )}
      <ErrorNote error={error} />

      {tab === 'friends' && (
        friends && !friends.length ? (
            <Empty>{self ? <>No friends yet. <button className="link" onClick={() => setTab('find')}>Find people</button></> : 'No friends yet.'}</Empty>
          ) : (
            <ul className="people">{(friends || []).map((f) => <PersonRow key={f.id} user={f} />)}</ul>
          )
      )}

      {tab === 'requests' && (
        <>
          <h3 className="section-title">Waiting for you</h3>
          {!requests.incoming.length && <p className="muted">No requests.</p>}
          <ul className="people">
            {requests.incoming.map((f) => (
              <PersonRow key={f.id} user={f}>
                <button className="button small" onClick={() => act(f.username, 'POST')}>Accept</button>
                <button className="link" onClick={() => act(f.username, 'DELETE')}>Decline</button>
              </PersonRow>
            ))}
          </ul>
          <h3 className="section-title">You asked</h3>
          {!requests.outgoing.length && <p className="muted">Nothing pending.</p>}
          <ul className="people">
            {requests.outgoing.map((f) => (
              <PersonRow key={f.id} user={f}><button className="link" onClick={() => act(f.username, 'DELETE')}>Cancel</button></PersonRow>
            ))}
          </ul>
        </>
      )}

      {tab === 'find' && (
        <>
          <input className="search" type="search" placeholder="Search by username or alias" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
          <ul className="people">
            {results.filter((u) => u.id !== me.id).map((u) => (
              <PersonRow key={u.id} user={u}>
                {friendIds.has(u.id) ? <span className="muted">Friends</span>
                  : outgoing.has(u.id) ? <span className="muted">Requested</span>
                    : <button className="button small" onClick={() => act(u.username, 'POST')}>{incoming.has(u.id) ? 'Accept' : 'Add'}</button>}
              </PersonRow>
            ))}
          </ul>
          {term.trim().length >= 2 && !results.length && <p className="muted">Nobody by that name yet.</p>}
        </>
      )}

      {tab === 'groups' && (
        <>
          <p className="muted">Groups filter the leaderboards to just these people.</p>
          <ul className="people">
            {groups.map((g) => (
              <li key={g.id} className="person">
                <span className="avatar avatar-letter group-badge"><Icon name="people" size={20} /></span>
                <a className="who" href={`#/groups/${g.id}`}><strong>{g.name}</strong><small>{g.size} {g.size === 1 ? 'person' : 'people'}{g.is_owner ? ' · yours' : ''}</small></a>
                <button className="link" onClick={() => leave(g)}>Leave</button>
              </li>
            ))}
          </ul>
          <a className="button" href="#/groups/new"><Icon name="plus" size={18} /> New group</a>
        </>
      )}
    </div>
  );
}
