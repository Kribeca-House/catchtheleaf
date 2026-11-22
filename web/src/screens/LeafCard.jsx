import { useEffect, useState } from 'react';
import { api, displayName, formatDate, COMMON_TREES } from '../api.js';
import { useSession } from '../App.jsx';
import { Avatar, ErrorNote, Icon } from '../ui.jsx';
import { ask } from '../dialog.jsx';

// A leaf opens as a card. The front is the cut-out leaf. Tap it to flip: the back shows the
// original photo with the tree, the date and the caption, then likes and comments.
export function LeafCard({ leaf, owner, canEdit, onClose, onChanged, onDeleted }) {
  const { user: viewer } = useSession();
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ tree_name: leaf.tree_name, caption: leaf.caption });
  const [error, setError] = useState('');
  const [social, setSocial] = useState(null); // { likes, liked, comments }
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  useEffect(() => {
    let live = true;
    api(`/leaves/${leaf.id}/social`).then((d) => live && setSocial(d)).catch(() => live && setSocial({ likes: 0, liked: false, comments: [] }));
    return () => { live = false; };
  }, [leaf.id]);

  async function toggleLike() {
    const was = social;
    const liked = !was.liked;
    setSocial({ ...was, liked, likes: was.likes + (liked ? 1 : -1) }); // feels instant
    try {
      const d = await api(`/leaves/${leaf.id}/like`, { method: liked ? 'PUT' : 'DELETE' });
      setSocial((s) => ({ ...s, ...d }));
    } catch (err) { setSocial(was); setError(err.message); }
  }

  async function postComment(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true); setError('');
    try {
      const d = await api(`/leaves/${leaf.id}/comments`, { method: 'POST', json: { body: draft } });
      setSocial((s) => ({ ...s, comments: [...s.comments, d.comment] }));
      setDraft('');
    } catch (err) { setError(err.message); }
    setPosting(false);
  }

  async function deleteComment(c) {
    if (!(await ask({ message: 'Delete this comment?', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/comments/${c.id}`, { method: 'DELETE' });
      setSocial((s) => ({ ...s, comments: s.comments.filter((x) => x.id !== c.id) }));
    } catch (err) { setError(err.message); }
  }

  async function save(e) {
    e.preventDefault();
    try {
      const d = await api(`/leaves/${leaf.id}`, { method: 'PATCH', json: form });
      setEditing(false); onChanged(d.leaf);
    } catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!(await ask({ message: 'Delete this leaf? It will stop counting on the leaderboards.', confirmLabel: 'Delete leaf', danger: true }))) return;
    try { await api(`/leaves/${leaf.id}`, { method: 'DELETE' }); onDeleted(leaf.id); } catch (err) { setError(err.message); }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`${leaf.tree_name} leaf`} onClick={onClose}>
      <div className="card-stage" onClick={(e) => e.stopPropagation()}>
        <div className={`flip-card ${flipped ? 'flipped' : ''}`}>
          <button className="face front" onClick={() => setFlipped(true)} aria-label="Turn the card over" aria-hidden={flipped} tabIndex={flipped ? -1 : 0}>
            <img src={leaf.cutout} alt={`${leaf.tree_name} leaf caught by ${displayName(owner)}`} />
            <span className="front-label">{leaf.tree_name}</span>
            {social && (social.likes > 0 || social.comments.length > 0) && (
              <span className="front-counts">
                {social.likes > 0 && <span><Icon name="heart" size={16} filled /> {social.likes}</span>}
                {social.comments.length > 0 && <span><Icon name="comment" size={16} /> {social.comments.length}</span>}
              </span>
            )}
          </button>

          <div className="face back" aria-hidden={!flipped}>
            <button className="back-photo" onClick={() => setFlipped(false)} aria-label="Turn the card back over" tabIndex={flipped ? 0 : -1}>
              <img src={leaf.photo} alt={`Photo of the ${leaf.tree_name} leaf as it was caught`} loading="lazy" />
            </button>
            <div className="back-text">
              <span className="tree-pill">{leaf.tree_name}</span>
              {leaf.tree_scientific && <em className="scientific">{leaf.tree_scientific}</em>}
              <time dateTime={leaf.caught_at}>Caught {formatDate(leaf.caught_at, true)} by {displayName(owner)}</time>
              {leaf.caption && <p className="caption">“{leaf.caption}”</p>}
            </div>

            <div className="social">
              <div className="social-bar">
                <button className={`like ${social?.liked ? 'on' : ''}`} onClick={toggleLike} disabled={!social}
                  aria-pressed={Boolean(social?.liked)} tabIndex={flipped ? 0 : -1}>
                  <Icon name="heart" size={22} filled={Boolean(social?.liked)} />
                  <span>{social ? social.likes : '…'}</span>
                  <span className="sr-only">{social?.liked ? 'Unlike' : 'Like'}</span>
                </button>
                <span className="muted small"><Icon name="comment" size={18} /> {social ? social.comments.length : '…'}</span>
              </div>

              {social?.comments.length > 0 && (
                <ul className="comments">
                  {social.comments.map((c) => (
                    <li key={c.id}>
                      <a href={`#/u/${c.user.username}`} onClick={onClose} aria-label={`${displayName(c.user)}'s profile`} tabIndex={flipped ? 0 : -1}>
                        <Avatar user={c.user} size={28} />
                      </a>
                      <div>
                        <strong>{displayName(c.user)}</strong> <span className="muted small">{formatDate(c.created_at)}</span>
                        <p>{c.body}</p>
                      </div>
                      {c.can_delete && (
                        <button className="icon-button small" onClick={() => deleteComment(c)} aria-label="Delete comment" tabIndex={flipped ? 0 : -1}>
                          <Icon name="trash" size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {viewer && (
                <form className="comment-form" onSubmit={postComment}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
                    placeholder="Say something nice" aria-label="Write a comment" tabIndex={flipped ? 0 : -1} />
                  <button className="icon-button" disabled={posting || !draft.trim()} aria-label="Post comment" tabIndex={flipped ? 0 : -1}>
                    <Icon name="send" size={20} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        <div className="card-tools">
          <button className="link" onClick={() => setFlipped(!flipped)}>{flipped ? 'Show the leaf' : 'Turn over'}</button>
          {canEdit && !editing && <button className="link" onClick={() => setEditing(true)}>Edit</button>}
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {!editing && <ErrorNote error={error} />}

        {editing && (
          <form className="sheet" onSubmit={save}>
            <label>Tree
              <input list="trees" value={form.tree_name} onChange={(e) => setForm({ ...form, tree_name: e.target.value })} maxLength={60} required />
            </label>
            <datalist id="trees">{COMMON_TREES.map((t) => <option key={t} value={t} />)}</datalist>
            <label>Caption
              <textarea value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} maxLength={280} rows={3} />
            </label>
            <ErrorNote error={error} />
            <div className="row">
              <button className="button">Save</button>
              <button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" className="link danger" onClick={remove}>Delete leaf</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
