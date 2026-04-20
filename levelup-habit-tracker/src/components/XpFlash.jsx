import React from 'react';

export default function XpFlash({ flashes }) {
  return (
    <div className="xp-flash-wrap">
      {flashes.map((f) => (
        <div key={f.id} className={`xp-flash ${f.amount >= 0 ? 'gain' : 'loss'} mono`}>
          {f.amount >= 0 ? '+' : ''}{f.amount} XP
          {f.category && <span className="xp-flash-cat"> · {f.category}</span>}
        </div>
      ))}
    </div>
  );
}
