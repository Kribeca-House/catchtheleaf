import { useEffect, useRef, useState } from 'react';
import { api, COMMON_TREES, formatDate } from '../api.js';
import { useSession } from '../App.jsx';
import { go } from '../nav.js';
import { tell } from '../dialog.jsx';
import { cutOutLeaf, photoAsCutout } from '../cutout.js';
import { photoTakenAt } from '../exif.js';
import { ErrorNote, Icon, TopBar } from '../ui.jsx';

// Catch flow: photo -> cut-out + tree suggestions -> check the tree, add a caption -> save.
export function CatchLeaf() {
  const { user } = useSession();
  const [step, setStep] = useState('pick'); // pick | working | details | saving
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null); // { ok, photo, cutout, colour }
  const [preview, setPreview] = useState(null);
  const [ident, setIdent] = useState({ loading: false, available: true, suggestions: [] });
  const [tree, setTree] = useState({ name: '', scientific: '', confidence: null, source: 'user' });
  const [caption, setCaption] = useState('');
  const [takenAt, setTakenAt] = useState(null); // { date, source: 'photo' | 'file' } or null = upload time
  const [error, setError] = useState('');
  const camera = useRef(null);
  const library = useRef(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f); setStep('working'); setError('');
    try {
      // When was it caught? The photo's own timestamp, else the file's date if it's clearly older than now.
      const exif = await photoTakenAt(f);
      const fileDate = f.lastModified && Date.now() - f.lastModified > 2 * 60_000 ? new Date(f.lastModified) : null;
      setTakenAt(exif ? { date: exif, source: 'photo' } : fileDate ? { date: fileDate, source: 'file' } : null);
      const r = await cutOutLeaf(f);
      setResult(r);
      if (r.ok) setPreview(URL.createObjectURL(r.cutout));
      setStep('details');
      identify(r.photo);
    } catch (err) {
      setError(`Couldn't read that photo (${err.message}). Try another one.`);
      setStep('pick');
    }
  }

  async function identify(photo) {
    setIdent({ loading: true, available: true, suggestions: [] });
    const form = new FormData();
    form.append('photo', photo, 'leaf.jpg');
    try {
      const d = await api('/identify', { method: 'POST', form });
      setIdent({ loading: false, ...d });
      const top = d.suggestions?.[0];
      if (top) setTree({ name: top.name, scientific: top.scientific, confidence: top.score, source: 'auto' });
    } catch {
      setIdent({ loading: false, available: false, suggestions: [] });
    }
  }

  async function usePhotoAnyway() {
    const cutout = await photoAsCutout(file);
    setResult({ ...result, ok: true, cutout, colour: result.colour || '#617257' });
    setPreview(URL.createObjectURL(cutout));
  }

  async function save(e) {
    e.preventDefault();
    setStep('saving'); setError('');
    const form = new FormData();
    form.append('photo', result.photo, 'photo.jpg');
    form.append('cutout', result.cutout, 'cutout.png');
    form.append('colour', result.colour || '#617257');
    form.append('tree_name', tree.name.trim());
    if (tree.scientific) form.append('tree_scientific', tree.scientific);
    if (tree.confidence != null) form.append('tree_confidence', String(tree.confidence));
    form.append('tree_source', tree.source);
    form.append('caption', caption);
    if (takenAt) form.append('caught_at', takenAt.date.toISOString());
    try {
      const d = await api('/leaves', { method: 'POST', form });
      if (!d.counted) await tell("Saved! It was caught outside the season, so it won't count on the boards.");
      go(`/u/${user.username}`);
    } catch (err) { setError(err.message); setStep('details'); }
  }

  const pickTree = (s) => setTree({ name: s.name, scientific: s.scientific, confidence: s.score, source: 'auto' });

  return (
    <div className="catch">
      <TopBar title="Catch a leaf" />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={library} type="file" accept="image/*" hidden onChange={onFile} />

      {step === 'pick' && (
        <div className="catch-start">
          <div className="catch-illustration"><Icon name="leaf" size={88} /></div>
          <p>Lay your leaf flat on something plain, like paper, a table or the pavement, and take a photo from above.</p>
          <button className="button big" onClick={() => camera.current.click()}><Icon name="camera" /> Take a photo</button>
          <button className="button secondary" onClick={() => library.current.click()}><Icon name="image" /> Choose from photos</button>
          <ErrorNote error={error} />
        </div>
      )}

      {step === 'working' && <div className="loading big">Cutting out your leaf…</div>}

      {(step === 'details' || step === 'saving') && result && (
        <form className="catch-details" onSubmit={save}>
          {result.ok ? (
            <div className="cutout-preview"><img src={preview} alt="Your leaf, cut out" /></div>
          ) : (
            <div className="cutout-failed">
              <p>We couldn't separate the leaf from the background. A plain background works best.</p>
              <div className="row">
                <button type="button" className="button" onClick={() => camera.current.click()}>Try again</button>
                <button type="button" className="button secondary" onClick={usePhotoAnyway}>Use the photo as it is</button>
              </div>
            </div>
          )}

          <label>Which tree?
            <input list="trees-catch" value={tree.name} required maxLength={60} placeholder={ident.loading ? 'Identifying…' : 'e.g. Oak'}
              onChange={(e) => setTree({ name: e.target.value, scientific: '', confidence: null, source: 'user' })} />
          </label>
          <datalist id="trees-catch">{COMMON_TREES.map((t) => <option key={t} value={t} />)}</datalist>
          {ident.loading && <p className="muted">Looking it up…</p>}
          {!ident.loading && ident.suggestions?.length > 0 && (
            <div className="suggestions">
              <span className="muted">{ident.demo ? 'Sample guesses (the preview has no tree recognition).' : 'Our guesses.'} Tap one, or type your own if you know better:</span>
              <div className="chips">
                {ident.suggestions.map((s) => (
                  <button type="button" key={s.scientific || s.name} className={tree.name === s.name ? 'chip on' : 'chip'} onClick={() => pickTree(s)}>
                    {s.name} <small>{Math.round(s.score * 100)}%</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {!ident.loading && !ident.available && <p className="muted">Automatic identification isn't available right now, so type the tree yourself.</p>}
          {!ident.loading && ident.available && !ident.suggestions?.length && <p className="muted">We couldn't recognise this one. What do you think it is?</p>}

          <label>Caption
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={280} rows={3} placeholder="Snatched it right off the bus stop roof" />
          </label>
          <p className="muted small caught-at">
            Caught {formatDate(takenAt ? takenAt.date : new Date(), true)}
            {' · '}{takenAt?.source === 'photo' ? 'from the photo' : takenAt ? "from the photo file's date" : 'no time in the photo, so we use now'}
          </p>
          <ErrorNote error={error} />
          <button className="button big" disabled={!result.ok || step === 'saving'}>{step === 'saving' ? 'Saving…' : 'Save my leaf'}</button>
          <button type="button" className="link" onClick={() => { setStep('pick'); setResult(null); }}>Start over</button>
        </form>
      )}
    </div>
  );
}
