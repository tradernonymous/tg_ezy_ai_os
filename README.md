# 🚀 TG Ezy AI OS

> **Telegram-first AI Marketing Command Center** — a free-stack platform where a Telegram bot runs your whole marketing life: lead capture, CRM pipeline, content tools, and a **unified multi-platform inbox** — all powered by Mistral AI, with an Attio-style dashboard. Now with **per-account workspaces**: sign in via **Google · Telegram · Magic Key** and every account gets its own leads, pipeline, tiers and inbox.

<p align="center">
  <img src="https://img.shields.io/badge/bot-Telegraf-2CA5E0?style=flat-square&logo=telegram" alt="Telegraf" />
  <img src="https://img.shields.io/badge/api-Express-000000?style=flat-square&logo=express" alt="Express" />
  <img src="https://img.shields.io/badge/ai-Mistral%20Free-orange?style=flat-square" alt="Mistral" />
  <img src="https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/db-JSON%20Store-005C5C?style=flat-square" alt="JSON store" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
</p>

---

## ✨ What this is

One Telegram chat + one web dashboard = your whole marketing operation:

- **🤖 Bot** — lead CRM, AI marketing toolkit, guided flows, monetization, reminders, broadcasts, and a **unified inbox status**.
- **📬 Unified Inbox** — every conversation from **Email · WhatsApp · Telegram · TikTok · Meta** lands in one place (simulated adapters ship by default with real numbers to demo). Reply from the dashboard or the bot; each reply schedules a realistic follow-up.
- **📊 Dashboard** — a premium, Attio-grade dark workspace: design token system, collapsible sidebar, **Ctrl/⌘K command palette**, overview metrics, value-weighted kanban, a **full leads workspace** (search, stage/channel filters, sortable table, density toggle, row selection + bulk actions, contextual detail drawer), unified **inbox with thread view + composer**, and **context-aware Ask AI**. An energetic **motion layer** (aurora background, cursor glow, tilt cards, confetti, count-up metrics, staggered entrances) ships on by default and respects `prefers-reduced-motion` or the ✦ toggle. No chart library — lightweight CSS visuals keep it fast.
- **🔐 Accounts & plans** — web login with **Google, Telegram Login Widget or Magic Key (dev-preview codes)**. Sessions are HMAC-signed cookies (`__Host-` in prod, 7-day expiry, no new deps). Each account has its own data; the first account **adopts** the existing demo data as its owner workspace. **Five tiers — Free · Hobby · Marketer · Navigator · Thinker** — gate every tool on the client *and* the server.

Every tool works **two ways**: tap a button *or* type a command. Results come with **one-tap follow-ups**, and the whole thing is gated by a **5-tier plan** you control (self-serve: no Stripe/Stars needed — connect Stripe/USDT keys later to go live).

---

## 🧭 Features

### 🤖 Bot
- 🗂️ **Lead CRM** — capture leads (name → stage), set stages (`new → contacted → qualified → closed`), filters, stats, delete, **CSV export**.
- 🧠 **AI Marketing Toolkit**
  - **Free:** Leads · Stats · Pipeline · Plan
  - **Hobby:** Persona · SEO Meta
  - **Marketer:** Content Review · Growth Prompts · Swipe Files
  - **Navigator (legacy PRO):** Value Map · Content Studio · Campaigns · Keywords · Lead Magnets · Workflow · Exports
  - **Thinker (legacy Enterprise):** everything + Unified Inbox
- 📬 **Inbox** — `/inbox` shows unread counts per channel + one-tap link to the dashboard thread view (full inbox view requires **Thinker**).
- 💳 **Monetization** — `/plans` (5 tiers), free trial, `/redeem CODE`, admin `/mkcode` `/codes` `/revokecode` `/settrial`, `PRO_ACCESS_IDS` always-free list. Legacy `pro → navigator`, `enterprise → thinker`.
- 📡 **Broadcast** — admin-only push message to every known chat + lead.
- ⏰ **Reminders** — persisted across bot restarts (`🕘 Remind` / `/remind`).
- ⚙️ **Settings** — Profile, Notifications toggle, Business profile (feeds the AI with real facts), Danger Zone, and i18n.
- 🛰️ **Trading extras (EzyAi-inspired)** — `/quote`, `/fundamentals`, `/watch`, `/watches`, `/unwatch`, `/autopilot`.
- 🌐 **5 languages** — 🇬🇧 EN · 🇪🇸 ES · 🇫🇷 FR · 🇩🇪 DE · 🇨🇳 ZH (localized keyboards, single source of truth in `src/menus.ts`).

### 📊 Dashboard (Attio-grade UX)
- 🧭 **App shell** — collapsible sidebar (232px → icon rail, `Ctrl+\`), sticky blurred topbar with health + "Updated" indicator, contextual page headers, off-canvas nav on mobile.
- ⌨️ **Command palette** — `Ctrl/⌘+K` searches views, leads (name/ID/owner/tags) and actions (add lead, refresh, go to inbox, toggle sidebar) with full keyboard navigation.
- 📬 **Unified Inbox view** — channel pills, conversation list with unread counts + "You: …" previews, thread pane, brand composer with sending state.
- 🏗️ **Value-weighted kanban** — column totals, cards show owner + value + last activity + advance action.
- 📂 **Leads workspace** — live search, **stage filter pills**, channel filter, 5 sort modes, compact/standard density, **row selection + bulk stage/delete**, sticky sortable header, hover-revealed row actions.
- 🧾 **Lead detail drawer** — click any lead: full record (value, owner, tags), staged actions, **Ask-AI briefing**, inline edit form, drag-to-resize.
- 👤 **CRUD** — ➕ Add (modal) / edit (drawer) / delete (styled confirm + toast), all wired to `POST`/`PATCH`/`DELETE /api/leads`.
- 💰 Metrics: total leads (per-stage chips), **pipeline value**, **closed value**, **unread per channel**.
- ⚠️ **Leads At Risk** (stuck > 3 days) with **Reply / Bump stage** actions + animated stage distribution.
- ✨ **System UX** — toasts, styled confirm dialog, skeleton loaders, empty/error states with CTAs, focus-visible rings, ARIA labels, `Esc` closes overlays, auto-refresh every 20s.

---

## 🚀 Quick start

```bash
git clone https://github.com/tradernonymous/tg_ezy_ai_os.git
cd tg_ezy_ai_os

npm ci

copy .env.example .env   # Windows  (cp .env.example .env on Linux/macOS)
#   BOT_TOKEN=...            from @BotFather
#   MISTRAL_API_KEY=...      from https://mistral.ai (free tier)
#   ADMIN_TELEGRAM_ID=...    (optional) your chat id — enables /mkcode /broadcast etc.
#   PRO_ACCESS_IDS=...       (optional) comma-separated always-PRO chat ids
#   PUBLIC_URL=...           (optional) e.g. https://your-app.fly.dev — links in bot

npm run dev
```

> ⚠️ **Windows PowerShell note:** if `npm` is blocked, use the wrapper: `& "C:\Program Files\nodejs\npm.cmd" run dev`.

The bot prints **"Bot started"** and the API is at `http://localhost:3000` → sign in at [`/login`](http://localhost:3000/login) (Magic Key dev-preview shows your code instantly), then the dashboard at [`/dashboard`](http://localhost:3000/dashboard). The first account automatically becomes the Thinker-plan owner and adopts the existing demo data; later accounts are Free with an empty workspace.

### Test it end-to-end (5 min)
1. Message your bot `/start`, then `/plans` → **Claim free trial** → PRO unlocks.
2. `➕ Add Lead` → name → stage. Or add directly from the dashboard (**Leads → ➕ Add Lead**).
3. Tap **📬 Inbox** (or `/inbox`) → open a conversation → reply → a simulated follow-up arrives in ~20–45s.
4. Open the dashboard → **Inbox** → select a thread → send a reply. Then **Leads** → **➕ Add Lead / ✏️ Edit / 🗑️ Delete** to manage records.

> 🟢 Live demo: the project is deployed at <https://tg-ezy-ai-os-young-blossom-4821.fly.dev/dashboard> (Bot + API + dashboard in one container, data on a Fly volume).

---

## 🧰 Bot commands

| Command | Effect |
|---|---|
| `/start` `/help` | Welcome + full help menu |
| `/plans` | 💳 Pricing (5 tiers in `src/plans.ts`) + trial button |
| `/redeem CODE` | 🎫 Activate a gift/trial code |
| `/addlead` | ➕ Guided 2-step lead capture (name → stage) |
| `/stage <new\|contacted\|qualified\|closed>` | 🔄 Set lead stage |
| `/stats` `/leads` | 📊 Stats + list (filter by stage) |
| `/inbox` | 📬 Unified inbox: unread per channel + dashboard link |
| `/deletelead <telegramId>` | 🗑️ Remove a lead |
| `/plan` `/persona` | 💳 Plan & brand persona settings |
| `/meta` `/valuemap` `/review` | 🔍 SEO meta · 🗺️ value map · ✏️ review |
| `/growth` `/swipe` | 📈 prompts · 📂 swipe files |
| `/content` `/campaign` `/keywords` `/leadmagnet` | 📝 PRO content studio, campaigns, keywords, magnets |
| `/workflow` `/remind` | ⚙️ automation notes · ⏰ set a reminder |
| `/business` | 🏢 Business profile (feeds AI writing) |
| `/export` | 📦 Export leads as CSV |
| `/quote` `/fundamentals` | 💰 quick quote · 📚 fundamentals |
| `/watch` `/watches` `/unwatch` `/autopilot` | 👁️ EzyAi-style live watches & auto-signals |
| `/dashboard` | 📊 Link to the dashboard |

**Admin-only:** `/mkcode trial <days> [count] [uses]` · `/mkcode 1mo [count] [uses]` · `/codes` · `/revokecode CODE` · `/settrial <1-30>` · `/broadcast <message>`

---

## 🛠️ REST API

> ⚠️ **Auth:** every `/api/*` route except `/api/auth/*` (and the static pages) requires the session cookie set by `/api/auth/*`. `/dashboard` redirects to `/login` when not signed in. Tools are additionally **server-gated by plan tier**.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness (200/503) — used by Docker & Fly machine checks |
| `GET` | `/login` `/home` | Sign-in page · public landing page |
| `GET` | `/pricing` | 5 plan tiers (`{ plans: [...] }`) |
| `GET` | `/api/auth/config` | Providers + Google client id + bot username + magic dev flag |
| `POST` | `/api/auth/google` | Verify GSI credential (`tokeninfo`) → create/sign-in account |
| `POST` | `/api/auth/telegram` | Verify Login Widget hash with `BOT_TOKEN` → create/sign-in account |
| `POST` | `/api/auth/magic/request` | Issue 6-digit code (`MAGIC_DEV_PREVIEW` returns it in the response) |
| `POST` | `/api/auth/magic/verify` | Exchange code for a session |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET` | `/api/me` | Current account + plan |
| `GET` | `/api/leads` | List the **account's** leads |
| `GET` | `/api/leads/:id` | Single lead (account-scoped) |
| `POST` | `/api/leads` | Create lead `{ telegramId, name, stage, channel, email, phone, tags, value, owner }` |
| `PATCH` | `/api/leads/:id` | Update fields (validated + clamped, account-scoped) |
| `DELETE` | `/api/leads/:id` | Delete lead (account-scoped) |
| `GET` | `/api/stats` | `{ total, byStage, byChannel, pipelineValue, closedValue, plan, aiCount, inbox }` |
| `POST` | `/api/chat` | AI chat `{ message }` → `{ reply }` (rate-limited) |
| `POST` | `/api/tools/:id` | Run a tool — server-side gated by tier (403 `{ type:"upgrade" }` if locked) |
| `GET` | `/api/conversations` | Inbox threads, **Thinker-gated**, account-scoped (`?channel=…`) |
| `GET` | `/api/conversations/:id` | Full thread (account-scoped) |
| `POST` | `/api/conversations/:id/read` | Mark thread read (account-scoped) |
| `POST` | `/api/conversations/:id/reply` | Send brand reply `{ text }` |
| `GET` | `/api/inbox` | Unread totals per channel (summary for non-Thinker, `view: "full"` for Thinker) |
| `POST` | `/api/billing/checkout` | Billing placeholder — `pending-config` until Stripe/USDT keys are set |
| `GET` | `/api/billing/status` | Stripe/USDT config booleans |
| `GET` | `/dashboard` | HTML dashboard (redirects to `/login` if signed out) |

```bash
curl http://localhost:3000/api/stats
# {"total":5,"byStage":{"new":3,"contacted":2},"byChannel":{"telegram":5},"pipelineValue":1200,"plan":"pro","aiCount":12,"inbox":{"total":3,"byChannel":{"email":1,"whatsapp":1,"telegram":0,"tiktok":1,"meta":0}}}
```

Security & robustness: JSON body **size limit** (100kb), **rate limiting** on `/api/chat` and inbox replies, input **validation/sanitization**, atomic JSON writes with `.bak` recovery, AI client with **timeout + retry/backoff**.

---

## 🌍 Environment variables

| Var | Default | Purpose |
|---|---|---|
| `BOT_TOKEN` | — | Telegram bot token (required) |
| `MISTRAL_API_KEY` | — | Mistral key (required for AI) |
| `AI_PROVIDER` | `mistral` | AI provider |
| `AI_MODEL` | `mistral-tiny` | Model (free-tier friendly) |
| `AI_TEMPERATURE` | `0.7` | Creativity |
| `AI_MAX_TOKENS` | `1024` | Max output length |
| `AI_TIMEOUT_MS` | `25000` | Per-call timeout |
| `AI_RETRIES` | `2` | Retries on 429/5xx/abort |
| `PORT` | `3000` | Server port |
| `PUBLIC_URL` | `http://localhost:3000` | Base URL used in bot links |
| `CORS_ORIGIN` | `*` | Allowed dashboard origins |
| `RATE_LIMIT` | `30` | Requests/min/IP on AI + inbox routes |
| `INBOX_SIM` | `true` | Simulated inbox adapters; set `false` to disable seeding |
| `ADMIN_TELEGRAM_ID` | — | Chat id that unlocks admin commands |
| `PRO_ACCESS_IDS` | — | Comma-separated always-PRO chat ids |
| `SESSION_SECRET` | — | **≥32 chars**, HMAC-signs web sessions (required for restarts to keep sessions valid) |
| `GOOGLE_CLIENT_ID` | — | OAuth Web client id → enables "Continue with Google" on `/login` |
| `BOT_USERNAME` | — | Public bot username → enables the Telegram Login Widget |
| `MAGIC_DEV_PREVIEW` | `true` | Magic Key codes shown in-browser (dev preview) instead of shipped to email/Telegram |
| `STRIPE_SECRET_KEY` | — | Set to turn on Stripe checkout (placeholder — SDK not installed yet) |
| `USDT_ADDRESS` | — | Set to offer manual USDT checkout |
| `DATA_DIR` | `<project>/db` | Where JSON stores live |

---

## 🗂️ Project layout

```
src/
  bot.ts          # Telegram bot — menus, guided flows, monetization, admin, reminders
  menus.ts        # Single source of truth: keyboards, 5-language labels, nav map, ALL_LABELS
  server.ts       # Express API + auth + tier gating + dashboard + inbox + rate limiting
  plans.ts        # Single source of truth for the 5 plan tiers (web + bot share this)
  toolGates.ts    # Per-tool minimum tier mapping (client mirrors this in dashboard.html)
  accountStore.ts # Per-account workspaces (db/accounts.json, first account adopts demo data)
  session.ts      # HMAC-SHA256 signed cookies (node:crypto, __Host- in prod, 7-day expiry)
  magic.ts        # One-time Magic Key codes (6-digit, 10-min TTL, dev-preview delivery)
  billing.ts      # Stripe/USDT checkout placeholder (pending-config until keys set)
  leadStore.ts    # Lead CRUD + sanitization + CSV export (db/leads.json, account-scoped)
  inbox.ts        # Unified multi-platform inbox (simulated) — db/conversations.json
  stateStore.ts   # Atomic crash-safe JSON store with .bak recovery
  aiProvider.ts   # Mistral client — timeout, retries, backoff
  __tests__/      # Unit tests (node:test) for plans, session, accounts, stores, inbox
public/
  index.html      # Public landing page (served at /home)
  login.html      # Sign-in: Google · Telegram · Magic Key
  dashboard.html  # Attio-style dashboard incl. inbox thread view + plans modal
db/
  accounts.json   # Account workspaces + plans (created on first sign-in)
  leads.json      # Lead records (account-scoped)
  state.json      # User sessions, plans, codes, reminders, watches
  conversations.json  # Inbox threads (created on first seed)
  magic.json      # One-time magic codes (created on first request)
```

---

## 💳 Monetization model (5 tiers — shared by bot + web)

Single source of truth: `src/plans.ts`. Dashboard tools, web APIs and bot gating all read the same matrix.

| Tier | Price | Unlocks | Legacy |
|---|---|---|---|
| Free | $0 | Leads · Stats · Pipeline · Plan · Inbox summary | free |
| Hobby | $9/mo | Persona · SEO Meta | — |
| Marketer | $29/mo | Content Review · Growth Prompts · Swipe Files | — |
| Navigator | $99/mo | Value Map · Content Studio · Campaigns · Keywords · Lead Magnets · Workflow · Exports | pro |
| Thinker | $299/mo | Everything + **Unified Inbox** | enterprise |

- 🎁 Free trial: `/plans` → **Claim** (default 3 days, admin can `/settrial`).
- 🎫 Gift codes: create with `/mkcode`, redeem with `/redeem CODE`.
- 👥 `PRO_ACCESS_IDS` env grants permanent access.
- 🔌 Billing: Stripe + USDT are **placeholders** (`/api/billing/checkout` → `pending-config`) until you drop keys in. Telegram codes keep working.
- Self-serve by design — no payment provider required to launch.

---

## 🐳 Deployment (Docker / Fly.io)

Single image runs **both** bot and API; `/health` drives machine checks.

```bash
# local
docker build -t tg-ezy-ai-os .

# fly.io (first time — creates the app from fly.toml)
fly launch --copy-config --name <your-app-name>
fly secrets set "BOT_TOKEN=..." "MISTRAL_API_KEY=..." "ADMIN_TELEGRAM_ID=..." "PRO_ACCESS_IDS=..."
fly deploy

# after every code change, redeploy (builds from source inside the container):
fly deploy

# persist data on a volume (attached automatically via fly.toml mount)
# then set PUBLIC_URL=https://<your-app-name>.fly.dev so bot links point to the live app
```

> Reminder: `fly deploy` rebuilds from the committed source — the dashboard lives in `public/` and is baked into the image, so redeploy is all that's needed to ship dashboard UI changes.

CI (`.github/workflows/ci.yml`, **Node 22**, `actions/checkout`/`setup-node` v5) runs **type-check + the full test suite** on every push/PR to `main` — currently **green** ✅. No API keys needed to build or test.

---

## 🧪 Development workflow

1. **`npm run dev`** — hot-reload bot + API (`ts-node-dev`).
2. **`npm run tsc`** — type-check / compile to `dist/`.
3. **`npm test`** — compiles, then runs the `node:test` suite via `scripts/run-tests.mjs` (auto-discovers `dist/__tests__/*.test.js`; works on Node 18+, no glob issues on Windows or CI).
4. **`npm run lint`** — ESLint on all `.ts`.
5. **`npm run build`** — `tsc` → `dist/`.

> ⚠️ **Requires Node ≥ 18** (recommend **Node 22 LTS** — matches CI). The package's `prebuild`/`postbuild` hooks verify the working tree stays clean after builds.

---

## 📈 Inspired by (design & structure)

- **[tradernonymous/EzyAi](https://github.com/tradernonymous/EzyAi)** — guided flows with `Back/Cancel`, inline follow-ups on every AI result, persistent button menu, Free-vs-PRO gating with `/plans`, `/redeem`, trials, and admin codes.
- **[attio.com](https://attio.com)** — premium dark CRM aesthetic: sidebar workspace, kanban pipeline, clean tables, inbox-focused layout.
- **[telegraf/telegraf](https://github.com/telegraf/telegraf)** — feature-rich Telegram bot library.
- **[twentycrm/twenty](https://github.com/twentycrm/twenty)** — AI-native CRM / pipeline ideas.
- **[activepieces/activepieces](https://github.com/activepieces/activepieces)** — no-code automation, inspiration for lead-stage workflows.

---

## 📄 License

[MIT](LICENSE)

---

<p align="center"><sub>Built with ❤️ using only free services — Mistral free tier · JSON store · GitHub Actions · Express</sub></p>