/* ═══════════════════════════════════════════════════════════════════════════
   NAUTICAL NICK VISIBILITY REPORT — app.js
   Loads JSON data, renders all sections, manages region switching,
   manages subscription state & premium spot modal.
═══════════════════════════════════════════════════════════════════════════ */

// ── API base URL ───────────────────────────────────────────────────────────
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : '';

// ── Region state ───────────────────────────────────────────────────────────
const REGION_KEY = 'nn_region';
const DEFAULT_REGION = 'san-diego';

// In-memory cache of loaded data files
const DATA = {
  regions:     null,   // regions.json
  conditions:  null,   // conditions.json
  history:     null,   // history.json
  snapshots:   null,   // snapshots.json  (SD only)
  spotDetails: null,   // spot-details.json
};

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  applySubscriptionState();

  // Load all data files in parallel
  await Promise.all([
    loadJSON('data/regions.json').then(d => DATA.regions = d),
    loadJSON('data/conditions.json').then(d => DATA.conditions = d),
    loadJSON('data/history.json').then(d => DATA.history = d),
    loadJSON('data/snapshots.json').then(d => DATA.snapshots = d).catch(() => DATA.snapshots = { snapshots: [] }),
    loadJSON('data/spot-details.json').then(d => DATA.spotDetails = d),
  ]);

  // Wire up region dropdown
  const sel = document.getElementById('regionSelect');
  if (sel) {
    const saved = localStorage.getItem(REGION_KEY) || DEFAULT_REGION;
    sel.value = saved;
    sel.addEventListener('change', () => setRegion(sel.value));
    setRegion(saved);
  }

  renderLastUpdated(DATA.conditions && DATA.conditions.lastUpdated);
  checkSuccessRedirect();
});

async function loadJSON(path) {
  const res = await fetch(path + '?v=' + Date.now());
  if (!res.ok) throw new Error(`Failed: ${path}`);
  return res.json();
}

// ══════════════════════════════════════════════════════════════════════════
// REGION SWITCHING
// ══════════════════════════════════════════════════════════════════════════
function setRegion(slug) {
  localStorage.setItem(REGION_KEY, slug);
  document.body.setAttribute('data-region', slug);

  const region = (DATA.regions && DATA.regions.regions || []).find(r => r.slug === slug);
  const displayName = region ? region.displayName : slug;

  // Update dynamic title
  const titleEl = document.getElementById('dailyReportTitle');
  if (titleEl) titleEl.textContent = `${displayName}'s Daily Report`;

  const subtitleEl = document.getElementById('siteSubtitle');
  if (subtitleEl) subtitleEl.textContent = `${displayName} Coast  ·  Daily Ocean Conditions`;

  // Data sources badge
  const srcBadge = document.getElementById('aiSourcesBadge');
  if (srcBadge) {
    srcBadge.textContent = slug === 'san-diego'
      ? 'Synthesized from satellite, pier cam, and diver reports'
      : 'Synthesized from satellite and surf conditions';
  }

  renderRegion(slug);
}

function renderRegion(slug) {
  const conds = DATA.conditions && DATA.conditions.regions && DATA.conditions.regions[slug];
  if (!conds) return;

  renderConditions(conds);
  renderAiSummary(conds);

  // Spot cards — merge region's spot list (from regions.json) with live readings
  const regionMeta = (DATA.regions.regions || []).find(r => r.slug === slug);
  const spotsList = regionMeta ? regionMeta.spots : [];
  const spotReadings = conds.spots || {};

  const merged = spotsList.map(s => ({
    ...s,
    ...(spotReadings[s.slug] || {}),
  }));
  renderSpots(merged);

  // Snapshots — only for San Diego
  if (slug === 'san-diego') {
    renderSnapshots((DATA.snapshots && DATA.snapshots.snapshots) || []);
  }

  // History — per region
  const regionHistory = (DATA.history && DATA.history.regions && DATA.history.regions[slug]) || [];
  renderHistoryChart(regionHistory);
}

function currentRegionSlug() {
  return document.body.getAttribute('data-region') || DEFAULT_REGION;
}

// ══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION STATE
// ══════════════════════════════════════════════════════════════════════════
function applySubscriptionState() {
  if (isSubscribed()) document.body.classList.add('subscribed');
}

function isSubscribed() {
  const token  = localStorage.getItem('nn_sub_token');
  const expiry = localStorage.getItem('nn_sub_expiry');
  if (!token || !expiry) return false;
  return new Date() < new Date(expiry);
}

function checkSuccessRedirect() {
  const params = new URLSearchParams(window.location.search);
  // Stripe redirect: /?stripe_success=1&session_id=cs_...
  const stripeSuccess = params.get('stripe_success');
  if (!stripeSuccess) return;

  // The canonical source of truth is the server-side subscription status;
  // this local token is just a UX optimization so the paywall unlocks
  // immediately on return from checkout.
  const email = params.get('email') || 'subscriber';
  // Store a 32-day local token (server-side subscription lookup should
  // ultimately be the source of truth — this is just a nice UX unlock).
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 32);
  localStorage.setItem('nn_sub_token', email);
  localStorage.setItem('nn_sub_expiry', expiry.toISOString());
  document.body.classList.add('subscribed');

  window.history.replaceState({}, '', window.location.pathname);
  showToast('🎉 Welcome to Premium! All features unlocked.');
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: AI SUMMARY
// ══════════════════════════════════════════════════════════════════════════
function renderAiSummary(data) {
  const el = document.getElementById('aiSummary');
  const ts = document.getElementById('aiTimestamp');
  if (el && data.aiSummary) el.textContent = data.aiSummary;
  if (ts && DATA.conditions && DATA.conditions.lastUpdated) {
    ts.textContent = 'Generated ' + formatTimestamp(DATA.conditions.lastUpdated);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: TODAY'S CONDITIONS
// ══════════════════════════════════════════════════════════════════════════
function renderConditions(data) {
  const vis = data.visibility || {};
  const src = data.sources   || {};

  setText('visNumber', vis.feet != null ? vis.feet : '—');

  const chip = document.getElementById('ratingChip');
  if (chip) {
    chip.textContent = vis.rating || '—';
    chip.dataset.rating = vis.rating || '';
  }

  setText('conditionsNote', vis.note || '');

  renderStarfish('clarityRating',  vis.clarityRating  || 0);
  renderStarfish('spearingRating', vis.spearingRating || 0);

  // Satellite
  const sat = src.satellite || {};
  setText('chloroVal',  sat.chlorophyll != null ? sat.chlorophyll : '—');
  setText('chloroNote', sat.note || '');

  // Pier cam (SD only)
  const pc = src.piercam || {};
  setText('piercamVal',  pc.estimatedVisibility != null ? pc.estimatedVisibility : '—');
  setText('piercamNote', pc.note || '');

  // JustGetWet (SD only)
  const jgw = src.justgetwet || {};
  setText('justgetwetVal',  jgw.estimatedVisibility != null ? jgw.estimatedVisibility : '—');
  setText('justgetwetNote', jgw.report || '');

  // Surf (all regions)
  const surf = src.surf || {};
  setText('surfVal',  surf.waveHeightFt != null ? surf.waveHeightFt : '—');
  setText('surfNote', surf.note || '—');
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: STARFISH RATING ICONS
// ══════════════════════════════════════════════════════════════════════════
function renderStarfish(containerId, rating, max = 5) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const STAR_POINTS = '50,5 57,40 92,36 64,55 76,86 50,62 24,86 36,55 8,36 43,40';

  for (let i = 1; i <= max; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('starfish-icon');
    if (i <= rating) svg.classList.add('filled');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', STAR_POINTS);
    svg.appendChild(poly);
    container.appendChild(svg);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: PIER CAM SNAPSHOTS
// ══════════════════════════════════════════════════════════════════════════
function renderSnapshots(snapshots) {
  const grid = document.getElementById('snapshotsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const times = ['07:00', '09:00', '12:00'];
  const labels = ['7:00 AM', '9:00 AM', '12:00 PM'];

  const slots = times.map((t, i) => {
    const snap = snapshots.find(s => s.time === t) || { time: t, label: labels[i], captured: false };
    return snap;
  });

  const capturedSlots = slots.filter(s => s.captured);
  if (capturedSlots.length > 0) {
    capturedSlots[capturedSlots.length - 1].isLatest = true;
  }

  slots.forEach(snap => {
    grid.appendChild(buildSnapshotCard(snap));
  });
}

function buildSnapshotCard(snap) {
  const card = document.createElement('div');
  card.className = 'snapshot-card';

  const imgWrap = document.createElement('div');
  imgWrap.className = 'snapshot-img-wrap';

  if (snap.captured && snap.imagePath) {
    const img = document.createElement('img');
    img.className = 'snapshot-img';
    img.src = snap.imagePath;
    img.alt = `Scripps Pier Cam ${snap.label}`;
    img.onerror = () => { imgWrap.innerHTML = placeholderHTML('📷', 'Image unavailable'); };
    imgWrap.appendChild(img);
  } else {
    imgWrap.innerHTML = placeholderHTML('🌊', 'Not yet captured');
  }

  if (snap.isLatest) {
    const tag = document.createElement('div');
    tag.className = 'snapshot-latest-tag';
    tag.textContent = 'LATEST';
    imgWrap.appendChild(tag);
  }

  card.appendChild(imgWrap);

  const info = document.createElement('div');
  info.className = 'snapshot-info';

  const timeRow = document.createElement('div');
  timeRow.className = 'snapshot-time-row';

  const timeEl = document.createElement('span');
  timeEl.className = 'snapshot-time';
  timeEl.textContent = snap.label || snap.time;
  timeRow.appendChild(timeEl);

  if (snap.rating) {
    const ratingEl = document.createElement('span');
    ratingEl.className = `snapshot-rating ${snap.rating}`;
    ratingEl.textContent = snap.rating;
    timeRow.appendChild(ratingEl);
  }

  info.appendChild(timeRow);

  if (snap.visibility != null) {
    const visEl = document.createElement('div');
    visEl.className = 'snapshot-vis';
    visEl.innerHTML = `${snap.visibility} <span>FT EST.</span>`;
    info.appendChild(visEl);
  }

  if (snap.description) {
    const desc = document.createElement('p');
    desc.className = 'snapshot-desc';
    desc.textContent = snap.description;
    info.appendChild(desc);
  }

  if (snap.pillingsVisible && snap.pillingsVisible.length > 0) {
    const tags = document.createElement('div');
    tags.className = 'snapshot-tags';

    const labelMap = {
      'right-front-4ft':  'Right-Front 4ft',
      'right-back-11ft':  'Right-Back 11ft',
      'back-left-14ft':   'Back-Left 14ft',
      'far-left-30ft':    'Far-Left 30ft',
    };

    snap.pillingsVisible.forEach(piling => {
      const tag = document.createElement('span');
      tag.className = 'snapshot-tag';
      tag.textContent = labelMap[piling] || piling;
      tags.appendChild(tag);
    });

    info.appendChild(tags);
  }

  card.appendChild(info);
  return card;
}

function placeholderHTML(icon, text) {
  return `
    <div class="snapshot-placeholder">
      <span class="snapshot-placeholder-icon">${icon}</span>
      <span class="snapshot-placeholder-text">${text}</span>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: SPOT BREAKDOWN (free, clickable)
// ══════════════════════════════════════════════════════════════════════════
function renderSpots(spots) {
  const grid = document.getElementById('spotsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const MAX_VIS = 50; // ft — scaling for the bar (Catalina reaches 50+)

  spots.forEach(spot => {
    const card = document.createElement('div');
    card.className = 'spot-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => openSpotModal(spot.slug));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSpotModal(spot.slug); }
    });

    // Spot type chip
    if (spot.type) {
      const chip = document.createElement('div');
      chip.className = 'spot-type-chip';
      chip.textContent = spot.type.toUpperCase();
      card.appendChild(chip);
    }

    // Trend arrow
    const trendMap = { up: '↑', steady: '→', down: '↓' };
    const trendClass = spot.trend === 'up' ? 'up' : spot.trend === 'down' ? 'down' : 'steady';
    const trend = document.createElement('div');
    trend.className = `spot-trend ${trendClass}`;
    trend.textContent = trendMap[spot.trend] || '→';
    card.appendChild(trend);

    // Name
    const name = document.createElement('div');
    name.className = 'spot-name';
    name.textContent = spot.name;
    card.appendChild(name);

    // Depth
    const depth = document.createElement('div');
    depth.className = 'spot-depth';
    depth.textContent = `MAX ${spot.maxDepth}FT`;
    card.appendChild(depth);

    // Visibility number
    const visNum = document.createElement('span');
    visNum.className = 'spot-vis';
    visNum.textContent = spot.visibility != null ? spot.visibility : '—';
    const visUnit = document.createElement('div');
    visUnit.className = 'spot-vis-unit';
    visUnit.textContent = 'FT';
    card.appendChild(visNum);
    card.appendChild(visUnit);

    // Progress bar
    const track = document.createElement('div');
    track.className = 'spot-bar-track';
    const fill = document.createElement('div');
    fill.className = 'spot-bar-fill';
    const pct = Math.min(100, Math.round(((spot.visibility || 0) / MAX_VIS) * 100));
    fill.style.width = pct + '%';
    fill.style.background = visColor(spot.visibility);
    track.appendChild(fill);
    card.appendChild(track);

    grid.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SPOT DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════════
function openSpotModal(slug) {
  const slug_ = slug;
  const regionSlug = currentRegionSlug();
  const regionMeta = (DATA.regions.regions || []).find(r => r.slug === regionSlug);
  const spotMeta   = regionMeta ? regionMeta.spots.find(s => s.slug === slug_) : null;
  if (!spotMeta) return;

  const conds    = DATA.conditions.regions[regionSlug];
  const reading  = (conds && conds.spots && conds.spots[slug_]) || {};
  const details  = (DATA.spotDetails && DATA.spotDetails.spots && DATA.spotDetails.spots[slug_]) || null;

  // Header
  setText('spotModalName', spotMeta.name);
  const typeText = (spotMeta.type || '').toUpperCase();
  setText('spotModalMeta', `${typeText}  ·  Max Depth ${spotMeta.maxDepth}ft  ·  ${spotMeta.coords.lat.toFixed(3)}°, ${spotMeta.coords.lon.toFixed(3)}°`);

  // Free tiles
  setTileValue('spotModalVis',    reading.visibility,      'FT');
  setTileValue('spotModalChloro', reading.chlorophyll,     'mg/m³');
  setTileValue('spotModalSwell',  reading.waveHeightFt,    'FT');
  setTileValue('spotModalWind',   reading.windKts,         'KTS');

  // Premium content
  const premiumWrap = document.getElementById('spotPremiumWrap');
  if (!details) {
    premiumWrap.classList.add('locked');
  } else {
    // Render premium body regardless — CSS blurs it for non-subs
    renderStarfish('spotModalStarfish', details.spearingRating || 0);
    setText('spotModalSummary', details.summary || '');

    const seasonHost = document.getElementById('spotModalSeasons');
    seasonHost.innerHTML = '';
    const SEASONS = [
      ['spring', 'Spring'],
      ['summer', 'Summer'],
      ['fall',   'Fall'],
      ['winter', 'Winter'],
    ];
    SEASONS.forEach(([key, label]) => {
      const fish = (details.season && details.season[key]) || [];
      const card = document.createElement('div');
      card.className = 'spot-season-card';
      card.innerHTML = `
        <h4 class="spot-season-title">${label}</h4>
        <p class="spot-season-fish">${fish.join(' · ') || '—'}</p>
      `;
      seasonHost.appendChild(card);
    });

    const tipsEl = document.getElementById('spotModalTips');
    tipsEl.innerHTML = '';
    (details.huntingTips || []).forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      tipsEl.appendChild(li);
    });

    setText('spotModalPrediction', details.prediction14Day || '—');

    // Apply lock state
    if (isSubscribed()) {
      premiumWrap.classList.remove('locked');
    } else {
      premiumWrap.classList.add('locked');
    }
  }

  const modal = document.getElementById('spotModal');
  if (modal) modal.style.display = 'flex';
}

function setTileValue(elId, value, unit) {
  const el = document.getElementById(elId);
  if (!el) return;
  const v = (value != null && value !== '') ? value : '—';
  el.innerHTML = `${v}<span class="spot-tile-unit">${unit}</span>`;
}

// ══════════════════════════════════════════════════════════════════════════
// RENDER: 14-DAY HISTORY CHART
// ══════════════════════════════════════════════════════════════════════════
let historyChartInstance = null;

function renderHistoryChart(history) {
  const canvas = document.getElementById('historyChart');
  if (!canvas) return;

  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));

  const labels = sorted.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const values = sorted.map(d => d.visibility);
  const colors = sorted.map(d => visColor(d.visibility));

  if (historyChartInstance) historyChartInstance.destroy();

  // Dynamic y-axis max based on data
  const dataMax = Math.max(40, Math.ceil((Math.max(...values, 0) + 10) / 10) * 10);

  historyChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Visibility (ft)',
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d3347',
          borderColor: 'rgba(0,229,255,0.3)',
          borderWidth: 1,
          titleColor: '#00e5ff',
          bodyColor: '#c8e8f4',
          callbacks: {
            label: ctx => ` ${ctx.raw} ft — ${ratingForVis(ctx.raw)}`,
          },
        },
      },
      scales: {
        y: {
          min: 0,
          max: dataMax,
          grid:   { color: 'rgba(0,229,255,0.07)' },
          border: { color: 'rgba(0,229,255,0.15)' },
          ticks: {
            color: '#6a9ab0',
            font: { family: 'Exo 2', size: 11 },
            callback: v => v + 'ft',
          },
        },
        x: {
          grid:   { display: false },
          border: { color: 'rgba(0,229,255,0.15)' },
          ticks: {
            color: '#6a9ab0',
            font: { family: 'Exo 2', size: 11 },
            maxRotation: 45,
          },
        },
      },
    },
  });
}

// ══════════════════════════════════════════════════════════════════════════
// LAST UPDATED
// ══════════════════════════════════════════════════════════════════════════
function renderLastUpdated(isoString) {
  const el = document.getElementById('lastUpdated');
  if (!el || !isoString) return;
  el.textContent = formatTimestamp(isoString);
}

// ══════════════════════════════════════════════════════════════════════════
// STRIPE CHECKOUT
// ══════════════════════════════════════════════════════════════════════════
async function startCheckout() {
  const emailEl = document.getElementById('subEmail');
  const email = emailEl ? emailEl.value.trim() : '';

  if (!email || !email.includes('@')) {
    emailEl && emailEl.focus();
    showToast('Please enter a valid email address.', 'error');
    return;
  }

  const btn = document.getElementById('checkoutBtn');
  if (btn) { btn.textContent = 'Redirecting…'; btn.disabled = true; }

  try {
    const res = await fetch(`${API_BASE}/api/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) throw new Error('Server error');
    const { url } = await res.json();
    window.location.href = url;
  } catch (err) {
    console.error('Checkout error:', err);
    showToast('Could not start checkout. Please try again.', 'error');
    if (btn) { btn.textContent = 'Continue to Payment'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MAGIC LINK SIGN-IN
// ══════════════════════════════════════════════════════════════════════════
async function sendMagicLink() {
  const emailEl = document.getElementById('loginEmail');
  const msg     = document.getElementById('loginMsg');
  const email   = emailEl ? emailEl.value.trim() : '';

  if (!email) { emailEl && emailEl.focus(); return; }

  try {
    const res = await fetch(`${API_BASE}/api/send-magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (msg) msg.textContent = json.message || 'Check your inbox for a sign-in link.';
  } catch {
    if (msg) msg.textContent = 'Could not send link. Please try again.';
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SMS ALERT FORM
// ══════════════════════════════════════════════════════════════════════════
async function handleAlertSubmit(e) {
  e.preventDefault();

  const email     = document.getElementById('alertEmail').value.trim();
  const threshold = document.getElementById('alertThreshold').value;
  const confirm   = document.getElementById('alertConfirm');
  const region    = currentRegionSlug();

  if (!email || !email.includes('@')) return;

  try {
    const res = await fetch(`${API_BASE}/api/alerts/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, threshold: parseInt(threshold, 10), region }),
    });
    const json = await res.json();
    if (confirm) {
      confirm.style.display = 'block';
      confirm.style.color = '';
      confirm.textContent = json.message || `✓ Alert set! You'll get an email when ${region.replace('-', ' ')} visibility hits ${threshold}ft.`;
    }
  } catch {
    if (confirm) {
      confirm.style.display = 'block';
      confirm.style.color = '#ff4444';
      confirm.textContent = 'Could not set alert. Please try again.';
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════════════════
function openSubscribeModal() {
  const modal = document.getElementById('subscribeModal');
  if (modal) modal.style.display = 'flex';
}

function openLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.style.display = 'none';
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════════════
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: type === 'error' ? '#1a1010' : '#0d3347',
    color: type === 'error' ? '#ff6b6b' : '#00e5ff',
    border: `1px solid ${type === 'error' ? 'rgba(255,100,100,0.3)' : 'rgba(0,229,255,0.3)'}`,
    padding: '12px 24px',
    borderRadius: '8px',
    fontFamily: "'Exo 2', sans-serif",
    fontSize: '0.88rem',
    zIndex: '9999',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    opacity: '0',
    transition: 'opacity 0.3s',
  });
  document.body.appendChild(toast);

  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ══════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function visColor(ft) {
  if (ft >= 30) return '#4ad8f5';   // bright cyan — epic
  if (ft >= 20) return '#00e5ff';   // cyan — excellent
  if (ft >= 12) return '#ffd600';   // yellow — fair
  return '#ff1744';                  // red — poor
}

function ratingForVis(ft) {
  if (ft >= 40) return 'EPIC';
  if (ft >= 25) return 'EXCELLENT';
  if (ft >= 15) return 'GOOD';
  if (ft >= 8)  return 'FAIR';
  return 'POOR';
}

function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-US', {
      month:  'short',
      day:    'numeric',
      hour:   'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: 'America/Los_Angeles',
    });
  } catch {
    return isoString;
  }
}
