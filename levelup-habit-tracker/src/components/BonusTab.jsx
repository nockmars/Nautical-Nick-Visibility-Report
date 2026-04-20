import React from 'react';
import { CheckItem, StackItem, SectionHead } from './Items.jsx';
import {
  CATEGORIES,
  BONUS_FITNESS_STACK, BONUS_FITNESS_CHECK,
  BONUS_CONTENT_STACK, BONUS_CONTENT_CHECK,
  BONUS_NUTRITION_STACK, BONUS_AI_STACK,
  BONUS_MILESTONES
} from '../data/config.js';

const catColor = (id) => CATEGORIES.find(c => c.id === id).color;

export default function BonusTab({ bonus, daily, onStackInc, onStackDec, onToggleCheck, onMilestone }) {
  const stacks = bonus.stacks || {};
  const checks = bonus.checks || {};
  const milestones = daily.milestones || {};

  return (
    <div className="section">
      <SectionHead color={catColor('fitness')} title="Fitness Bonus" />
      {BONUS_FITNESS_STACK.map(s => (
        <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
          count={stacks[s.id] || 0}
          onInc={() => onStackInc('bonus', s.id, s.xpPer, 'fitness')}
          onDec={() => onStackDec('bonus', s.id, s.xpPer, 'fitness')} />
      ))}
      {BONUS_FITNESS_CHECK.map(c => (
        <CheckItem key={c.id} label={c.label} xp={c.xp}
          checked={!!checks[c.id]}
          onToggle={() => onToggleCheck('bonus', c.id, c.xp, 'fitness')} />
      ))}

      <SectionHead color={catColor('content')} title="Content" />
      {BONUS_CONTENT_STACK.map(s => (
        <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
          count={stacks[s.id] || 0}
          onInc={() => onStackInc('bonus', s.id, s.xpPer, 'content')}
          onDec={() => onStackDec('bonus', s.id, s.xpPer, 'content')} />
      ))}
      {BONUS_CONTENT_CHECK.map(c => (
        <CheckItem key={c.id} label={c.label} xp={c.xp}
          checked={!!checks[c.id]}
          onToggle={() => onToggleCheck('bonus', c.id, c.xp, 'content')} />
      ))}

      <SectionHead color={catColor('nutrition')} title="Nutrition Bonus" />
      {BONUS_NUTRITION_STACK.map(s => (
        <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
          count={stacks[s.id] || 0}
          onInc={() => onStackInc('bonus', s.id, s.xpPer, 'nutrition')}
          onDec={() => onStackDec('bonus', s.id, s.xpPer, 'nutrition')} />
      ))}

      <SectionHead color={catColor('ai')} title="AI Work" />
      {BONUS_AI_STACK.map(s => (
        <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
          count={stacks[s.id] || 0}
          onInc={() => onStackInc('bonus', s.id, s.xpPer, 'ai')}
          onDec={() => onStackDec('bonus', s.id, s.xpPer, 'ai')} />
      ))}

      <SectionHead color={catColor('content')} title="Milestones" sub="once per day" />
      {BONUS_MILESTONES.map(m => (
        <div key={m.id} className={`item ${milestones[m.id] ? 'done' : ''}`}>
          <div className="item-main">
            <div className="item-label">{m.label}</div>
            <div className="item-meta">
              <span className="xp-pill mono">+{m.xp} XP</span>
            </div>
          </div>
          <button className={`claim-btn ${milestones[m.id] ? 'active' : ''}`}
            onClick={() => onMilestone(m.id, m.xp, m.category)}>
            {milestones[m.id] ? 'Claimed' : 'Claim'}
          </button>
        </div>
      ))}
    </div>
  );
}
