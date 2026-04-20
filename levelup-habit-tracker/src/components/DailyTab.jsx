import React, { useMemo } from 'react';
import { CheckItem, StackItem, SectionHead } from './Items.jsx';
import {
  CATEGORIES,
  DAILY_HYGIENE, DAILY_FITNESS_CHECK, DAILY_FITNESS_STACK,
  DAILY_NUTRITION_STACK, DAILY_NUTRITION_CHECK,
  DAILY_DISCIPLINE_CHECK, DAILY_DISCIPLINE_STACK,
  DAILY_PT_ESSENTIAL, DAILY_PT_BONUS, BEDTIME_OPTIONS,
  DAILY_PENALTIES, DAILY_BONUS_CLAIMS, ESSENTIALS
} from '../data/config.js';

const catColor = (id) => CATEGORIES.find(c => c.id === id).color;

export default function DailyTab({ daily, onToggleCheck, onStackInc, onStackDec, onBedtime, onClaim, onCloseDay, closed }) {
  const checks = daily.checks || {};
  const stacks = daily.stacks || {};
  const claims = daily.claims || {};

  const fitnessThresholdMet = DAILY_FITNESS_STACK.some(s => (stacks[s.id] || 0) >= s.threshold);

  const essentialsStatus = useMemo(() => {
    const status = {};
    status.ess_brush_am   = !!checks.brush_am;
    status.ess_brush_pm   = !!checks.brush_pm;
    status.ess_floss      = !!checks.floss;
    status.ess_shower     = !!checks.shower;
    status.ess_skincare   = !!checks.skincare;
    status.ess_plank      = !!checks.plank;
    status.ess_fitness    = fitnessThresholdMet;
    status.ess_veggies    = (stacks.veggies || 0) >= 1;
    status.ess_protein    = (stacks.protein || 0) >= 1;
    status.ess_water      = (stacks.water   || 0) >= 3;
    status.ess_supplements= !!checks.supplements;
    status.ess_duolingo   = !!checks.duolingo;
    status.ess_learning   = (stacks.learning|| 0) >= 1;
    status.ess_breathing  = !!checks.breathing;
    status.ess_deadbugs   = !!checks.deadbugs;
    status.ess_scap_ws    = !!checks.scap_ws;
    status.ess_glutes     = !!checks.glutes;
    return status;
  }, [checks, stacks, fitnessThresholdMet]);

  const metCount = Object.values(essentialsStatus).filter(Boolean).length;
  const totalEss = ESSENTIALS.length;
  const pct = Math.round((metCount / totalEss) * 100);

  return (
    <>
      <div className="essentials-bar">
        <div className="essentials-row">
          <span className="essentials-title">Essentials</span>
          <span className="essentials-pct mono">{metCount}/{totalEss} · {pct}%</span>
        </div>
        <div className="essentials-bar-track">
          <div className="essentials-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="section">
        <SectionHead color={catColor('hygiene')} title="Hygiene" />
        {DAILY_HYGIENE.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'hygiene')} />
        ))}

        <SectionHead color={catColor('fitness')} title="Fitness"
          sub={fitnessThresholdMet ? 'threshold ✓' : 'need 1 threshold'} />
        {DAILY_FITNESS_CHECK.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'fitness')} />
        ))}
        {DAILY_FITNESS_STACK.map(s => (
          <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
            count={stacks[s.id] || 0} threshold={s.threshold}
            onInc={() => onStackInc(s.id, s.xpPer, 'fitness')}
            onDec={() => onStackDec(s.id, s.xpPer, 'fitness')} />
        ))}

        <SectionHead color={catColor('nutrition')} title="Nutrition" />
        {DAILY_NUTRITION_STACK.map(s => (
          <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
            count={stacks[s.id] || 0} threshold={s.threshold}
            onInc={() => onStackInc(s.id, s.xpPer, 'nutrition')}
            onDec={() => onStackDec(s.id, s.xpPer, 'nutrition')} />
        ))}
        {DAILY_NUTRITION_CHECK.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'nutrition')} />
        ))}

        <SectionHead color={catColor('discipline')} title="Discipline" />
        {DAILY_DISCIPLINE_CHECK.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'discipline')} />
        ))}
        {DAILY_DISCIPLINE_STACK.map(s => (
          <StackItem key={s.id} label={s.label} xpPer={s.xpPer} unit={s.unit}
            count={stacks[s.id] || 0} threshold={s.threshold}
            onInc={() => onStackInc(s.id, s.xpPer, 'discipline')}
            onDec={() => onStackDec(s.id, s.xpPer, 'discipline')} />
        ))}

        <SectionHead color={catColor('pt')} title="Physical Therapy" />
        {DAILY_PT_ESSENTIAL.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'pt')} />
        ))}
        <SectionHead color={catColor('pt')} title="PT Bonus" sub="not essential" />
        {DAILY_PT_BONUS.map(h => (
          <CheckItem key={h.id} label={h.label} xp={h.xp}
            checked={!!checks[h.id]} onToggle={() => onToggleCheck(h.id, h.xp, 'pt')} />
        ))}

        <SectionHead color={catColor('discipline')} title="Bedtime" sub="pick one" />
        <div className="bedtime">
          {BEDTIME_OPTIONS.map(opt => (
            <div key={opt.id}
              className={`bedtime-opt ${daily.bedtime === opt.id ? 'active' : ''}`}
              onClick={() => onBedtime(opt.id, opt.xp)}>
              <div className="bedtime-label">{opt.label}</div>
              <div className="bedtime-xp mono">+{opt.xp} XP</div>
            </div>
          ))}
        </div>

        <SectionHead color="#f87171" title="Penalties & Bonuses" />
        {DAILY_PENALTIES.map(p => (
          <StackItem key={p.id} label={p.label} xpPer={p.xpPer} unit={p.unit}
            count={stacks[p.id] || 0}
            onInc={() => onStackInc(p.id, p.xpPer, p.category)}
            onDec={() => onStackDec(p.id, p.xpPer, p.category)} />
        ))}
        {DAILY_BONUS_CLAIMS.map(c => (
          <div key={c.id} className={`item ${claims[c.id] ? 'done' : ''}`}>
            <div className="item-main">
              <div className="item-label">{c.label}</div>
              <div className="item-meta">
                <span className="xp-pill mono">+{c.xp} XP</span>
              </div>
            </div>
            <button className={`claim-btn ${claims[c.id] ? 'active' : ''}`}
              onClick={() => onClaim(c.id, c.xp, c.category)}>
              {claims[c.id] ? 'Claimed' : 'Claim'}
            </button>
          </div>
        ))}

        <button className="close-day" onClick={onCloseDay} disabled={closed}>
          {closed ? 'Day closed ✓' : 'Close day (apply −5 XP per missed essential)'}
        </button>
        <p className="hint">
          Closing the day applies a −5 XP penalty to each missed essential's category. Fires once per day.
        </p>
      </div>
    </>
  );
}
