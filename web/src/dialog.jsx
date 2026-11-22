import { useEffect, useState } from 'react';

// In-page confirm and password dialogs (browser alert/confirm/prompt look out of place and are
// blocked inside some embedded views).
let show = null;

export function ask({ message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, password = false, info = false }) {
  return new Promise((resolve) => {
    if (!show) { resolve(password ? null : true); return; }
    show({ message, confirmLabel, cancelLabel: info ? null : cancelLabel, danger, password, resolve });
  });
}
export const tell = (message) => ask({ message, info: true });

export function DialogHost() {
  const [d, setD] = useState(null);
  const [value, setValue] = useState('');
  useEffect(() => { show = (x) => { setValue(''); setD(x); }; return () => { show = null; }; }, []);
  if (!d) return null;
  const close = (ok) => { d.resolve(d.password ? (ok ? value : null) : ok); setD(null); };
  return (
    <div className="modal dialog-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="dialog-msg">
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); close(true); }}>
        <p id="dialog-msg">{d.message}</p>
        {d.password && (
          <input id="dialog-password" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Password" required />
        )}
        <div className="row dialog-actions">
          {d.cancelLabel && <button type="button" className="button secondary" onClick={() => close(false)}>{d.cancelLabel}</button>}
          <button className={`button ${d.danger ? 'danger-button' : ''}`} autoFocus={!d.password}>{d.confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
