import express from "express";
import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";
import fetch from "node-fetch";
import {
  getLeadsForAccount,
  adoptUnownedLeads,
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
  adoptUnownedConvs,
  CHANNELS,
  Channel,
} from "./inbox";
import {
  createAccount,
  getAccount,
  getAccountByProviderKey,
  updateAccount,
  countAccounts,
  Account,
} from "./accountStore";
import { signSession, verifySession, SESSION_COOKIE, sessionCookieOptions } from "./session";
import { verifyMagicToken, requestMagicToken, emailConfigured } from "./magic";
import { createCheckout } from "./billing";
import { mapLegacy, tierIndex, TIERS, PLANS } from "./plans";
import { gateFor } from "./toolGates";

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

// ---------- Auth plumbing ----------

function currentAccountId(req: express.Request): string | null {
  return verifySession((req.headers.cookie || "").split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(SESSION_COOKIE + "="))
    ?.split("=").slice(1).join("="));
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const uid = currentAccountId(req);
  const account = uid ? getAccount(uid) : undefined;
  if (!account) {
    res.status(401).json({ error: "auth-required", detail: "Please sign in." });
    return;
  }
  (req as any).account = account;
  next();
}

function signedIn(req: express.Request): Account | undefined {
  const uid = currentAccountId(req);
  return uid ? getAccount(uid) : undefined;
}

function setSessionCookie(res: express.Response, accountId: string): void {
  res.cookie(SESSION_COOKIE, signSession(accountId), sessionCookieOptions());
}

function clearSessionCookie(res: express.Response): void {
  res.cookie(SESSION_COOKIE, "", sessionCookieOptions(true));
}

// ---------- Health ----------
app.get("/", (req, res) => {
  const accept = String(req.headers.accept || "");
  if (accept.includes("text/html")) {
    return res.redirect(signedIn(req) ? "/dashboard" : "/home");
  }
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

// ---------- Public pages ----------
app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});

app.get("/home", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/pricing", (_req, res) => {
  res.status(200).json({ plans: PLANS.map((p) => ({ tier: p.tier, label: p.label, price: p.price, blurb: p.blurb, features: p.features })) });
});

app.get("/dashboard", (req, res) => {
  if (!signedIn(req)) return res.redirect("/login");
  res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});

app.get("/discord", (_req, res) => {
  res.status(404).json({ error: "not implemented" });
});

// ---------- Auth API ----------
app.get("/api/auth/config", (_req, res) => {
  res.json({
    providers: ["google", "telegram", "magic"],
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    telegramBot: process.env.BOT_USERNAME || "",
    magicDevPreview: process.env.MAGIC_DEV_PREVIEW === "true",
    emailConfigured: emailConfigured(),
  });
});

app.post("/api/auth/google", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  const credential = String(req.body?.credential || "");
  if (credential.length < 20 || credential.length > 12000) return res.status(400).json({ error: "Invalid credential" });
  try {
    // Verify the GSI token against Google's tokeninfo before trusting claims.
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) return res.status(401).json({ error: "Invalid Google token" });
    const claims: Record<string, any> = await r.json();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && claims.aud !== clientId) return res.status(401).json({ error: "Wrong audience" });
    if (claims.email_verified !== true) return res.status(401).json({ error: "Unverified email" });

    const sub = String(claims.sub);
    let account = getAccountByProviderKey("google", sub);
    if (!account) {
      const legacy = userLegacyPlan(String(claims.email || ""), sub);
      account = await createAccount({ provider: "google", providerKey: sub, name: claims.name, email: claims.email, avatar: claims.picture, legacyPlan: legacy });
      if (countAccounts() === 1) {
        adoptUnownedLeads(account.id);
        adoptUnownedConvs(account.id);
      }
    }
    if (account.plan === "free" && claims.email && userLegacyPlan(claims.email)) {
      const legacy = userLegacyPlan(claims.email);
      if (legacy && legacy !== "free") updateAccount(account.id, { plan: legacy as any });
    }
    setSessionCookie(res, account.id);
    res.json({ ok: true, account: publicAccount(account) });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Google sign-in failed", detail: err?.message ?? "unknown" });
  }
});

app.post("/api/auth/telegram", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  const data = req.body?.data;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "Invalid payload" });
  const received = JSON.parse(JSON.stringify(data));

  if (!verifyTelegramHash(received)) return res.status(401).json({ error: "Invalid Telegram hash" });

  const authDate = Number(received.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return res.status(401).json({ error: "Expired auth" });

  const key = String(received.id || "");
  if (!/^\d{5,}$/.test(key)) return res.status(400).json({ error: "Invalid id" });

  const name = [received.first_name, received.last_name].filter(Boolean).join(" ").trim();
  const legacy = userLegacyPlan(key);
  let account = getAccountByProviderKey("telegram", key);
  if (!account) {
    account = await createAccount({ provider: "telegram", providerKey: key, name: name || "Telegram user", email: received.username ? `@${received.username}` : undefined, avatar: received.photo_url, legacyPlan: legacy });
    if (countAccounts() === 1) {
      adoptUnownedLeads(account.id);
      adoptUnownedConvs(account.id);
    }
  }
  setSessionCookie(res, account.id);
  res.json({ ok: true, account: publicAccount(account) });
});

function verifyTelegramHash(data: Record<string, any>): boolean {
  const secret = process.env.BOT_TOKEN;
  if (!secret) return false;
  const secretKey = crypto.createHash("sha256").update(secret).digest();
  const params = Object.keys(data)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const hmac = crypto.createHmac("sha256", secretKey).update(params).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(String(data.hash || ""), "hex"));
}

app.post("/api/auth/magic/request", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email" });
  const delivery = await requestMagicToken(email);
  res.json({ ok: true, delivered: delivery.delivered, code: delivery.delivered === "preview" ? (delivery as { code: string }).code : undefined });
});

app.post("/api/auth/magic/verify", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  if (!verifyMagicToken(email, code)) return res.status(401).json({ error: "Invalid or expired code" });

  const legacy = userLegacyPlan(email);
  let account = getAccountByProviderKey("magic", email);
  if (!account) {
    account = await createAccount({ provider: "magic", providerKey: email, email, name: email.split("@")[0], legacyPlan: legacy });
    if (countAccounts() === 1) {
      adoptUnownedLeads(account.id);
      adoptUnownedConvs(account.id);
    }
  }
  setSessionCookie(res, account.id);
  res.json({ ok: true, account: publicAccount(account) });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const account = signedIn(req);
  if (!account) return res.status(401).json({ error: "auth-required" });
  res.json({ account: publicAccount(account), plan: account.plan, serverTime: new Date().toISOString() });
});

function publicAccount(a: Account) {
  return { id: a.id, name: a.name, email: a.email, avatar: a.avatar, provider: a.provider, plan: a.plan, planUntil: a.planUntil, createdAt: a.createdAt };
}

// Map the pre-web legacy entititlements (stored per Telegram id in state.json)
// onto the account so existing bot users don't lose access.
function userLegacyPlan(telegramIdOrEmail: string, googleSub?: string): string | undefined {
  const state = loadState();
  const keys = [telegramIdOrEmail, googleSub].filter(Boolean).map(String);
  for (const k of keys) {
    const s = state[k];
    if (s && typeof s === "object") {
      const p = s.plan;
      if (p) return mapLegacy(p);
    }
  }
  return undefined;
}

// ---------- Leads CRUD (per-account) ----------
app.get("/api/leads", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const leads = await getLeadsForAccount(account.id);
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.get("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const leads = await getLeadsForAccount(account.id);
    const found = leads.find((l) => l.id === req.params.id);
    if (!found) return res.status(404).json({ error: "Lead not found" });
    res.json(found);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

app.post("/api/leads", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const body = req.body || {};
    if (!body.telegramId) return res.status(400).json({ error: "telegramId is required" });
    const lead = await addLead({ ...body, accountId: account.id });
    res.status(201).json(lead);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Failed to create lead" });
  }
});

app.patch("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const body = req.body || {};
    if (typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ error: "Invalid body" });
    const mine = (await getLeadsForAccount(account.id)).some((l) => l.id === String(req.params.id));
    if (!mine) return res.status(404).json({ error: "Lead not found" });
    const updated = await updateLead(String(req.params.id), body);
    if (!updated) return res.status(404).json({ error: "Lead not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update lead" });
  }
});

app.delete("/api/leads/:id", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const mine = (await getLeadsForAccount(account.id)).some((l) => l.id === String(req.params.id));
    if (!mine) return res.status(404).json({ error: "Lead not found" });
    const deleted = await deleteLead(String(req.params.id));
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

// ---------- Stats (per-account) ----------
function statSummary(leads: import("./leadStore").Lead[], accountId?: string) {
  const total = leads.length;
  const byStage = leads.reduce((acc: any, cur: any) => {
    acc[cur.stage] = (acc[cur.stage] || 0) + 1;
    return acc;
  }, {});
  const byChannel = leads.reduce((acc: any, cur: any) => {
    const ch = cur.channel || "telegram";
    acc[ch] = (acc[ch] || 0) + 1;
    return acc;
  }, {});
  const pipelineValue = leads.reduce((acc: any, l: any) => acc + (Number(l.value) || 0), 0);
  const closedValue = leads.filter((l: any) => l.stage === "closed").reduce((acc: any, l: any) => acc + (Number(l.value) || 0), 0);
  const inbox = unreadTotals(accountId);
  return { total, byStage, byChannel, pipelineValue, closedValue, inbox };
}

app.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const leads = await getLeadsForAccount(account.id);
    const s = statSummary(leads, account.id);
    const state = loadState();
    const aiCount = Object.values(state).reduce((acc: any, st: any) => acc + (st?.aiCount || 0), 0);
    res.json({ ...s, plan: account.plan, aiCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ---------- Unified Inbox API (Thinker-gated + per-account) ----------

function validChannel(ch: string | undefined): Channel | undefined {
  return CHANNELS.includes(ch as Channel) ? (ch as Channel) : undefined;
}

app.get("/api/conversations", requireAuth, (_req, res) => {
  try {
    const account = (_req as any).account as Account;
    if (tierIndex(account.plan) < 4) return res.status(403).json({ error: "upgrade", type: "upgrade", upgradeTo: "thinker" });
    seedIfEmpty();
    const channel = validChannel(String(_req.query.channel || ""));
    res.json(getConversations(account.id, channel));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

app.get("/api/conversations/:id", requireAuth, (req, res) => {
  try {
    const account = (req as any).account as Account;
    if (tierIndex(account.plan) < 4) return res.status(403).json({ error: "upgrade", type: "upgrade", upgradeTo: "thinker" });
    const conv = getConversation(String(req.params.id));
    if (!conv || (conv.accountId && conv.accountId !== account.id)) return res.status(404).json({ error: "Conversation not found" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

app.post("/api/conversations/:id/read", requireAuth, (req, res) => {
  try {
    const account = (req as any).account as Account;
    if (tierIndex(account.plan) < 4) return res.status(403).json({ error: "upgrade", type: "upgrade", upgradeTo: "thinker" });
    const conv = markRead(String(req.params.id));
    if (!conv || (conv.accountId && conv.accountId !== account.id)) return res.status(404).json({ error: "Conversation not found" });
    res.json({ ok: true, unread: 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

app.post("/api/conversations/:id/reply", requireAuth, (req, res) => {
  if (!applyRateLimit(req, res)) return;
  try {
    const account = (req as any).account as Account;
    if (tierIndex(account.plan) < 4) return res.status(403).json({ error: "upgrade", type: "upgrade", upgradeTo: "thinker" });
    const text = String(req.body?.text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "text required" });
    const conv = reply(String(req.params.id), text);
    if (!conv || (conv.accountId && conv.accountId !== account.id)) return res.status(404).json({ error: "Conversation not found" });
    res.json({ ok: true, conversation: conv });
  } catch (err) {
    res.status(500).json({ error: "Failed to reply" });
  }
});

// Inbox summary — available down to free (badge on overview), Thinker for the full inbox.
app.get("/api/inbox", requireAuth, (_req, res) => {
  try {
    const account = (_req as any).account as Account;
    const totals = unreadTotals(account.id);
    const view = tierIndex(account.plan) >= 4 ? "full" : "summary";
    res.json({ ...totals, view });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

// ---------- Tools (server-gated by tier) ----------
const TOOL_HANDLERS: Record<string, (input?: string) => Promise<string>> = {
  plan: async () => {
    return "Here are the plans:\n\n" + PLANS.map((p) => `${p.label} — ${p.price}\n  ${p.features.join(", ")}`).join("\n");
  },
  persona: async (input) => generateResponse(`Create a brand/communication persona. Tone: friendly power. Audience: marketers. Style: clear. Refine: ${input || "default"}`),
  meta: async (input) => generateResponse(`Generate an SEO meta title (50-60 chars), meta description (155-160 chars), and URL slug for topic: ${input || "our product"}`),
  valuemap: async (input) => generateResponse(`Generate an OSP-style product value map for product: ${input || "our product"}`),
  review: async (input) => generateResponse(`Review this content using OSP editing codes (scope, flow, style, word choice, grammar, accuracy). Content: ${input || "(none)"}`),
  growth: async () => generateResponse(`List 5 battle-tested growth marketing prompts for paid ads, SEO, email, CRO, and content.`),
  swipe: async () => generateResponse(`Provide 3 ready-to-use swipe file hooks/headlines for marketing campaigns.`),
  workflow: async () => `Automation triggers are stage-change based. Use /workflow in the bot for the full rundown.\n\nQuick view: stage:new → notify owner · stage:closed → mark won · unread spike → alert.`,
  content: async (input) => generateResponse(`Write a social post + email subject + hook for: ${input || "our product"}`),
  campaign: async (input) => generateResponse(`Give 5 creative campaign ideas for: ${input || "our business"}`),
  keywords: async (input) => generateResponse(`List 10 keywords for ${input || "digital marketing"} grouped by search intent.`),
  leadmagnet: async (input) => generateResponse(`Suggest 5 high-converting lead magnet ideas for: ${input || "our product"}`),
};

app.post("/api/tools/:id", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const tool = gateFor(String(req.params.id));
    if (!tool) return res.status(404).json({ error: "Unknown tool" });
    const min = tierIndex(tool.min);
    const cur = tierIndex(account.plan);
    if (cur < min) return res.status(403).json({ error: "Locked — upgrade to " + PLANS[min].label, type: "upgrade", upgradeTo: tool.min });
    const handler = TOOL_HANDLERS[tool.id];
    if (!handler) return res.status(501).json({ error: "Tool not implemented" });
    const text = await handler(String(req.body?.input || "").trim().slice(0, 2000) || undefined);
    res.json({ ok: true, title: tool.name + " result", text });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Tool failed", detail: err?.message ?? "unknown" });
  }
});

// ---------- Billing ----------
app.post("/api/billing/checkout", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const tier = String(req.body?.tier || "");
    const provider = String(req.body?.provider || "stripe");
    if (!TIERS.includes(tier as any)) return res.status(400).json({ error: "Unknown tier" });
    const result = await createCheckout(account, tier, provider);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Billing failed" });
  }
});

app.get("/api/billing/status", requireAuth, (_req, res) => {
  res.json({
    stripe: { configured: !!process.env.STRIPE_SECRET_KEY },
    usdt: { configured: !!process.env.USDT_ADDRESS },
    live: !!process.env.STRIPE_SECRET_KEY || !!process.env.USDT_ADDRESS,
  });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});