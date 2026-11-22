import { useEffect, useState } from 'react';
import { api, displayName, formatDate, COMMON_TREES } from '../api.js';
import { ErrorNote, Icon } from '../ui.jsx';
import { ask } from '../dialog.jsx';

// A leaf opens as a card. Tap to flip: the back is the leaf's mirrored silhouette in khaki green,
// with the tree, the date and the caption.
export function LeafCard({ leaf, owner, canEdit, onClose, onChanged, onDeleted }) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ tree_name: leaf.tree_name, caption: leaf.caption });
  const [error, setError] = useState('');
  const [showPhoto, setShowPhoto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setFlipped(true), 650); // a little flip to show it can flip
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(t); window.removeEventListener('keydown', esc); };
  }, []);

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
        <button className={`flip-card ${flipped ? 'flipped' : ''}`} onClick={() => !editing && setFlipped(!flipped)}
          aria-label={flipped ? 'Show the leaf' : 'Show the back'}>
          <div className="face front">
            <img src={leaf.cutout} alt={`${leaf.tree_name} leaf caught by ${displayName(owner)}`} />
            <span className="front-label">{leaf.tree_name}</span>
          </div>
          <div className="face back">
            <div className="silhouette" style={{ WebkitMaskImage: `url("${leaf.cutout}")`, maskImage: `url("${leaf.cutout}")` }} />
            <div className="back-text">
              <span className="tree-pill">{leaf.tree_name}</span>
              {leaf.tree_scientific && <em className="scientific">{leaf.tree_scientific}</em>}
              <time dateTime={leaf.caught_at}>Caught {formatDate(leaf.caught_at, true)}</time>
              {leaf.caption && <p className="caption">“{leaf.caption}”</p>}
            </div>
          </div>
        </button>

        <div className="card-tools">
          <span className="hint">Tap the card to flip it</span>
          <button className="link" onClick={() => setShowPhoto(!showPhoto)}>{showPhoto ? 'Hide photo' : 'Original photo'}</button>
          {canEdit && !editing && <button className="link" onClick={() => setEditing(true)}>Edit</button>}
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        {showPhoto && <img className="original-photo" src={leaf.photo} alt={`Original photo of the ${leaf.tree_name} leaf`} />}

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
