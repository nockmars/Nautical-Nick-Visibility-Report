import React from 'react';

export function CheckItem({ label, xp, checked, onToggle, meta }) {
  return (
    <div className={`item ${checked ? 'done' : ''}`} onClick={onToggle}>
      <div className="item-main">
        <div className="item-label">{label}</div>
        <div className="item-meta">
          <span className={`xp-pill ${xp < 0 ? 'neg' : ''} mono`}>{xp >= 0 ? '+' : ''}{xp} XP</span>
          {meta && <span style={{ marginLeft: 6 }}>{meta}</span>}
        </div>
      </div>
      <div className={`checkbox ${checked ? 'checked' : ''}`} />
    </div>
  );
}

export function StackItem({ label, xpPer, unit, count, onInc, onDec, threshold }) {
  const thresholdMet = threshold && count >= threshold;
  return (
    <div className={`item ${thresholdMet ? 'done' : ''}`}>
      <div className="item-main">
        <div className="item-label">{label}</div>
        <div className="item-meta">
          <span className={`xp-pill ${xpPer < 0 ? 'neg' : ''} mono`}>{xpPer >= 0 ? '+' : ''}{xpPer} XP/{unit}</span>
          {threshold != null && (
            <span style={{ marginLeft: 6 }} className="mono">
              {count}/{threshold} {thresholdMet && <span className="threshold-ok">✓</span>}
            </span>
          )}
          {threshold == null && count > 0 && (
            <span style={{ marginLeft: 6 }} className="mono">· {count} {unit}</span>
          )}
        </div>
      </div>
      <div className="stack-controls">
        <button className="stack-btn minus" onClick={onDec} disabled={count <= 0} aria-label="decrement">−</button>
        <span className="stack-count mono">{count}</span>
        <button className="stack-btn plus" onClick={onInc} aria-label="increment">+</button>
      </div>
    </div>
  );
}

export function SectionHead({ color, title, sub }) {
  return (
    <div className="section-head" style={{ '--section-color': color }}>
      <span className="section-dot" />
      <span className="section-title">{title}</span>
      {sub && <span className="section-sub">{sub}</span>}
    </div>
  );
}
