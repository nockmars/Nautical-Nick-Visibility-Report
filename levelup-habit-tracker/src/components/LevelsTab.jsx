import React from 'react';
import {
  CATEGORIES, BRACKETS, LEVELS_PER_BRACKET,
  bracketStartXp, getLevel
} from '../data/config.js';

export default function LevelsTab({ xp, onReset }) {
  return (
    <div className="section">
      {CATEGORIES.map(cat => {
        const catXp = xp[cat.id] || 0;
        const { level, tier, progress, currentLevelStart, nextLevelStart, xpPerLevel } = getLevel(catXp);
        const toNext = nextLevelStart - catXp;
        return (
          <div key={cat.id} className="level-card">
            <div className="level-card-head">
              <span className="level-card-icon">{cat.icon}</span>
              <span className="level-card-name">{cat.name}</span>
              <span className="level-card-tier" style={{ color: tier.color, borderColor: tier.color }}>
                {tier.name}
              </span>
            </div>
            <div className="level-card-xp-row">
              <div>
                <div className="level-card-level mono">Lv {level}</div>
                <div className="level-card-next mono">{catXp.toLocaleString()} XP total</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="level-card-next mono">{toNext} XP → Lv {level + 1}</div>
                <div className="level-card-next mono" style={{ opacity: 0.6 }}>
                  {xpPerLevel} XP/lvl
                </div>
              </div>
            </div>
            <div className="level-card-bar">
              <div className="level-card-bar-inner"
                style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${tier.color} 0%, ${tier.color}99 100%)` }} />
            </div>
          </div>
        );
      })}

      <h3 style={{ margin: '24px 4px 10px', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-2)' }}>
        Tier thresholds
      </h3>
      <div className="threshold-table">
        {BRACKETS.map((b, i) => {
          const startLvl = i * LEVELS_PER_BRACKET + 1;
          const endLvl = (i + 1) * LEVELS_PER_BRACKET;
          return (
            <div key={b.name} className="threshold-row">
              <span className="threshold-name" style={{ color: b.color }}>{b.name}</span>
              <span className="threshold-xp mono">
                Lv {startLvl}–{endLvl} · {bracketStartXp(i).toLocaleString()} XP
              </span>
            </div>
          );
        })}
        <div className="threshold-row">
          <span className="threshold-name" style={{ color: '#c084fc' }}>Prestige 1+</span>
          <span className="threshold-xp mono">
            Lv {BRACKETS.length * LEVELS_PER_BRACKET + 1}+ · +200 XP/lvl each prestige
          </span>
        </div>
      </div>
      <p className="hint">Every 10 levels = new tier. After Legend (Lv 80), tiers become Prestige 1, 2, 3… forever.</p>

      <button className="danger-btn" onClick={onReset}>Reset all data</button>
    </div>
  );
}
