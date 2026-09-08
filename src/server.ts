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
import { createCheckout, confirmSession, handleStripeWebhook, recordUsdtPending, verifyStripeSignature } from "./billing";
import { mapLegacy, tierIndex, TIERS, PLANS } from "./plans";
import { gateFor } from "./toolGates";

dotenv.config();

const app = express();
app.disable("x-powered-by");

// Stripe webhook needs the raw body for signature verification, so it is
// registered before the global JSON body parser (raw → Buffer).
app.post("/api/billing/webhook", express.raw({ type: () => true, limit: "2mb" }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf-8") : String(req.body || "");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    // Fail closed. This endpoint grants paid plans, so an unverified request is
    // a free account upgrade for anyone who can POST JSON. Refuse to process at
    // all until a webhook secret is configured.
    if (!secret) {
      console.error("[billing] webhook rejected: STRIPE_WEBHOOK_SECRET is not configured");
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }
    if (!verifyStripeSignature(raw, String(req.headers["stripe-signature"] || ""), secret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }
    const account = await handleStripeWebhook(event);
    if (account) console.log(`[billing] webhook activated ${account.plan} for ${account.id}`);
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: "Invalid payload" });
  }
});

app.use(express.json({ limit: "100kb" }));

// ---------- Security headers ----------
app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");
  res.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // Fly terminates TLS and force_https is on, so HSTS is safe to assert there.
  if (process.env.NODE_ENV === "production" || process.env.FLY_APP_NAME) {
    res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Static brand assets (logo, favicon)
app.use(
  "/img",
  express.static(path.join(__dirname, "..", "public", "img"), {
    maxAge: "7d",
    etag: true,
    lastModified: true,
  }),
);

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

// Buckets expire logically but were never deleted, so the map grew by one entry
// per unique IP for the life of the process. Sweep expired keys at most once per
// window — O(size) but only every 60s, and it keeps the map proportional to
// active clients rather than to every client ever seen.
let lastSweep = 0;
function sweepRateBuckets(now: number): void {
  if (now - lastSweep < RATE_WINDOW_MS) return;
  lastSweep = now;
  for (const [k, v] of rateBuckets) {
    if (now > v.resetAt) rateBuckets.delete(k);
  }
}

function rateLimit(key: string): boolean {
  const now = Date.now();
  sweepRateBuckets(now);
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
  } catch {
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

// ---------- Crawler + AI-answer-engine surface ----------
// Built from the request host so a custom domain works without a redeploy.
function siteOrigin(req: any): string {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return `${proto}://${host}`;
}

app.get("/robots.txt", (req, res) => {
  const origin = siteOrigin(req);
  res.type("text/plain").send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /dashboard",
      "Disallow: /login",
      "Disallow: /api/",
      "",
      `Sitemap: ${origin}/sitemap.xml`,
      "",
    ].join("\n"),
  );
});

app.get("/sitemap.xml", (req, res) => {
  const origin = siteOrigin(req);
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${origin}/home`, priority: "1.0", freq: "weekly" },
    { loc: `${origin}/`, priority: "0.8", freq: "weekly" },
  ];
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod>` +
        `<changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`,
    )
    .join("\n");
  res
    .type("application/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`);
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
    telegramConfigured: String(process.env.BOT_TOKEN || "").trim().length >= 10,
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
    // tokeninfo returns email_verified as string "true"; GSI JWTs use boolean true.
    if (!(claims.email_verified === true || claims.email_verified === "true" || claims.email_verified === 1)) {
      return res.status(401).json({ error: "Unverified email" });
    }

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
  const secret = String(process.env.BOT_TOKEN || "").trim();
  if (secret.length < 10) {
    console.error("[auth] telegram: BOT_TOKEN missing or too short on server");
    return false;
  }
  try {
    const secretKey = crypto.createHash("sha256").update(secret).digest();
    const params = Object.keys(data)
      .filter((k) => k !== "hash")
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join("\n");
    const hmac = crypto.createHmac("sha256", secretKey).update(params).digest("hex");
    const provided = String(data.hash || "");
    if (!provided) return false;
    if (hmac.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(provided, "hex"))) {
      console.error(`[auth] telegram: hash mismatch (token len ${secret.length}, recv fields ${Object.keys(data).length}). BOT_TOKEN on server != bot token that signed this widget.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[auth] telegram: verify error", e);
    return false;
  }
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
  } catch {
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
  } catch {
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
  } catch {
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

// ---------- AI chat knowledge base (product browsing) ----------
const PRODUCT_BRIEF = `EzyViral OS is a marketing command center for solo marketers and small teams.
Core workflow: Capture leads (Telegram, manual entries) -> Qualify (pipeline stages with value) -> Create (AI content) -> Close (reply everywhere).
Sign-in: Google, Telegram, or Magic Key by email. Free to start, no card. The app lives at /dashboard.

MARKETING TOOLS (one account):
- Plan: change tiers instantly, no sales walls
- Persona: tone/audience/style presets for every piece
- SEO Meta: CTR-tuned titles, descriptions, slugs
- Content Review: OSP editing codes (scope, flow, style, wording, grammar, accuracy)
- Growth Prompts: paid ads, SEO, email, CRO prompts that convert
- Value Map: OSP-style product positioning maps
- Workflow: stage-change automations that ping the owner
- Swipe Files: scroll-stopping promo templates
- Content Studio: long-form content command post
- Campaigns: launch and track campaigns
- Keywords: search angles grouped by intent
- CSV Exports: take the pipeline anywhere
- Unified Inbox: every channel in one window (Telegram, Email, WhatsApp, Instagram, TikTok, Facebook)
- Ask AI: chat about leads and funnel, ask anything

PLANS (per month):
- Free $0 - Personal CRM: Add leads, Pipeline board, Conversation inbox preview
- Hobby $9 - Start creating with AI: Plan, Persona, SEO Meta; more AI generations and chat priority
- Marketer $29 - For active marketers: Content Review, Growth Prompts, Swipe Files; the popular pick for most users
- Navigator $99 - Run the whole funnel: Value Map, Workflow, Content Studio, Campaigns, Keywords, Lead Magnets, CSV exports
- Thinker $299 - Complete command center: everything in Navigator plus Unified Inbox (all channels)

Note: standalone inbox consolidators typically run $75-99 per user; EzyViral OS bundles the Unified Inbox into the plan (a preview is included free).`;

const CHAT_PERSONAS: Record<string, string> = {
  default: `You are the EzyViral OS website assistant. Answer visitors using the product facts below. Keep answers short, friendly and specific (tool names, plan names, prices). Never invent prices or plans. If it is not covered by the facts, point them to the /pricing page.`,
  growth: `You are Growth AI, a growth-marketing strategist inside EzyViral OS. First answer any product question from the facts below; otherwise give sharp actionable growth ideas (hooks, campaigns, angles). Keep replies brief.`,
  content: `You are Content AI, a copywriting specialist inside EzyViral OS. First answer any product question from the facts below; otherwise draft tight copy (captions, meta, swipe lines). Keep replies brief.`,
  funnel: `You are Funnel AI inside EzyViral OS. First answer any product question from the facts below; otherwise help with funnel logic, follow-up drafts and next steps. Keep replies brief.`,
};

// ---------- Chat (AI) — rate-limited + validated ----------
app.post("/api/chat", async (req, res) => {
  if (!applyRateLimit(req, res)) return;
  try {
    const { message, persona } = req.body || {};
    if (!message || typeof message !== "string") return res.status(400).json({ error: "Message required" });
    const trimmed = message.trim().slice(0, 2000);
    if (!trimmed) return res.status(400).json({ error: "Message required" });
    const personaKey = typeof persona === "string" && CHAT_PERSONAS[persona.toLowerCase()] ? persona.toLowerCase() : "default";
    const prompt = `${CHAT_PERSONAS[personaKey]}\n\nPRODUCT FACTS:\n${PRODUCT_BRIEF}\n\nVisitor question: ${trimmed}`;
    const replyText = await generateResponse(prompt);
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
    if (result.status === "error") return res.status(400).json({ error: result.error });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Billing failed" });
  }
});

app.post("/api/billing/confirm", requireAuth, async (req, res) => {
  try {
    const account = (req as any).account as Account;
    const sessionId = String(req.body?.session_id || req.body?.sessionId || "");
    if (!sessionId) return res.status(400).json({ error: "Missing session" });
    const result = await confirmSession(account, sessionId);
    if (result && "error" in result) return res.status(400).json({ error: result.error });
    res.json({ status: "ok", plan: (result as Account).plan, planUntil: (result as Account).planUntil });
  } catch {
    res.status(500).json({ error: "Billing failed" });
  }
});

app.post("/api/billing/usdt/pending", requireAuth, async (req, res) => {
  const account = (req as any).account as Account;
  const tier = String(req.body?.tier || "");
  const txid = req.body?.txid ? String(req.body.txid) : undefined;
  if (!TIERS.includes(tier as any)) return res.status(400).json({ error: "Unknown tier" });
  const entry = recordUsdtPending(account.id, tier, txid);
  if (!entry) return res.status(400).json({ error: "USDT payments are not configured." });
  const p = PLANS.find((x) => x.tier === tier);
  res.json({ status: "pending", tier, amount: p?.price || "", usdtAddress: process.env.USDT_ADDRESS });
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