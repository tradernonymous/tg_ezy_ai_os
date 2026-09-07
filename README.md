# 📣 tg_ezy_ai_os

**Telegram‑first AI Marketing OS** – a single dashboard that knows every lead, their actions, interests, stage, and what should happen next, and lets AI execute the next marketing move.

---

## ✨ Features (MVP)
- 🤖 **Telegram bot** built with **Telegraf** that can receive commands, forward messages to OpenAI, and reply with AI‑generated content.
- 🌐 **Express API** exposing health, webhook, and future CRM endpoints.
- 🗂️ **TypeScript** codebase (strict mode) with **ESLint** + **Prettier** ready for CI.
- 📦 **GitHub Actions** CI that lints, builds, and runs placeholder tests on every push/PR.
- 📦 **Dockerfile** (coming soon) for easy deployment.

---

## 🚀 Quick start (local development)
```bash
# Clone (already done)
cd tg_ezy_ai_os

# Install deps
npm ci

# Create a .env file (copy from .env.example)
cp .env.example .env
# Fill in your Telegram bot token and OpenAI API key

# Run both server and bot in dev mode
npm run dev
```
The bot will start listening on the token you provide; the HTTP server will be reachable at `http://localhost:3000/`.

---

## 📚 Architecture overview
```
+-- src/                     # TypeScript source
|   +-- bot.ts               # Telegram bot (Telegraf)
|   +-- server.ts            # Express health endpoint
|   +-- index.ts (placeholder)
+-- .eslintrc.json          # Lint config
+-- tsconfig.json           # TS compiler config
+-- package.json            # Scripts, deps
+-- .github/workflows/ci.yml # CI pipeline
```
Future components (not yet in the repo):
- **CRM / Lead DB** (PostgreSQL + Prisma)
- **Analytics dashboard** (React + Next.js hosted as a Telegram Mini‑App)
- **AI agents** (OpenAI function calling, LangChain, etc.)

---

## 📦 Dependencies
| Dependency | Purpose |
|------------|---------|
| `telegraf` | Telegram Bot API wrapper |
| `express`  | Simple HTTP server |
| `dotenv`   | Environment variables |
| `openai`   | AI model integration |
| `concurrently` | Run bot & server together |
| `typescript` | Static typing |
| `eslint` + `@typescript-eslint` | Code quality |

---

## 📈 Related/open‑source projects you might find useful
- **[Postiz](https://github.com/postiz/postiz)** – social scheduling + AI + analytics (Content OS)
- **[ChatbotX](https://github.com/ChatbotX/ChatbotX)** – AI ManyChat alternative (Telegram/omnichannel automation)
- **[TwentyCRM](https://github.com/twentycrm/twenty)** – AI‑native CRM (lead pipeline)
- **[Chatwoot](https://github.com/chatwoot/chatwoot)** – unified inbox + human takeover (Telegram support)

---

## 🛠️ Development workflow
1. **`npm run dev`** – runs the bot and API with hot‑reload (`ts-node-dev`).
2. **`npm run lint`** – lints all `.ts` files.
3. **`npm run build`** – compiles source to `dist/`.
4. **`npm test`** – placeholder test suite (add real tests later).
5. CI runs steps 2‑4 on every push/PR.

---

## 📄 License
[MIT](LICENSE)
