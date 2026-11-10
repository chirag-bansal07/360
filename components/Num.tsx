'use client';
import { useEffect, useState } from 'react';

// Number box that only passes on valid values and snaps back if left invalid.
export default function Num({ value, onCommit, min = -1e9, max = 1e9, step = 1, unit, int, className = 'einput' }: {
  value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number; unit?: string; int?: boolean; className?: string;
}) {
  const show = (n: number) => String(int ? Math.round(n) : Math.round(n * 1000) / 1000);
  const [text, setText] = useState(show(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(show(value)); }, [value, focus]);
  const parse = (t: string) => {
    const n = Number(t);
    if (t.trim() === '' || !isFinite(n)) return null;
    if (int && !Number.isInteger(n)) return null;
    if (n < min || n > max) return null;
    return n;
  };
  const bad = focus && parse(text) === null;
  return (
    <div className="wrap" title={bad ? `Enter a ${int ? 'whole ' : ''}number from ${min} to ${max}` : undefined}>
      <input className={`${className}${unit ? ' unit' : ''}${bad ? ' bad' : ''}`} type="number" inputMode="decimal" step={step} min={min} max={max} value={text}
        onFocus={() => setFocus(true)}
        onChange={(e) => { setText(e.target.value); const n = parse(e.target.value); if (n !== null && n !== value) onCommit(n); }}
        onBlur={() => { setFocus(false); setText(show(value)); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
      {unit && <em>{unit}</em>}
    </div>
  );
}
