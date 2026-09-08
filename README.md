# 📣 tg_ezy_ai_os

**Telegram‑first AI Marketing OS** – a lightweight, free‑service‑only platform that lets a Telegram bot capture leads, store them in a local JSON file, and expose a REST API for dashboards or internal tools. Powered by Mistral AI for natural‑language replies.

--- 

## ✨ Features (MVP)

- 🤖 **Telegram bot** (Telegraf) that welcomes users, pings, and forwards text to Mistral AI.  
- 🌐 **Express REST API** (`/api/leads`, `/api/stats`) backed by a local `db/leads.json` file – no external DB required.  
- 🧠 **Mistral AI** integration for AI‑generated responses (free tier).  
- 📁 **Zero‑config data store** – all leads live in `db/leads.json`; easy to back up or migrate.  
- 🛠️ **TypeScript** (strict) with ESLint, ready for CI.  
- 📡 **GitHub Actions** CI that lints, builds, and tests on every push/PR.  
- 🎨 **Modern, futuristic UI** – premium dark theme with glassmorphism cards (see the dashboard below).

--- 

## 🚀 Quick start (local development)

```bash
# 1️⃣ Clone (already done)
cd tg_ezy_ai_os

# 2️⃣ Install dependencies
npm ci

# 3️⃣ Create .env (copy from .env.example) and fill your credentials
cp .env.example .env
#   – BOT_TOKEN = your Telegram Bot token (get from @BotFather)
#   – MISTRAL_API_KEY = your Mistral API key (sign up at https://mistral.ai)

# 4️⃣ Start both the bot and the API server
npm run dev
```

The bot will print **“Bot started”** and the API will be reachable at `http://localhost:3000`.

--- 

## 🛠️ API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Health check – returns `{status:"ok"}`. |
| `GET` | `/api/leads` | List all leads (optionally filter `?stage=new`). |
| `GET` | `/api/leads/:id` | Get a single lead by its internal `id`. |
| `POST` | `/api/leads` | Create a new lead. Body: `{ "telegramId": "123456789", "name":"Alice", "stage":"new" }`. |
| `PATCH` | `/api/leads/:id` | Update a lead’s `name` or `stage`. |
| `DELETE` | `/api/leads/:id` | Delete a lead. |
| `GET` | `/api/stats` | Totals and breakdown by stage, e.g. `{total:5, byStage:{new:3, contacted:2}}`. |

**cURL examples**

```bash
# Health
curl http://localhost:3000/

# List leads
curl http://localhost:3000/api/leads

# Add a lead
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  -d '{"telegramId":"987654321","name":"Bob","stage":"new"}'

# Stats
curl http://localhost:3000/api/stats
```

--- 

## 🤖 Bot commands

| Command | Effect |
|---------|--------|
| `/start` | Replies with a welcome message and shows the **Main Menu** keyboard. |
| `/ping` | Replies `pong`. |
| `/addlead` | Puts the bot into “name‑capture” mode; the next message you send is stored as the lead’s name. |
| `/stage <New\|Contacted\|Qualified\|Closed>` | Directly sets the lead’s stage. Example: `/stage qualified`. |
| Any other text message | If the bot is not in a lead‑creation flow, it simply echoes **“You said: …”** (replace later with a Mistral call). |

--- 

## 📦 Dependencies (free only)

| Package | Purpose |
|---------|---------|
| `telegraf` | Telegram Bot API wrapper |
| `express` | HTTP server |
| `dotenv` | Environment variables |
| `node-fetch` | HTTP requests to Mistral AI |
| `concurrently` | Run bot & server together |
| `typescript` | Static typing |
| `eslint` + `@typescript-eslint` | Code quality |

--- 

## 📈 Inspired by / Trending repos

- **[telegraf/telegraf](https://github.com/telegraf/telegraf)** – Feature‑rich Telegram bot library.  
- **[langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs)** – LLM orchestration, free and open‑source.  
- **[twentycrm/twenty](https://github.com/twentycrm/twenty)** – AI‑native CRM, lead pipeline ideas.  
- **[chatwoot/chatwoot](https://github.com/chatwoot/chatwoot)** – Unified inbox & human takeover, useful for support bots.  
- **[activepieces/activepieces](https://github.com/activepieces/activepieces)** – No‑code automation, inspiration for lead‑stage workflows.  
- **[vercel/ai-chatbot](https://github.com/vercel/ai-chatbot)** – Minimal AI chatbot backend, free deployment on Vercel.

--- 

## 🛠️ Development workflow

1. **`npm run dev`** – starts bot & API with hot‑reload (`ts-node-dev`).  
2. **`npm run lint`** – lints all `.ts` files.  
3. **`npm run build`** – compiles TS to `dist/`.  
4. **`npm test`** – placeholder (add real tests later).  
5. **CI** (GitHub Actions) runs steps 2‑4 on every push/PR.  

*After each `npm run build` the `postbuild` script automatically commits and pushes any changes (see `package.json`).*

--- 

## 📄 License

[MIT](LICENSE)

---

*Built with ❤️ using only free services (Mistral free tier, JSON store, GitHub Actions).*