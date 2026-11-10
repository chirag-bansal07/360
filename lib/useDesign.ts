'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './client';
import { allModules } from './catalog';
import { designSignature } from './geometry';
import type { Design, Project, Results, Settings } from './types';

// Loads one design with its project and settings.
export function useDesign(id: string) {
  const [design, setDesign] = useState<Design | null>(null);
  const [project, setProject] = useState<Omit<Project, 'designs'> | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [calcBusy, setCalcBusy] = useState(false);
  const [calcError, setCalcError] = useState('');

  useEffect(() => {
    api(`/api/designs/${id}`).then((r) => { setDesign(r.design); setProject(r.project); setSettings(r.settings); }).catch((e) => setError(e.message));
  }, [id]);

  const mods = useMemo(() => allModules(settings), [settings]);
  const stale = !!design?.results && design.results.signature !== designSignature(design);

  // beforeCalc lets the editor finish saving first
  const calculate = useCallback(async (beforeCalc?: () => Promise<void>) => {
    setCalcBusy(true); setCalcError('');
    try {
      if (beforeCalc) await beforeCalc();
      const r = await api<{ results: Results }>(`/api/designs/${id}/calculate`, 'POST');
      setDesign((d) => (d ? { ...d, results: r.results } : d));
      return r.results;
    } catch (e: any) { setCalcError(e.message); return null; } finally { setCalcBusy(false); }
  }, [id]);

  return { design, setDesign, project, settings, mods, error, stale, calculate, calcBusy, calcError };
}
