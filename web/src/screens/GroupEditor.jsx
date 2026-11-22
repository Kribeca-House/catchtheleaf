import { useEffect, useState } from 'react';
import { api, displayName } from '../api.js';
import { go, useSession } from '../App.jsx';
import { Avatar, Empty, ErrorNote, TopBar } from '../ui.jsx';

export function GroupEditor({ id }) {
  const { user: me } = useSession();
  const [friends, setFriends] = useState(null);
  const [group, setGroup] = useState(id ? null : { name: '', is_owner: true, members: [] });
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/users/${me.username}/friends`).then((d) => setFriends(d.friends)).catch((e) => setError(e.message));
    if (id) api(`/groups/${id}`).then((g) => { setGroup(g); setPicked(new Set(g.members.map((m) => m.id))); }).catch((e) => setError(e.message));
  }, [id]);

  async function save(e) {
    e.preventDefault();
    try {
      const json = { name: group.name, member_ids: [...picked] };
      if (id) await api(`/groups/${id}`, { method: 'PUT', json });
      else await api('/groups', { method: 'POST', json });
      history.back();
    } catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!window.confirm(group.is_owner ? 'Delete this group for everyone in it?' : 'Leave this group?')) return;
    await api(`/groups/${id}`, { method: 'DELETE' }).catch(() => {});
    go('/');
  }

  if (!group) return <><TopBar back title="Group" /><ErrorNote error={error} /></>;
  const toggle = (uid) => { const s = new Set(picked); s.has(uid) ? s.delete(uid) : s.add(uid); setPicked(s); };

  if (!group.is_owner) {
    return (
      <div className="group-editor">
        <TopBar back title={group.name} />
        <ul className="people">{group.members.map((m) => <li key={m.id} className="person"><Avatar user={m} size={40} /><span className="who"><strong>{displayName(m)}</strong></span></li>)}</ul>
        <button className="link danger" onClick={remove}>Leave group</button>
      </div>
    );
  }

  return (
    <form className="group-editor" onSubmit={save}>
      <TopBar back title={id ? 'Edit group' : 'New group'} />
      <label>Group name
        <input value={group.name} onChange={(e) => setGroup({ ...group, name: e.target.value })} maxLength={40} required placeholder="Park crew" />
      </label>
      <h3 className="section-title">Who's in it? <span className="muted">(you're always in)</span></h3>
      {friends && !friends.length && <Empty>Add some friends first, then make a group from them.</Empty>}
      <ul className="people pick">
        {(friends || []).map((f) => (
          <li key={f.id} className="person">
            <label className="pick-row">
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
              <Avatar user={f} size={40} />
              <span className="who"><strong>{displayName(f)}</strong>{f.alias && <small>@{f.username}</small>}</span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
      <button className="button">{id ? 'Save group' : 'Create group'}</button>
      {id && <button type="button" className="link danger" onClick={remove}>Delete group</button>}
    </form>
  );
}
