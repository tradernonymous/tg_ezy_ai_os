import express from "express";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import {
  getLeads,
  addLead,
  updateLead,
  deleteLead,
} from "./leadStore";
import { generateResponse } from "./aiProvider";
import { loadState } from "./stateStore";
import {
  getConversations,
  getConversation,
  markRead,
  reply,
  unreadTotals,
  seedIfEmpty,
  CHANNELS,
  Channel,
} from "./inbox";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// ---------- CORS ----------
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------- Simple in-memory rate limiter ----------
const RATE_MAX = Number(process.env.RATE_LIMIT || 30); // requests per minute per IP
const RATE_WINDOW_MS = 60000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now > b.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  b.count++;
  return b.count <= RATE_MAX;
}

function applyRateLimit(req: express.Request, res: express.Response): boolean {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  if (!rateLimit(key)) {
    res.status(429).json({ error: "Too many requests. Slow down." });
    return false;
  }
  return true;
}

// ---------- Health ----------
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "TG Ezy AI OS", timestamp: new Date().toISOString() });
});

app.get("/health", (_req, res) => {
  try {
    const state = loadState();
    const ok = state && typeof state === "object";
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", uptime: process.uptime() });
  } catch (e) {
    res.status(503).json({ status: "degraded", error: "state unreadable" });
  }
});

// ---------- Leads CRUD ----------
app.get("/api/leads", async (_req, res) => {
  try {
    const leads = await getLeads();
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.get("/api/leads/:id", async (req, res) => {
  try {
    const leads = await getLeads();
    const found = leads.find((l: any) => l.id === req.params.id);
    if (!found) return res.status(404).json({ error: "Lead not found" });
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

app.post("/api/leads", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.telegramId) return res.status(400).json({ error: "telegramId is required" });
    const lead = await addLead(body);
    res.status(201).json(lead);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to create lead" });
  }
});

app.patch("/api/leads/:id", async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Invalid body" });
    const updated = await updateLead(req.params.id, body);
    if (!updated) return res.status(404).json({ error: "Lead not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update lead" });
  }
});

app.delete("/api/leads/:id", async (req, res) => {
  try {
    const deleted = await deleteLead(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Lead not found" });
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

// ---------- Chat (AI) — rate-limited + validated ----------
app.post("/api/chat", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  try {
    const { message } = req.body || {};
    if (!message || typeof message !== "string") return res.status(400).json({ error: "Message required" });
    const trimmed = message.trim().slice(0, 2000);
    if (!trimmed) return res.status(400).json({ error: "Message required" });
    const replyText = await generateResponse(trimmed);
    res.json({ reply: replyText || "No response from AI." });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "AI chat failed", detail: err?.message ?? "unknown" });
  }
});

// ---------- Stats (extended) ----------
app.get("/api/stats", async (_req, res) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage] = (acc[cur.stage] || 0) + 1;
      return acc;
    }, {});
    const byChannel = leads.reduce((acc: any, cur: any) => {
      const ch = cur.channel || 'telegram';
      acc[ch] = (acc[ch] || 0) + 1;
      return acc;
    }, {});
    const pipelineValue = leads.reduce((acc: any, l: any) => acc + (Number(l.value) || 0), 0);
    const closedValue = leads.filter((l: any) => l.stage === 'closed').reduce((acc: any, l: any) => acc + (Number(l.value) || 0), 0);

    const state = loadState();
    const ids = Object.keys(state).filter((k) => /^\d{6,}$/.test(k));
    let plan = 'free';
    if (ids.length) {
      // Highest tier among registered users (enterprise > pro > free)
      if (ids.some((k) => state[k]?.plan === 'enterprise')) plan = 'enterprise';
      else if (ids.some((k) => state[k]?.plan === 'pro')) plan = 'pro';
      else if (ids.some((k) => state[k]?.trialEndsAt && new Date(state[k].trialEndsAt).getTime() > Date.now())) plan = 'pro-trial';
    }
    const aiCount = Object.values(state).reduce((acc: any, s: any) => acc + (s?.aiCount || 0), 0);
    const inbox = unreadTotals();

    res.json({ total, byStage, byChannel, pipelineValue, closedValue, plan, aiCount, inbox });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ---------- Unified Inbox API ----------

function validChannel(ch: string | undefined): Channel | undefined {
  return CHANNELS.includes(ch as Channel) ? (ch as Channel) : undefined;
}

app.get("/api/conversations", (_req, res) => {
  try {
    seedIfEmpty();
    const channel = validChannel(String(_req.query.channel || ''));
    res.json(getConversations(channel));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

app.get("/api/conversations/:id", (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  res.json(conv);
});

app.post("/api/conversations/:id/read", (req, res) => {
  const conv = markRead(req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  res.json({ ok: true, unread: 0 });
});

app.post("/api/conversations/:id/reply", (req, res) => {
  if (!applyRateLimit(req, res)) return;
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: "text required" });
  const conv = reply(req.params.id, text);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  res.json({ ok: true, conversation: conv });
});

// Alias: /api/inbox → conversations summary
app.get("/api/inbox", (_req, res) => res.json(unreadTotals()));

// ---------- Dashboard ----------
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

app.get("/discord", (_req, res) => {
  res.status(404).json({ error: "not implemented" });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});