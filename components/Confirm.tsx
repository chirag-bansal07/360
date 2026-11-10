'use client';

export default function Confirm({ title, text, action, onYes, onNo }: { title: string; text: string; action: string; onYes: () => void; onNo: () => void }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div className="modal narrow" style={{ color: 'var(--ink)' }}>
        <div className="modal-head">{title}</div>
        <div className="modal-body">{text}</div>
        <div className="modal-foot">
          <button className="btn" onClick={onNo} autoFocus>Cancel</button>
          <button className="btn danger" onClick={onYes}>{action}</button>
        </div>
      </div>
    </div>
  );
}
