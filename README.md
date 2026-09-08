# 🚀 TG Ezy AI OS

> **Telegram-first AI Marketing Command Center** — a free-stack platform where a Telegram bot runs your whole marketing life: lead capture, CRM pipeline, and every content tool a marketer needs, all powered by Mistral AI.

<p align="center">
  <img src="https://img.shields.io/badge/bot-Telegraf-2CA5E0?style=flat-square&logo=telegram" alt="Telegraf" />
  <img src="https://img.shields.io/badge/api-Express-000000?style=flat-square&logo=express" alt="Express" />
  <img src="https://img.shields.io/badge/ai-Mistral%20Free-orange?style=flat-square" alt="Mistral" />
  <img src="https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/db-JSON%20Store-005C5C?style=flat-square" alt="JSON store" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/github/actions/workflow/status/printezy247/tg_ezy_ai_os/ci.yml?style=flat-square&label=CI" alt="CI" />
</p>

---

## ✨ Why this bot?

Everything a marketer needs, in one Telegram chat — **every tool works two ways**: tap a button *or* type a command. Results come with **one-tap follow-ups** (hooks → captions → email), and the whole thing is gated by a **Free vs PRO** plan you control.

### 🤖 Bot
- 🗂️ **Lead CRM** — capture leads, set stages (`new → contacted → qualified → closed`), filter, stats, delete.
- 🧠 **AI Marketing Toolkit**
  - **Free tier:** Plan · Persona · SEO Meta · Value Map · Content Review · Growth Prompts · Swipe Files
  - **PRO tier:** 📝 Content Studio (posts/emails/hooks/captions) · ✉️ Campaign Builder · 🔑 Keyword Research · 🧲 Lead Magnets · ⚙️ Workflows
- 💳 **Monetization (EzyAi-style)** — `/plans`, free trial, `/redeem CODE`, admin `/mkcode` `/codes` `/revokecode` `/settrial`, `PRO_ACCESS_IDS` always-free list.
- 🎛️ **Guided flows** — submenus with `⬅️ Back` / `🏠 Main Menu`, plus inline one-tap follow-ups on every AI result.
- 📚 **Trading extras (EzyAi-inspired)** — `/quote`, `/fundamentals`, `/watch`, `/watches`, `/unwatch`, `/autopilot`.
- 🌐 **5 languages** — 🇬🇧 EN · 🇪🇸 ES · 🇫🇷 FR · 🇩🇪 DE · 🇨🇳 ZH.

### 📊 Dashboard (Attio-inspired)
- 🧭 Persistent left sidebar (Overview · Pipeline · Leads · Ask AI · Tools).
- 🏗️ **Kanban pipeline board** — move leads between stages inline.
- 📂 Clean **leads table** with initials avatars, stage chips, created/updated.
- ⚠️ **Leads At Risk** — stuck > 3 days panel.
- 💬 **Ask AI chat widget** wired to `/api/chat`.
- 📈 Live metrics + doughnut chart, auto-refresh every 10s.

---

## 🚀 Quick start

```bash
git clone https://github.com/printezy247/tg_ezy_ai_os.git
cd tg_ezy_ai_os

npm ci

copy .env.example .env   # Windows
#   BOT_TOKEN=...            from @BotFather
#   MISTRAL_API_KEY=...      from https://mistral.ai (free tier)
#   ADMIN_TELEGRAM_ID=...    (optional) your chat id — enables /mkcode etc.
#   PRO_ACCESS_IDS=...       (optional) comma-separated always-PRO chat ids

npm run dev
```

> ⚠️ **Windows PowerShell note:** if `npm` is blocked, use the wrapper: `& "C:\Program Files\nodejs\npm.cmd" run dev`.

The bot prints **"Bot started"** and the API is at `http://localhost:3000` → dashboard at [`/dashboard`](http://localhost:3000/dashboard).

---

## 🧰 Bot commands

| Command | Effect |
|---|---|
| `/start` `/help` | Welcome + full help menu |
| `/plans` | 💳 Pricing (Free/PRO/Enterprise) + trial button |
| `/redeem CODE` | 🎫 Activate a gift/trial code |
| `/addlead` | ➕ Guided 2-step lead capture (name → stage) |
| `/stage <new\|contacted\|qualified\|closed>` | 🔄 Set lead stage |
| `/stats` `/leads` | 📊 Stats + list (filter by stage) |
| `/deletelead <telegramId>` | 🗑️ Remove a lead |
| `/plan` `/persona` | 💳 Plan & brand persona settings |
| `/meta` `/valuemap` `/review` | 🔍 SEO meta · 🗺️ value map · ✏️ review |
| `/growth` `/swipe` | 📈 prompts · 📂 swipe files |
| `/content` `/campaign` `/keywords` `/leadmagnet` | 📝 PRO content studio, campaigns, keywords, magnets |
| `/workflow` `/remind` | ⚙️ automation notes · ⏰ set a reminder |
| `/quote` `/fundamentals` | 💰 quick quote · 📚 fundamentals |
| `/watch` `/watches` `/unwatch` `/autopilot` | 👁️ EzyAi-style live watches & auto-signals |
| `/dashboard` | 📊 Link to the dashboard |

**Admin-only:** `/mkcode trial <days> [count] [uses]` · `/mkcode 1mo [count] [uses]` · `/codes` · `/revokecode CODE` · `/settrial <1-30>`

---

## 🛠️ REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/api/leads` | List all leads |
| `GET` | `/api/leads/:id` | Single lead |
| `POST` | `/api/leads` | Create lead `{ telegramId, name, stage }` |
| `PATCH` | `/api/leads/:id` | Update `name` / `stage` |
| `DELETE` | `/api/leads/:id` | Delete lead |
| `GET` | `/api/stats` | `{ total, byStage, plan, aiCount }` |
| `POST` | `/api/chat` | AI chat `{ message }` → `{ reply }` |
| `GET` | `/dashboard` | HTML dashboard |

```bash
curl http://localhost:3000/api/stats
# {"total":5,"byStage":{"new":3,"contacted":2},"plan":"free","aiCount":12}
```

---

## 🗂️ Project layout

```
src/
  bot.ts          # Telegram bot — menus, flows, monetization, AI
  server.ts       # Express API + dashboard
  leadStore.ts    # JSON CRUD (db/leads.json)
  aiProvider.ts   # Mistral client (free tier)
public/
  dashboard.html  # Attio-style marketing dashboard
  lang/*.json     # 🇬🇧🇪🇸🇫🇷🇩🇪🇨🇳 language packs
db/
  leads.json      # Lead records
  state.json      # Per-user sessions, plans, watches, codes
```

---

## 💳 Monetization model (Free vs PRO)

| | Free | PRO |
|---|---|---|
| Leads, Stats, Pipeline | ✅ | ✅ |
| Plan · Persona · Meta · Value · Review · Growth · Swipe | ✅ | ✅ |
| Content Studio · Campaigns · Keywords · Lead Magnets | 🔒 | ✅ |
| Live watch/autopilot flows | — | ✅ |
| Price | $0 | `$14.99`/mo (set yours in `src/bot.ts`) |

- 🎁 Free trial: `/plans` → **Claim** (default 3 days, admin can `/settrial`).
- 🎫 Codes: create with `/mkcode`, redeem with `/redeem CODE`.
- 👥 `PRO_ACCESS_IDS` env grants permanent PRO to selected chat ids.

---

## 📈 Inspired by (design & structure)

- **[tradernonymous/EzyAi](https://github.com/tradernonymous/EzyAi)** — guided flows (pair → style → mode) with `Back/Cancel`, inline follow-ups (`Watch / Fundamentals / Quote`) on every result, persistent button menu, and Free-vs-PRO gating with `/plans`, `/redeem`, trials, and admin codes.
- **[attio.com](https://attio.com)** — premium dark CRM aesthetic for the dashboard: sidebar workspace, kanban pipeline board, clean leads table, "at risk" flags, and an AI assistant panel.
- **[telegraf/telegraf](https://github.com/telegraf/telegraf)** — feature-rich Telegram bot library.
- **[jquery-lang-js / filament-language-switch](https://github.com/jquery-lang-js/jquery-lang-js)** — instant client-side language switching via JSON packs + `localStorage`.
- **[twentycrm/twenty](https://github.com/twentycrm/twenty)** — AI-native CRM / pipeline ideas.
- **[activepieces/activepieces](https://github.com/activepieces/activepieces)** — no-code automation, inspiration for lead-stage workflows.

---

## 🛠️ Development workflow

1. **`npm run dev`** — hot-reload bot + API (`ts-node-dev`).
2. **`npm run lint`** — ESLint on all `.ts`.
3. **`npm run build`** — `tsc` → `dist/` (auto `postbuild` commits & pushes).
4. **`npm test`** — placeholder (tests coming).

---

## 📄 License

[MIT](LICENSE)

---

<p align="center"><sub>Built with ❤️ using only free services — Mistral free tier · JSON store · GitHub Actions · Express</sub></p>