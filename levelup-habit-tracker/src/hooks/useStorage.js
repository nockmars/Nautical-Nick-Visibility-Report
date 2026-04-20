import { useState, useEffect, useCallback } from 'react';

const KEY = 'levelup_habit_tracker_v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function useStorage(initial) {
  const [state, setState] = useState(() => loadState() || initial);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const update = useCallback((updater) => {
    setState((prev) => (typeof updater === 'function' ? updater(prev) : updater));
  }, []);

  return [state, update];
}
