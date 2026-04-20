export const CATEGORIES = [
  { id: 'hygiene',  name: 'Hygiene',          color: '#4ecdc4', icon: '🧼' },
  { id: 'fitness',  name: 'Fitness',          color: '#ff6b6b', icon: '💪' },
  { id: 'nutrition',name: 'Nutrition',        color: '#95e1a3', icon: '🥗' },
  { id: 'discipline',name:'Discipline',       color: '#a78bfa', icon: '🧠' },
  { id: 'content',  name: 'Content',          color: '#fbbf24', icon: '🎬' },
  { id: 'ai',       name: 'AI Work',          color: '#22d3ee', icon: '🤖' },
  { id: 'pt',       name: 'Physical Therapy', color: '#60a5fa', icon: '🩺' }
];

export const LEVELS_PER_BRACKET = 10;

// Named brackets. Each spans LEVELS_PER_BRACKET levels with a flat XP/level cost.
// XP to complete the bracket = xpPerLevel * LEVELS_PER_BRACKET.
// Rookie   L1–10   30 xp/lvl  (0–300)
// Bronze   L11–20  50 xp/lvl  (300–800)
// Silver   L21–30  100 xp/lvl (800–1800)
// Gold     L31–40  170 xp/lvl (1800–3500)
// Platinum L41–50  250 xp/lvl (3500–6000)
// Diamond  L51–60  400 xp/lvl (6000–10000)
// Master   L61–70  600 xp/lvl (10000–16000)
// Legend   L71–80  800 xp/lvl (16000–24000)
// After Legend: Prestige 1, 2, 3, ... (1000 xp/lvl, +200 per prestige)
export const BRACKETS = [
  { name: 'Rookie',   color: '#9ca3af', xpPerLevel: 30  },
  { name: 'Bronze',   color: '#cd7f32', xpPerLevel: 50  },
  { name: 'Silver',   color: '#c0c0c0', xpPerLevel: 100 },
  { name: 'Gold',     color: '#ffd700', xpPerLevel: 170 },
  { name: 'Platinum', color: '#e5e4e2', xpPerLevel: 250 },
  { name: 'Diamond',  color: '#b9f2ff', xpPerLevel: 400 },
  { name: 'Master',   color: '#ff6ad5', xpPerLevel: 600 },
  { name: 'Legend',   color: '#ff3131', xpPerLevel: 800 }
];

const PRESTIGE_BASE = 1000;
const PRESTIGE_STEP = 200;
const PRESTIGE_COLORS = ['#c084fc', '#f472b6', '#fb7185', '#fbbf24', '#34d399', '#60a5fa'];

export function bracketAt(index) {
  if (index < BRACKETS.length) return BRACKETS[index];
  const p = index - BRACKETS.length + 1;
  return {
    name: `Prestige ${p}`,
    color: PRESTIGE_COLORS[(p - 1) % PRESTIGE_COLORS.length],
    xpPerLevel: PRESTIGE_BASE + PRESTIGE_STEP * (p - 1),
    prestige: p
  };
}

export function bracketStartXp(index) {
  let xp = 0;
  for (let i = 0; i < index; i++) xp += bracketAt(i).xpPerLevel * LEVELS_PER_BRACKET;
  return xp;
}

export function getLevel(xp) {
  let bracketIdx = 0;
  let used = 0;
  // Walk forward one bracket at a time.
  while (true) {
    const b = bracketAt(bracketIdx);
    const bracketXp = b.xpPerLevel * LEVELS_PER_BRACKET;
    if (xp < used + bracketXp) break;
    used += bracketXp;
    bracketIdx++;
    if (bracketIdx > 1000) break; // safety
  }
  const bracket = bracketAt(bracketIdx);
  const xpIntoBracket = xp - used;
  const levelsInto = Math.floor(xpIntoBracket / bracket.xpPerLevel);
  const level = bracketIdx * LEVELS_PER_BRACKET + levelsInto + 1;
  const currentLevelStart = used + levelsInto * bracket.xpPerLevel;
  const nextLevelStart = currentLevelStart + bracket.xpPerLevel;
  const progress = ((xp - currentLevelStart) / bracket.xpPerLevel) * 100;
  return {
    level,
    tier: { name: bracket.name, color: bracket.color },
    xpPerLevel: bracket.xpPerLevel,
    currentLevelStart,
    nextLevelStart,
    progress
  };
}

// DAILY ESSENTIALS
// Each essential, when not met at close day, subtracts 5 XP from its category.
export const DAILY_HYGIENE = [
  { id: 'brush_am',  label: 'Brush teeth (morning)',   xp: 10 },
  { id: 'brush_pm',  label: 'Brush teeth (night)',     xp: 10 },
  { id: 'floss',     label: 'Floss at night',          xp: 10 },
  { id: 'shower',    label: 'Shower',                  xp: 10 },
  { id: 'skincare',  label: 'Skincare routine (night)',xp: 10 }
];

export const DAILY_FITNESS_CHECK = [
  { id: 'plank', label: 'Plank', xp: 15 }
];

export const DAILY_FITNESS_STACK = [
  { id: 'gym',      label: 'Gym',      xpPer: 20, unit: 'hr',      threshold: 2 },
  { id: 'running',  label: 'Running',  xpPer: 10, unit: 'mile',    threshold: 3 },
  { id: 'walking',  label: 'Walking',  xpPer: 5,  unit: 'mile',    threshold: 3 },
  { id: 'hiking',   label: 'Hiking',   xpPer: 7,  unit: 'mile',    threshold: 3 },
  { id: 'swimming', label: 'Swimming', xpPer: 35, unit: 'session', threshold: 1 }
];

export const DAILY_NUTRITION_STACK = [
  { id: 'veggies',  label: 'Serving of vegetables', xpPer: 4, unit: 'serving', threshold: 1 },
  { id: 'protein',  label: '30g+ protein serving',  xpPer: 5, unit: 'serving', threshold: 1 },
  { id: 'water',    label: '40 oz water bottle',    xpPer: 4, unit: 'bottle',  threshold: 3 }
];

export const DAILY_NUTRITION_CHECK = [
  { id: 'supplements', label: 'Take supplements (night)', xp: 8 }
];

export const DAILY_DISCIPLINE_CHECK = [
  { id: 'duolingo', label: 'Duolingo', xp: 10 }
];

export const DAILY_DISCIPLINE_STACK = [
  { id: 'learning', label: 'Hour of learning', xpPer: 15, unit: 'hr', threshold: 1 }
];

export const DAILY_PT_ESSENTIAL = [
  { id: 'breathing', label: '90/90 diaphragmatic breathing', xp: 12 },
  { id: 'deadbugs',  label: 'Dead bugs',                     xp: 12 },
  { id: 'scap_ws',   label: 'Scapular wall slides',          xp: 12 },
  { id: 'glutes',    label: 'Glute bridges',                 xp: 12 }
];

export const DAILY_PT_BONUS = [
  { id: 'scap_pu',   label: 'Scapular push-ups',             xp: 12 },
  { id: 'clams',     label: 'Clam shells',                   xp: 12 },
  { id: 'side_plank',label: 'Side planks',                   xp: 12 }
];

export const BEDTIME_OPTIONS = [
  { id: 'early',  label: 'Before 11 PM',     xp: 30 },
  { id: 'normal', label: '11 PM – 12 AM',    xp: 12 },
  { id: 'late',   label: 'After midnight',   xp: 0  }
];

export const DAILY_PENALTIES = [
  { id: 'junk',         label: 'Serving of junk food / salty snacks', xpPer: -4,  unit: 'serving', category: 'nutrition',  type: 'stack' },
  { id: 'gaming',       label: 'Extra hr of gaming past 1st hr',      xpPer: -10, unit: 'hr',      category: 'discipline', type: 'stack' },
  { id: 'doomscrolling',label: 'Doomscrolling (per 30 min)',          xpPer: -6,  unit: '30min',   category: 'discipline', type: 'stack' }
];

export const DAILY_BONUS_CLAIMS = [
  { id: 'no_junk', label: 'Abstained from junk food today', xp: 5, category: 'nutrition' }
];

// DAILY ESSENTIALS DEFINITION (for penalty on close day)
// Each essential = one missed -> −5 XP from its category.
export const ESSENTIALS = [
  { id: 'ess_brush_am',   label: 'Brush teeth morning',       category: 'hygiene' },
  { id: 'ess_brush_pm',   label: 'Brush teeth night',         category: 'hygiene' },
  { id: 'ess_floss',      label: 'Floss at night',            category: 'hygiene' },
  { id: 'ess_shower',     label: 'Shower',                    category: 'hygiene' },
  { id: 'ess_skincare',   label: 'Skincare routine',          category: 'hygiene' },
  { id: 'ess_plank',      label: 'Plank',                     category: 'fitness' },
  { id: 'ess_fitness',    label: 'Hit fitness threshold',     category: 'fitness' },
  { id: 'ess_veggies',    label: 'Veggies',                   category: 'nutrition' },
  { id: 'ess_protein',    label: 'Protein',                   category: 'nutrition' },
  { id: 'ess_water',      label: 'Water (3 bottles)',         category: 'nutrition' },
  { id: 'ess_supplements',label: 'Supplements',               category: 'nutrition' },
  { id: 'ess_duolingo',   label: 'Duolingo',                  category: 'discipline' },
  { id: 'ess_learning',   label: 'Learning (1 hr)',           category: 'discipline' },
  { id: 'ess_breathing',  label: '90/90 breathing',           category: 'pt' },
  { id: 'ess_deadbugs',   label: 'Dead bugs',                 category: 'pt' },
  { id: 'ess_scap_ws',    label: 'Scapular wall slides',      category: 'pt' },
  { id: 'ess_glutes',     label: 'Glute bridges',             category: 'pt' }
];

// BONUS TAB
export const BONUS_FITNESS_STACK = [
  { id: 'sauna',        label: 'Sauna per 10 min',        xpPer: 12, unit: '10min' }
];
export const BONUS_FITNESS_CHECK = [
  { id: 'spearfishing', label: 'Spearfishing', xp: 80 }
];
export const BONUS_CONTENT_STACK = [
  { id: 'nn_hour',  label: 'Hr work Nautical Nick', xpPer: 25, unit: 'hr' },
  { id: 'ff_hour',  label: 'Hr work Fluffy Farms',  xpPer: 15, unit: 'hr' }
];
export const BONUS_CONTENT_CHECK = [
  { id: 'nn_short', label: 'Published short Nautical Nick', xp: 60 },
  { id: 'nn_video', label: 'Published video Nautical Nick', xp: 150 },
  { id: 'ff_short', label: 'Published short Fluffy Farms',  xp: 30 }
];
export const BONUS_NUTRITION_STACK = [
  { id: 'healthy_meal', label: 'Healthy meal/snack', xpPer: 4, unit: 'serving' }
];
export const BONUS_AI_STACK = [
  { id: 'ai_work', label: 'Hr of AI work', xpPer: 20, unit: 'hr' }
];
export const BONUS_MILESTONES = [
  { id: 'nn_subs', label: '+100 subs Nautical Nick', xp: 200, category: 'content' },
  { id: 'ff_subs', label: '+100 subs Fluffy Farms',  xp: 120, category: 'content' }
];

// WEEKLY TAB
export const WEEKLY_ITEMS = [
  { id: 'nails',      label: 'Cut nails',            xp: 10, category: 'hygiene' },
  { id: 'shave',      label: 'Shave',                xp: 10, category: 'hygiene' },
  { id: 'no_alcohol', label: 'No alcohol this week', xp: 25, category: 'discipline' }
];

export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function weekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
