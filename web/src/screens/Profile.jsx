import { useEffect, useState } from 'react';
import { api, displayName, seeded } from '../api.js';
import { Avatar, Empty, ErrorNote, Icon, TopBar } from '../ui.jsx';
import { LeafCard } from './LeafCard.jsx';

const FRIEND_BUTTON = {
  none: { label: 'Add friend', cls: 'button' },
  requested: { label: 'Request sent · cancel', cls: 'button secondary' },
  incoming: { label: 'Accept friend request', cls: 'button' },
  friends: { label: 'Friends ✓', cls: 'button secondary' },
};

export function Profile({ username }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = () => api(`/users/${encodeURIComponent(username)}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [username]);

  async function friendAction() {
    const rel = data.relation;
    if (rel === 'friends' && !confirmUnfriend()) return;
    const method = rel === 'none' || rel === 'incoming' ? 'POST' : 'DELETE';
    try {
      const d = await api(`/friends/${encodeURIComponent(data.user.username)}`, { method });
      setData({ ...data, relation: d.relation });
      if (d.relation === 'friends' || rel === 'friends') load();
    } catch (e) { setError(e.message); }
  }
  const confirmUnfriend = () => window.confirm(`Remove ${displayName(data.user)} from your friends?`);

  if (error && !data) return <><TopBar back title="" /><ErrorNote error={error} /></>;
  if (!data) return <div className="loading">Loading…</div>;

  const { user, stats, relation, visible, leaves } = data;
  const self = relation === 'self';

  return (
    <div className="profile">
      <TopBar back={!self} title={self ? 'Your leaves' : ''}
        right={self ? <a className="icon-button" href="#/settings" aria-label="Settings"><Icon name="gear" /></a> : null} />

      <section className="profile-head">
        <Avatar user={user} size={96} />
        <h2>{displayName(user)}</h2>
        {user.alias && <p className="handle">@{user.username}</p>}
        {user.is_private && <p className="private-badge"><Icon name="lock" size={14} /> Private profile</p>}
        <dl className="stats">
          <div><dt>This season</dt><dd>{stats.leaves_this_season}</dd></div>
          <div><dt>All time</dt><dd>{stats.leaves_total}</dd></div>
          <a href={`#/u/${user.username}/friends`}><dt>Friends</dt><dd>{stats.friends}</dd></a>
        </dl>
        <div className="profile-actions">
          {!self && <button className={FRIEND_BUTTON[relation].cls} onClick={friendAction}>{FRIEND_BUTTON[relation].label}</button>}
          <a className="button secondary" href={`#/u/${user.username}/friends`}><Icon name="people" size={18} /> {self ? 'Friends' : 'See friends'}</a>
        </div>
        <ErrorNote error={error} />
      </section>

      {!visible && <Empty>{displayName(user)} keeps their leaves for friends only.</Empty>}
      {visible && !leaves.length && (
        <Empty>{self ? <>No leaves yet. Tap the <strong>leaf button</strong> below after your first catch.</> : 'No leaves caught yet.'}</Empty>
      )}
      {visible && leaves.length > 0 && (
        <ul className="leaf-pile" aria-label="Caught leaves">
          {leaves.map((l, i) => {
            const rot = Math.round((seeded(l.id, 1) - 0.5) * 70);
            const dx = Math.round((seeded(l.id, 2) - 0.5) * 18);
            const dy = Math.round((seeded(l.id, 3) - 0.5) * 18) + (i % 3 === 1 ? 26 : 0);
            const scale = 0.85 + seeded(l.id, 4) * 0.3;
            return (
              <li key={l.id} style={{ '--rot': `${rot}deg`, '--dx': `${dx}px`, '--dy': `${dy}px`, '--scale': scale }}>
                <button onClick={() => setOpen(l)} aria-label={`${l.tree_name} leaf`}>
                  <img src={l.cutout} alt="" loading="lazy" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <LeafCard leaf={open} owner={user} canEdit={self}
          onClose={() => setOpen(null)}
          onChanged={(leaf) => { setData({ ...data, leaves: leaves.map((l) => (l.id === leaf.id ? leaf : l)) }); setOpen(leaf); }}
          onDeleted={() => { setOpen(null); load(); }} />
      )}
    </div>
  );
}
