#!/usr/bin/env node
// Local usage server for Nick's Command Deck dashboard.
// Reads Claude Code session JSONL files from ~/.claude/projects/**, aggregates
// token usage by timestamp, and exposes:
//   GET  /api/usage          -> { daily, weekly, totals, resets, limits, sessions }
//   GET  /api/limits         -> current user-configured limits
//   POST /api/limits         -> { dailyTokens, weeklyTokens }
// Also serves the dashboard static files from this directory.
//
// Run:  node dashboard/server.js
// Then open: http://localhost:4321

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const url = require("url");

const PORT = process.env.PORT || 4321;
const DASHBOARD_DIR = __dirname;
const CLAUDE_PROJECTS = path.join(os.homedir(), ".claude", "projects");
const CONFIG_FILE = path.join(DASHBOARD_DIR, "usage-config.json");

const DEFAULT_CONFIG = {
  dailyTokens: 500_000,
  weeklyTokens: 3_000_000,
  weekStartsOn: 0, // 0 = Sunday (local time)
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ---------- jsonl scanning ----------
function* walkJsonl(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(full);
    else if (e.isFile() && full.endsWith(".jsonl")) yield full;
  }
}

function extractUsageEntries() {
  // Returns array of { ts: Date, tokens: number, input, output, cacheCreate, cacheRead, sessionId, file }
  const out = [];
  for (const file of walkJsonl(CLAUDE_PROJECTS)) {
    let data;
    try { data = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of data.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const usage = obj?.message?.usage || obj?.usage;
      const ts = obj?.timestamp || obj?.message?.timestamp;
      if (!usage || !ts) continue;
      const input = usage.input_tokens || 0;
      const output = usage.output_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const cacheRead = usage.cache_read_input_tokens || 0;
      const tokens = input + output + cacheCreate + cacheRead;
      if (!tokens) continue;
      out.push({
        ts: new Date(ts),
        tokens, input, output, cacheCreate, cacheRead,
        sessionId: obj.sessionId || path.basename(file, ".jsonl"),
        file,
      });
    }
  }
  return out;
}

// ---------- window math ----------
function startOfLocalDay(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}
function startOfLocalWeek(d = new Date(), weekStartsOn = 0) {
  const x = startOfLocalDay(d);
  const diff = (x.getDay() - weekStartsOn + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function endOfLocalWeek(d = new Date(), weekStartsOn = 0) {
  const s = startOfLocalWeek(d, weekStartsOn);
  const e = new Date(s); e.setDate(e.getDate() + 7); return e;
}

function aggregate(entries, cfg) {
  const now = new Date();
  const dayStart = startOfLocalDay(now);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const weekStart = startOfLocalWeek(now, cfg.weekStartsOn);
  const weekEnd = endOfLocalWeek(now, cfg.weekStartsOn);

  let dayTokens = 0, dayInput = 0, dayOutput = 0, dayCacheCreate = 0, dayCacheRead = 0;
  let weekTokens = 0, weekInput = 0, weekOutput = 0, weekCacheCreate = 0, weekCacheRead = 0;
  let totalTokens = 0;
  const dailyHistory = {}; // YYYY-MM-DD -> tokens (last 14 days)
  const activeSessions = new Set();

  for (const e of entries) {
    totalTokens += e.tokens;
    const dayKey = e.ts.getFullYear() + "-" +
      String(e.ts.getMonth() + 1).padStart(2, "0") + "-" +
      String(e.ts.getDate()).padStart(2, "0");
    dailyHistory[dayKey] = (dailyHistory[dayKey] || 0) + e.tokens;
    if (e.ts >= dayStart && e.ts < dayEnd) {
      dayTokens += e.tokens; dayInput += e.input; dayOutput += e.output;
      dayCacheCreate += e.cacheCreate; dayCacheRead += e.cacheRead;
      activeSessions.add(e.sessionId);
    }
    if (e.ts >= weekStart && e.ts < weekEnd) {
      weekTokens += e.tokens; weekInput += e.input; weekOutput += e.output;
      weekCacheCreate += e.cacheCreate; weekCacheRead += e.cacheRead;
    }
  }

  // Trim history to last 14 days sorted
  const history = Object.entries(dailyHistory)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, tokens]) => ({ date, tokens }));

  return {
    now: now.toISOString(),
    totals: { tokens: totalTokens, entries: entries.length },
    daily: {
      tokens: dayTokens, input: dayInput, output: dayOutput,
      cacheCreate: dayCacheCreate, cacheRead: dayCacheRead,
      limit: cfg.dailyTokens,
      used: cfg.dailyTokens ? Math.min(100, Math.round((dayTokens / cfg.dailyTokens) * 100)) : 0,
      remaining: Math.max(0, cfg.dailyTokens - dayTokens),
      resetAt: dayEnd.toISOString(),
    },
    weekly: {
      tokens: weekTokens, input: weekInput, output: weekOutput,
      cacheCreate: weekCacheCreate, cacheRead: weekCacheRead,
      limit: cfg.weeklyTokens,
      used: cfg.weeklyTokens ? Math.min(100, Math.round((weekTokens / cfg.weeklyTokens) * 100)) : 0,
      remaining: Math.max(0, cfg.weeklyTokens - weekTokens),
      resetAt: weekEnd.toISOString(),
    },
    history,
    activeSessionsToday: activeSessions.size,
    limits: cfg,
  };
}

// ---------- server ----------
function sendJSON(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(DASHBOARD_DIR, safe);
  if (!full.startsWith(DASHBOARD_DIR)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const mime = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (u.pathname === "/api/usage" && req.method === "GET") {
    try {
      const cfg = loadConfig();
      const entries = extractUsageEntries();
      return sendJSON(res, aggregate(entries, cfg));
    } catch (e) {
      return sendJSON(res, { error: e.message }, 500);
    }
  }

  if (u.pathname === "/api/limits" && req.method === "GET") {
    return sendJSON(res, loadConfig());
  }

  if (u.pathname === "/api/limits" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const cfg = loadConfig();
      if (Number.isFinite(+body.dailyTokens)) cfg.dailyTokens = +body.dailyTokens;
      if (Number.isFinite(+body.weeklyTokens)) cfg.weeklyTokens = +body.weeklyTokens;
      if (Number.isFinite(+body.weekStartsOn)) cfg.weekStartsOn = +body.weekStartsOn;
      saveConfig(cfg);
      return sendJSON(res, cfg);
    } catch (e) {
      return sendJSON(res, { error: e.message }, 400);
    }
  }

  if (req.method === "GET") return serveStatic(req, res, u.pathname);

  res.writeHead(405); res.end("method not allowed");
});

server.listen(PORT, () => {
  console.log(`Command Deck running at http://localhost:${PORT}`);
  console.log(`Reading Claude sessions from: ${CLAUDE_PROJECTS}`);
});
