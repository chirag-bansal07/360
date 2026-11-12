'use client';
import { useEffect, useState } from 'react';

export const ShareIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14" /></svg>
);

// Shows a link that can be copied or sent on. onOff (optional) turns the link off.
export default function ShareDialog({ title, url, text, note, onClose, onOff }: { title: string; url: string; text: string; note: string; onClose: () => void; onOff?: () => Promise<void> | void }) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.share); }, []);

  async function copy() {
    try { await navigator.clipboard.writeText(url); }
    catch { // older browsers, or the page is not allowed to use the clipboard
      const el = document.getElementById('share-url') as HTMLInputElement | null;
      el?.select(); document.execCommand('copy');
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(560px,100%)' }}>
        <div className="modal-head">{title}</div>
        <div className="modal-body">
          <div className="row" style={{ gap: 8 }}>
            <input id="share-url" className="input" readOnly value={url} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0 }} />
            <button className="btn primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <a className="btn sm" href={`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
            <a className="btn sm" href={`mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`}>Send by email</a>
            {canShare && <button className="btn sm" onClick={() => navigator.share({ title: text, url }).catch(() => {})}>More…</button>}
            <a className="btn sm" href={url} target="_blank" rel="noopener noreferrer">Open ↗</a>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>{note}</p>
          {local && <div className="note" style={{ marginTop: 8 }}>This app is running on this computer, so the link opens only here. Links made on the hosted site open for everyone.</div>}
        </div>
        <div className="modal-foot">
          {onOff && <button className="btn" style={{ marginRight: 'auto', color: 'var(--danger)' }} disabled={busy} onClick={async () => { setBusy(true); await onOff(); setBusy(false); }}>Turn off link</button>}
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
