import React from 'react';
import { CheckItem, SectionHead } from './Items.jsx';
import { WEEKLY_ITEMS, CATEGORIES } from '../data/config.js';

const catColor = (id) => CATEGORIES.find(c => c.id === id).color;

export default function WeeklyTab({ weekly, onToggle }) {
  const checks = weekly.checks || {};
  return (
    <div className="section">
      <SectionHead color={catColor('hygiene')} title="This Week" sub="resets weekly" />
      {WEEKLY_ITEMS.map(w => (
        <CheckItem key={w.id} label={w.label} xp={w.xp}
          checked={!!checks[w.id]}
          onToggle={() => onToggle(w.id, w.xp, w.category)} />
      ))}
      <p className="hint">Weekly items auto-reset each week.</p>
    </div>
  );
}
