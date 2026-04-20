import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useStorage } from './hooks/useStorage.js';
import {
  CATEGORIES, getLevel, todayKey, weekKey, ESSENTIALS,
  DAILY_FITNESS_STACK, shiftDate, formatDate
} from './data/config.js';
import XpFlash from './components/XpFlash.jsx';
import DailyTab from './components/DailyTab.jsx';
import BonusTab from './components/BonusTab.jsx';
import WeeklyTab from './components/WeeklyTab.jsx';
import LevelsTab from './components/LevelsTab.jsx';

const CATEGORY_NAMES = Object.fromEntries(CATEGORIES.map(c => [c.id, c.name]));

const emptyDay = () => ({ checks: {}, stacks: {}, claims: {}, bedtime: null, closed: false, milestones: {} });
const emptyBonus = () => ({ stacks: {}, checks: {} });

const INITIAL = {
  xp: { hygiene: 0, fitness: 0, nutrition: 0, discipline: 0, content: 0, ai: 0, pt: 0 },
  viewDate: todayKey(),
  days: { [todayKey()]: emptyDay() },
  bonusDays: { [todayKey()]: emptyBonus() },
  week: { week: weekKey(), checks: {} }
};

export default function App() {
  const [state, setState] = useStorage(INITIAL);
  const [tab, setTab] = useState('daily');
  const [flashes, setFlashes] = useState([]);
  const flashId = useRef(0);

  // Migration + rollover on load.
  useEffect(() => {
    setState(prev => {
      let next = { ...prev };

      // Migrate old shape: { today, bonus } -> { days, bonusDays, viewDate }
      if (prev.today && !prev.days) {
        const d = prev.today.date || todayKey();
        next.days = {
          [d]: {
            checks: prev.today.checks || {},
            stacks: prev.today.stacks || {},
            claims: prev.today.claims || {},
            bedtime: prev.today.bedtime || null,
            closed: !!prev.today.closed,
            milestones: prev.today.milestones || {}
          }
        };
        next.bonusDays = prev.bonus
          ? { [prev.bonus.date || d]: { stacks: prev.bonus.stacks || {}, checks: prev.bonus.checks || {} } }
          : {};
        delete next.today;
        delete next.bonus;
      }

      if (!next.days) next.days = {};
      if (!next.bonusDays) next.bonusDays = {};
      if (!next.viewDate) next.viewDate = todayKey();

      const tk = todayKey();
      if (!next.days[tk]) next.days = { ...next.days, [tk]: emptyDay() };
      if (!next.bonusDays[tk]) next.bonusDays = { ...next.bonusDays, [tk]: emptyBonus() };

      if (!next.week || next.week.week !== weekKey()) {
        next.week = { week: weekKey(), checks: {} };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const viewDate = state.viewDate || todayKey();
  const days = state.days || {};
  const bonusDays = state.bonusDays || {};
  const day = days[viewDate] || emptyDay();
  const bonusDay = bonusDays[viewDate] || emptyBonus();

  const setViewDate = useCallback((date) => {
    setState(prev => {
      const next = { ...prev, viewDate: date };
      if (!next.days[date])     next.days = { ...next.days, [date]: emptyDay() };
      if (!next.bonusDays[date]) next.bonusDays = { ...next.bonusDays, [date]: emptyBonus() };
      return next;
    });
  }, [setState]);

  const pushFlash = useCallback((amount, category) => {
    const id = ++flashId.current;
    const catName = category ? CATEGORY_NAMES[category] : null;
    setFlashes(f => [...f, { id, amount, category: catName }]);
    setTimeout(() => setFlashes(f => f.filter(x => x.id !== id)), 1200);
  }, []);

  // Helpers to update the currently-viewed day/bonus.
  const updateDay = (prev, d, patch) => ({
    ...prev,
    days: { ...prev.days, [d]: { ...(prev.days[d] || emptyDay()), ...patch } }
  });
  const updateBonusDay = (prev, d, patch) => ({
    ...prev,
    bonusDays: { ...prev.bonusDays, [d]: { ...(prev.bonusDays[d] || emptyBonus()), ...patch } }
  });

  // ==== DAILY HANDLERS ====
  const toggleCheckAtomic = useCallback((key, xp, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      const wasChecked = !!cur.checks[key];
      const amount = wasChecked ? -xp : xp;
      const newXp = { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + amount) };
      pushFlash(amount, category);
      return { ...updateDay(prev, d, { checks: { ...cur.checks, [key]: !wasChecked } }), xp: newXp };
    });
  }, [setState, pushFlash]);

  const stackInc = useCallback((key, xpPer, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      const count = cur.stacks[key] || 0;
      const newXp = { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + xpPer) };
      pushFlash(xpPer, category);
      return { ...updateDay(prev, d, { stacks: { ...cur.stacks, [key]: count + 1 } }), xp: newXp };
    });
  }, [setState, pushFlash]);

  const stackDec = useCallback((key, xpPer, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      const count = cur.stacks[key] || 0;
      if (count <= 0) return prev;
      const newXp = { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) - xpPer) };
      pushFlash(-xpPer, category);
      return { ...updateDay(prev, d, { stacks: { ...cur.stacks, [key]: count - 1 } }), xp: newXp };
    });
  }, [setState, pushFlash]);

  const onBedtime = useCallback((id, xp) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      const prevId = cur.bedtime;
      const BEDTIME_VALUES = { early: 30, normal: 12, late: 0 };
      const prevXp = prevId ? (BEDTIME_VALUES[prevId] || 0) : 0;
      const delta = xp - prevXp;
      const newXp = { ...prev.xp, discipline: Math.max(0, (prev.xp.discipline || 0) + delta) };
      if (delta !== 0) pushFlash(delta, 'discipline');
      return { ...updateDay(prev, d, { bedtime: id }), xp: newXp };
    });
  }, [setState, pushFlash]);

  const onClaim = useCallback((id, xp, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      if (cur.claims[id]) return prev;
      const newXp = { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + xp) };
      pushFlash(xp, category);
      return { ...updateDay(prev, d, { claims: { ...cur.claims, [id]: true } }), xp: newXp };
    });
  }, [setState, pushFlash]);

  const onCloseDay = useCallback(() => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      if (cur.closed) return prev;
      const checks = cur.checks;
      const stacks = cur.stacks;
      const status = {};
      status.ess_brush_am    = !!checks.brush_am;
      status.ess_brush_pm    = !!checks.brush_pm;
      status.ess_floss       = !!checks.floss;
      status.ess_shower      = !!checks.shower;
      status.ess_skincare    = !!checks.skincare;
      status.ess_plank       = !!checks.plank;
      status.ess_fitness     = DAILY_FITNESS_STACK.some(s => (stacks[s.id] || 0) >= s.threshold);
      status.ess_veggies     = (stacks.veggies || 0) >= 1;
      status.ess_protein     = (stacks.protein || 0) >= 1;
      status.ess_water       = (stacks.water   || 0) >= 3;
      status.ess_supplements = !!checks.supplements;
      status.ess_duolingo    = !!checks.duolingo;
      status.ess_learning    = (stacks.learning || 0) >= 1;
      status.ess_breathing   = !!checks.breathing;
      status.ess_deadbugs    = !!checks.deadbugs;
      status.ess_scap_ws     = !!checks.scap_ws;
      status.ess_glutes      = !!checks.glutes;

      const penalties = {};
      let totalPenalty = 0;
      for (const ess of ESSENTIALS) {
        if (!status[ess.id]) {
          penalties[ess.category] = (penalties[ess.category] || 0) - 5;
          totalPenalty += 5;
        }
      }
      const newXp = { ...prev.xp };
      for (const cat in penalties) newXp[cat] = Math.max(0, (newXp[cat] || 0) + penalties[cat]);
      if (totalPenalty > 0) setTimeout(() => pushFlash(-totalPenalty, null), 0);
      return { ...updateDay(prev, d, { closed: true }), xp: newXp };
    });
  }, [setState, pushFlash]);

  // ==== BONUS HANDLERS ====
  const bonusStackInc = useCallback((_scope, key, xpPer, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.bonusDays[d] || emptyBonus();
      const count = cur.stacks[key] || 0;
      pushFlash(xpPer, category);
      return {
        ...updateBonusDay(prev, d, { stacks: { ...cur.stacks, [key]: count + 1 } }),
        xp: { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + xpPer) }
      };
    });
  }, [setState, pushFlash]);

  const bonusStackDec = useCallback((_scope, key, xpPer, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.bonusDays[d] || emptyBonus();
      const count = cur.stacks[key] || 0;
      if (count <= 0) return prev;
      pushFlash(-xpPer, category);
      return {
        ...updateBonusDay(prev, d, { stacks: { ...cur.stacks, [key]: count - 1 } }),
        xp: { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) - xpPer) }
      };
    });
  }, [setState, pushFlash]);

  const bonusCheckToggle = useCallback((_scope, key, xp, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.bonusDays[d] || emptyBonus();
      const was = !!cur.checks[key];
      const amt = was ? -xp : xp;
      pushFlash(amt, category);
      return {
        ...updateBonusDay(prev, d, { checks: { ...cur.checks, [key]: !was } }),
        xp: { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + amt) }
      };
    });
  }, [setState, pushFlash]);

  const onMilestone = useCallback((id, xp, category) => {
    setState(prev => {
      const d = prev.viewDate;
      const cur = prev.days[d] || emptyDay();
      if (cur.milestones[id]) return prev;
      pushFlash(xp, category);
      return {
        ...updateDay(prev, d, { milestones: { ...cur.milestones, [id]: true } }),
        xp: { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + xp) }
      };
    });
  }, [setState, pushFlash]);

  // ==== WEEKLY ====
  const weeklyToggle = useCallback((id, xp, category) => {
    setState(prev => {
      const was = !!prev.week.checks[id];
      const amt = was ? -xp : xp;
      pushFlash(amt, category);
      return {
        ...prev,
        xp: { ...prev.xp, [category]: Math.max(0, (prev.xp[category] || 0) + amt) },
        week: { ...prev.week, checks: { ...prev.week.checks, [id]: !was } }
      };
    });
  }, [setState, pushFlash]);

  // ==== RESET ====
  const onReset = useCallback(() => {
    if (!confirm('Reset ALL data? This cannot be undone.')) return;
    setState({
      xp: { hygiene: 0, fitness: 0, nutrition: 0, discipline: 0, content: 0, ai: 0, pt: 0 },
      viewDate: todayKey(),
      days: { [todayKey()]: emptyDay() },
      bonusDays: { [todayKey()]: emptyBonus() },
      week: { week: weekKey(), checks: {} }
    });
  }, [setState]);

  const totalXp = Object.values(state.xp).reduce((a, b) => a + b, 0);
  const overall = getLevel(totalXp);

  return (
    <div className="app">
      <XpFlash flashes={flashes} />

      <div className="top-bar">
        <button
          className="top-nav-btn rust left"
          onClick={() => setViewDate(shiftDate(viewDate, -1))}
          aria-label="previous day"
        >◀</button>
        <div className="top-bar-center">
          <div className="hero-brand">Level<span>Up</span></div>
          <div className="top-date">
            <span className="top-date-text">{formatDate(viewDate)}</span>
            {viewDate !== todayKey() && (
              <button className="top-date-today rust" onClick={() => setViewDate(todayKey())}>Back to Today</button>
            )}
          </div>
          {viewDate !== todayKey() && (
            <div className="top-date-badge rust">Editing past day</div>
          )}
        </div>
        <button
          className="top-nav-btn rust right"
          onClick={() => setViewDate(shiftDate(viewDate, 1))}
          disabled={viewDate === todayKey()}
          aria-label="next day"
        >▶</button>
      </div>

      <div className="hero">
        <div className="hero-card">
          <div className="hero-row">
            <div>
              <div className="hero-label">Level</div>
              <div className="hero-level">
                <span className="mono">Lv {overall.level}</span>
                <span className="hero-tier" style={{ color: overall.tier.color }}> · {overall.tier.name}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="hero-label">Total XP</div>
              <div className="hero-xp mono">
                {totalXp.toLocaleString()}
                <span className="hero-xp-small">XP</span>
              </div>
            </div>
          </div>
          <div className="progress-outer">
            <div className="progress-inner" style={{ width: `${overall.progress}%` }} />
          </div>
          <div className="progress-labels mono">
            <span>Lv {overall.level}</span>
            <span>{overall.nextLevelStart.toLocaleString()} XP → Lv {overall.level + 1}</span>
          </div>
        </div>
      </div>

      <div className="cats">
        {CATEGORIES.map(cat => {
          const catXp = state.xp[cat.id] || 0;
          const { level, tier, progress } = getLevel(catXp);
          return (
            <div key={cat.id} className="cat-mini" style={{ '--cat-color': cat.color }}>
              <div className="cat-mini-head">
                <span className="cat-mini-icon">{cat.icon}</span>
                <span className="cat-mini-name">{cat.name}</span>
              </div>
              <div className="cat-mini-stats">
                <span className="cat-mini-xp mono">Lv {level}</span>
                <span className="cat-mini-level" style={{ color: tier.color }}>{tier.name}</span>
              </div>
              <div className="cat-mini-bar">
                <div className="cat-mini-bar-inner" style={{ width: `${progress}%` }} />
              </div>
              <div className="cat-mini-sub mono">{catXp.toLocaleString()} XP</div>
            </div>
          );
        })}
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'daily' ? 'active' : ''}`}  onClick={() => setTab('daily')}>Daily</button>
        <button className={`tab ${tab === 'bonus' ? 'active' : ''}`}  onClick={() => setTab('bonus')}>Bonus</button>
        <button className={`tab ${tab === 'weekly' ? 'active' : ''}`} onClick={() => setTab('weekly')}>Weekly</button>
        <button className={`tab ${tab === 'levels' ? 'active' : ''}`} onClick={() => setTab('levels')}>Levels</button>
      </div>

      {tab === 'daily' && (
        <DailyTab
          daily={day}
          onToggleCheck={toggleCheckAtomic}
          onStackInc={stackInc}
          onStackDec={stackDec}
          onBedtime={onBedtime}
          onClaim={onClaim}
          onCloseDay={onCloseDay}
          closed={day.closed}
        />
      )}
      {tab === 'bonus' && (
        <BonusTab
          bonus={bonusDay}
          daily={day}
          onStackInc={bonusStackInc}
          onStackDec={bonusStackDec}
          onToggleCheck={bonusCheckToggle}
          onMilestone={onMilestone}
        />
      )}
      {tab === 'weekly' && (
        <WeeklyTab weekly={state.week} onToggle={weeklyToggle} />
      )}
      {tab === 'levels' && (
        <LevelsTab xp={state.xp} onReset={onReset} />
      )}
    </div>
  );
}
