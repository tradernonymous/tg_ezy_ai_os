import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { addLead, updateLeadByTelegramId, getLeads, deleteLead, toCsv } from './leadStore';
import { generateResponse } from './aiProvider';
import { loadState, saveState } from './stateStore';
import { MENUS, MENU_PARENT, ALL_LABELS, labelVariants, localize, normalizeLang } from './menus';
import { unreadTotals } from './inbox';
import { getAccountByProviderKey } from './accountStore';
import { createCheckoutForChatId, activateAccount, priceLabel, usdtConfigured } from './billing';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');

const userState = loadState();

// ---------- Helpers ----------
async function safeGenerateResponse(prompt: string): Promise<string> {
  const reply = await generateResponse(prompt);
  return truncateText(reply || 'No response from AI.');
}

function truncateText(text: string, max = 3600): string {
  if (text.length > max) return text.slice(0, max) + '... [truncated]';
  return text;
}

function loadLang(langCode: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'lang', `${langCode}.json`), 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function t(id: string, langCode?: string): string {
  const code = langCode || 'en';
  const lang = loadLang(code);
  return lang[id] || id;
}

function getUid(ctx: any): string {
  return ctx?.from?.id ? ctx.from.id.toString() : '';
}

// ---------- Monetization config (unified 5-tier via plans.ts) ----------
const ADMIN_TELEGRAM_ID = (process.env.ADMIN_TELEGRAM_ID || '').toString();
const PRO_ACCESS_IDS = (process.env.PRO_ACCESS_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
import { PLANS as ALL_PLANS, mapLegacy, tierIndex, isTier } from './plans';
const PLANS = ALL_PLANS.map((p) => ({ tier: p.tier, label: p.label, price: p.price.replace('/mo', ''), features: p.features.join(', ') }));
const PRO_FEATURES = ['📝 Content', '✉️ Campaign', '🔑 Keywords', '🧲 Lead Magnet', '⚙️ Workflow', '📈 Growth', '📦 Export CSV'];

function isPayingUser(id?: string): boolean {
  if (!id) return false;
  if (PRO_ACCESS_IDS.includes(id)) return true;
  // Payments (Stripe / USDT) are recorded on the linked web account (accounts.json);
  // the bot reads it at gate time so web and Telegram stay in sync across processes.
  const tgAccount = getAccountByProviderKey('telegram', id);
  if (tgAccount && tierIndex(tgAccount.plan) > 0) {
    if (tgAccount.planUntil && new Date(tgAccount.planUntil).getTime() <= Date.now()) return false; // expired
    return true;
  }
  const s = userState[id];
  if (!s) return false;
  const tier = mapLegacy(s.plan);
  if (tierIndex(tier) > 0) {
    // Expired recurring access (legacy pro → navigator) drops back to free.
    if (tier === 'navigator' && s.proUntil && new Date(s.proUntil).getTime() <= Date.now()) {
      s.plan = 'free';
      delete s.proUntil;
      saveState(userState);
      return false;
    }
    return true;
  }
  if (s.trialEndsAt && new Date(s.trialEndsAt).getTime() > Date.now()) return true;
  return false;
}

function isAdmin(id?: string): boolean {
  return !!id && id === ADMIN_TELEGRAM_ID;
}

function getPlanLabel(state: any): string {
  if (state?.plan) {
    const tier = mapLegacy(state.plan);
    return PLANS.find((p) => p.tier === tier)?.label || String(tier).toUpperCase();
  }
  if (state?.trialEndsAt && new Date(state.trialEndsAt).getTime() > Date.now()) return 'PRO (trial)';
  return 'Free';
}

const proGate = (ctx: any, premiumAction: () => any) => {
  const id = getUid(ctx);
  if (!isPayingUser(id)) {
    ctx.reply('🔒 *This is a PRO feature.*\n\nUpgrade with /plans or claim your free trial to unlock Content Studio, Campaigns, Keywords, Lead Magnets, Exports & more.', { parse_mode: 'Markdown', reply_markup: MENUS.main((s) => s) } as any);
    return;
  }
  return premiumAction();
};

// ---------- Keyboard helper -------------------------------------------------

function showMenu(ctx: any, menuId: string): any {
  const id = getUid(ctx);
  const lang = id ? userState[id]?.lang : undefined;
  const l = localize(lang);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].menu = menuId;
    userState[id].type = 'idle';
    delete userState[id].guided;
    saveState(userState);
  }
  return { reply_markup: MENUS[menuId](l) };
}

function backMenu(ctx: any): string {
  const id = getUid(ctx);
  const cur = id ? userState[id]?.menu : undefined;
  return (cur && MENU_PARENT[cur]) || 'main';
}

function toMain(ctx: any): void {
  const id = getUid(ctx);
  if (id && userState[id]) {
    const prev = userState[id];
    userState[id] = { type: 'idle' };
    for (const k of ['lang', 'plan', 'proUntil', 'trialEndsAt', 'persona', 'business', 'notifications', '__reminders', 'aiCount']) {
      if (prev[k] !== undefined) userState[id][k] = prev[k];
    }
    saveState(userState);
  }
}

// ---------- Handler registry (single source of truth) -----------------------

const handledLabels = new Set<string>();
function hearsMenu(label: string, fn: (ctx: any) => any): void {
  handledLabels.add(label);
  bot.hears(labelVariants(label) as any, fn);
}

function allButtonVariants(): string[] {
  const set = new Set<string>();
  for (const label of ALL_LABELS) {
    for (const v of labelVariants(label)) set.add(v);
  }
  return Array.from(set);
}
const buttonTexts = new Set(allButtonVariants());

// ---------- Inline + status markup ------------------------------------------

const stageKeyboard = {
  inline_keyboard: [
    [
      { text: '🟢 New', callback_data: 'stage_new' },
      { text: '🟡 Contacted', callback_data: 'stage_contacted' },
    ],
    [
      { text: '🟦 Qualified', callback_data: 'stage_qualified' },
      { text: '🟨 Closed', callback_data: 'stage_closed' },
    ],
  ],
};

const forceReply = { force_reply: true };

function guidedRow(): Record<string, any> {
  return {
    inline_keyboard: [
      [{ text: '⚡ Quick Generate', callback_data: 'g_quick' }],
      [{ text: '🚫 Cancel', callback_data: 'g_cancel' }],
    ],
  };
}

function followUpRow(topic: string): Record<string, any> {
  return {
    inline_keyboard: [
      [{ text: '✍️ More Hooks', callback_data: 'fup_hooks' }, { text: '🏷️ Captions', callback_data: 'fup_captions' }],
      [{ text: '📧 Email', callback_data: 'fup_email' }, { text: '🏠 Main Menu', callback_data: 'fup_menu' }],
    ],
  };
}

function rememberTopic(id: string | undefined, topic: string): void {
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].lastTopic = topic.slice(0, 400);
    saveState(userState);
  }
}

// ---------- Guided flows ------------------------------------------------------

const TOOL_GENERATORS: Record<string, { title: (t: string) => string; build: (t: string) => string }> = {
  post: { title: (t) => `📝 Social Post — ${t}`, build: (t) => `Write a social media post (140-220 words) about "${t}". Give 3 tones: friendly, professional, witty. Keep each punchy with a strong hook.` },
  email: { title: (t) => `📧 Email — ${t}`, build: (t) => `Write a short cold outreach email (subject + 80-120 word body + CTA) for "${t}". Keep it personal and non-spammy.` },
  hook: { title: (t) => `✍️ Hooks — ${t}`, build: (t) => `Create 5 attention-grabbing hooks/openers for "${t}" (question, stat, story, contrarian, direct). One line each.` },
  caption: { title: (t) => `🏷️ Captions — ${t}`, build: (t) => `Write 10 short captions (under 100 chars) with 4-5 fitting hashtags for "${t}".` },
  meta: { title: (t) => `🔍 SEO Meta — ${t}`, build: (t) => `Generate SEO meta title (50-60 chars), meta description (155-160 chars), and URL slug for topic: ${t}` },
  value: { title: (t) => `🗺️ Value Map — ${t}`, build: (t) => `Generate an OSP-style product value map for product: ${t}. Include tagline, value statements, persona needs, and feature categories.` },
  review: { title: () => '✏️ Content Review', build: (c) => `Review this content using OSP editing codes (scope, flow, style, word choice, grammar, technical accuracy). Provide constructive feedback with before/after examples. Content: ${c}` },
  ideas: { title: (t) => `💡 Campaign Ideas — ${t}`, build: (t) => `Give 7 creative marketing campaign ideas for "${t}". For each: name, one-line concept, target channel, and expected goal.` },
  launch: { title: (t) => `📰 Launch Checklist — ${t}`, build: (t) => `Create a product launch checklist for "${t}": pre-launch, launch day, post-launch phases with concrete marketing actions and channels.` },
  keywords: { title: (t) => `🔑 Keyword Research — ${t}`, build: (t) => `For the niche "${t}", list 12 keyword ideas grouped by search intent: informational, commercial, transactional. Suggest a primary and secondary keyword for each group.` },
  leadmagnet: { title: (t) => `🧲 Lead Magnets — ${t}`, build: (t) => `Suggest 5 high-converting lead magnet ideas for "${t}" (ebook, checklist, template, webinar, tool). For each: format, main promise/benefit, and how to deliver.` },
};

function defaultTopic(ctx: any): string {
  const id = getUid(ctx);
  const s = id ? userState[id] : undefined;
  if (s?.business?.name) return s.business.name;
  if (s?.lastTopic) return s.lastTopic;
  return 'our product';
}

function startGuided(ctx: any, tool: string): void {
  const id = getUid(ctx);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'guided';
    userState[id].guided = { tool };
    saveState(userState);
  }
  ctx.reply(`✍️ *Tell me your topic*\n\nWhat are we writing about? (product, offer, niche, or paste content to review)\n\nOr tap *⚡ Quick Generate* for a default topic.`, { parse_mode: 'Markdown', reply_markup: guidedRow() } as any);
}

async function runGuided(ctx: any, tool: string, topic: string): Promise<void> {
  const id = getUid(ctx);
  rememberTopic(id, topic);
  const gen = TOOL_GENERATORS[tool];
  if (!gen) {
    ctx.reply('⚠️ Unknown tool.', showMenu(ctx, 'main') as any);
    return;
  }
  try {
    const ai = await safeGenerateResponse(gen.build(topic));
    ctx.reply(`${gen.title(topic)}\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Generation error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
}

function cancelFlows(ctx: any, msg = '🚫 Cancelled. What next?'): void {
  const id = getUid(ctx);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'idle';
    delete userState[id].guided;
    delete userState[id].pendingBroadcast;
    delete userState[id].remindAfter;
    saveState(userState);
  }
  ctx.reply(msg, { reply_markup: MENUS.main(localize(id ? userState[id]?.lang : undefined)) } as any);
}

// ---------- One-tap follow-ups (EzyAi style) --------------------------------

const fupAliases: Record<string, string> = {
  fup_hooks: 'hook',
  fup_captions: 'caption',
  fup_email: 'email',
};

bot.action(/^fup_/, async (ctx: any) => {
  const id = getUid(ctx);
  const label = (ctx.match?.[0] as string) || '';
  await ctx.answerCbQuery();
  if (label === 'fup_menu') {
    toMain(ctx);
    await ctx.deleteMessage().catch(() => undefined);
    ctx.reply('🏠 Main menu:', showMenu(ctx, 'main') as any);
    return;
  }
  const tool = fupAliases[label];
  const topic = (id && userState[id]?.lastTopic) ? userState[id].lastTopic : defaultTopic(ctx);
  if (!tool) return;
  try {
    const gen = TOOL_GENERATORS[tool];
    const ai = await safeGenerateResponse(gen.build(topic));
    ctx.reply(`${gen.title(topic)}\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Follow-up error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});

bot.action('g_cancel', async (ctx: any) => {
  await ctx.answerCbQuery('Cancelled');
  cancelFlows(ctx);
});
bot.action('g_quick', async (ctx: any) => {
  await ctx.answerCbQuery('Generating with default topic...');
  const id = getUid(ctx);
  const tool = id ? userState[id]?.guided?.tool : undefined;
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'idle';
    delete userState[id].guided;
    saveState(userState);
  }
  if (tool) {
    await runGuided(ctx, tool, defaultTopic(ctx));
  } else {
    ctx.reply('🏠 What next?', showMenu(ctx, 'main') as any);
  }
});

// ---------- Language ----------------------------------------------------------

const LANG_REPLIES: Record<string, string> = {
  en: '🇬🇧 Language set to English.',
  es: '🇪🇸 Idioma cambiado a Español.',
  fr: '🇫🇷 Langue définie sur Français.',
  de: '🇩🇪 Sprache auf Deutsch eingestellt.',
  zh: '🇨🇳 语言已设置为中文。',
};

bot.command('lang', (ctx: any) => {
  ctx.reply('🌐 Choose your language:', showMenu(ctx, 'langSub') as any);
});
hearsMenu('🌐 Language', (ctx: any) => {
  ctx.reply('🌐 Choose your language:', showMenu(ctx, 'langSub') as any);
});
for (const code of ['en', 'es', 'fr', 'de', 'zh'] as const) {
  const flag = code === 'en' ? '🇬🇧' : code === 'es' ? '🇪🇸' : code === 'fr' ? '🇫🇷' : code === 'de' ? '🇩🇪' : '🇨🇳';
  const langLabel = `${flag} ${code.toUpperCase()}`;
  handledLabels.add(langLabel);
  bot.hears(langLabel, (ctx: any) => {
    const id = getUid(ctx);
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].lang = code;
      saveState(userState);
    }
    ctx.reply(LANG_REPLIES[code], showMenu(ctx, 'main') as any);
  });
}

// ---------- Bot commands menu -------------------------------------------------

const botCommands = [
  { command: 'start', description: '🏠 Show main menu' },
  { command: 'help', description: '📖 Help menu' },
  { command: 'plans', description: '💳 Pricing & plans' },
  { command: 'dashboard', description: '📊 Open dashboard' },
  { command: 'addlead', description: '➕ Add a new lead' },
  { command: 'stage', description: '🔄 Set lead stage' },
  { command: 'stats', description: '📊 Show stats' },
  { command: 'leads', description: '📂 List/search leads' },
  { command: 'deletelead', description: '🗑️ Delete a lead' },
  { command: 'inbox', description: '📬 Unified inbox status' },
  { command: 'remind', description: '⏰ Set reminder' },
  { command: 'handoff', description: '🚩 Human handoff' },
  { command: 'business', description: '🏢 Business profile' },
  { command: 'profile', description: '👤 Your profile' },
  { command: 'rules', description: '⚡ Automation rules' },
  { command: 'export', description: '📦 Export leads CSV (PRO)' },
  { command: 'plan', description: '💳 Subscription plan' },
  { command: 'persona', description: '🎭 Brand persona' },
  { command: 'meta', description: '🔍 SEO meta' },
  { command: 'valuemap', description: '🗺️ Value map' },
  { command: 'review', description: '✏️ Content review' },
  { command: 'growth', description: '📈 Growth prompts' },
  { command: 'swipe', description: '📂 Swipe files' },
  { command: 'watch', description: '👁️ Watch a pair' },
  { command: 'fundamentals', description: '📚 Fundamentals' },
  { command: 'autopilot', description: '🚀 Autopilot' },
  { command: 'quote', description: '💰 Quick quote' },
  { command: 'watches', description: '📋 Active watches' },
  { command: 'unwatch', description: '🗑️ Stop watching' },
  { command: 'workflow', description: '⚙️ Automation' },
  { command: 'content', description: '📝 Content studio' },
  { command: 'campaign', description: '✉️ Campaign builder' },
  { command: 'keywords', description: '🔑 Keyword research' },
  { command: 'leadmagnet', description: '🧲 Lead magnet generator' },
  { command: 'redeem', description: '🎫 Redeem a code' },
  { command: 'ping', description: '🏓 Ping the bot' },
];

// ---------- Navigation ----------------------------------------------------------

hearsMenu('🏠 Main Menu', (ctx: any) => {
  ctx.deleteMessage().catch(() => undefined);
  ctx.reply('🏠 Main menu:', showMenu(ctx, 'main') as any);
});
hearsMenu('⬅️ Back', (ctx: any) => {
  const parent = backMenu(ctx);
  ctx.reply(parent === 'main' ? '🏠 Main menu:' : '⬅️ Back:', showMenu(ctx, parent) as any);
});
bot.command('back', (ctx: any) => {
  const parent = backMenu(ctx);
  ctx.reply(parent === 'main' ? '🏠 Main menu:' : '⬅️ Back:', showMenu(ctx, parent) as any);
});

// ---------- /start --------------------------------------------------------------

bot.start((ctx: any) => {
  const id = getUid(ctx);
  if (id && !userState[id]) userState[id] = { type: 'idle' };
  saveState(userState);
  const langCode = (id && userState[id]?.lang) ? userState[id].lang : 'en';
  const lang = loadLang(langCode);
  const welcomeMsg = (lang.welcome ? lang.welcome : 'Welcome to *TG Ezy AI OS*! 👋') + '\n\n' +
    (lang.welcome_sub ? lang.welcome_sub : 'Tap a button below or use commands.') +
    '\n\n✨ Quick links: /stats · /leads · /plan · /persona · /dashboard\n⚡ Commands available below 👇';
  ctx.reply(welcomeMsg, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

// ---------- Leads & stats ----------------------------------------------------------

bot.command('stats', async (ctx: any) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage || 'unknown'] = (acc[cur.stage || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byStage).map(([k, v]) => `${k}: ${v}`).join(', ');
    const state = loadState();
    const aiCount = Object.values(state).reduce((acc: any, s: any) => acc + (s?.aiCount || 0), 0);
    ctx.reply(
      `📊 *Stats*\nTotal leads: *${total}*\nBreakdown: ${breakdown || 'none'}\nAI conversations: *${aiCount}*\nFull list: /leads · Chart: /dashboard`,
      { parse_mode: 'Markdown', ...showMenu(ctx, 'statsLeads') } as any
    );
  } catch (e: any) {
    ctx.reply(`⚠️ Could not fetch stats (${e?.message ?? 'error'})`, showMenu(ctx, 'statsLeads') as any);
  }
});

bot.command('leads', async (ctx: any) => {
  try {
    const leads = await getLeads();
    const stages = ['new', 'contacted', 'qualified', 'closed'];
    const filterKeyboard = { inline_keyboard: stages.map((s) => [{ text: s.toUpperCase(), callback_data: `search_stage_${s}` }]) };
    const listText = leads.length ? leads.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads yet.';
    ctx.reply(`📂 *Leads List* (${leads.length})\n${listText}\n\nFilter by stage 👇`, { parse_mode: 'Markdown', reply_markup: filterKeyboard } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Could not load leads (${e?.message ?? 'error'})`, showMenu(ctx, 'statsLeads') as any);
  }
});

bot.command('deletelead', async (ctx: any) => {
  const telegramId = (ctx.message as any).text.split(' ').slice(1).join(' ').trim();
  if (!telegramId) {
    ctx.reply('Usage: /deletelead <telegramId>', showMenu(ctx, 'main') as any);
    return;
  }
  try {
    const leads = await getLeads();
    const found = leads.find((l: any) => l.telegramId === telegramId);
    if (!found) {
      ctx.reply(`No lead found for telegramId: ${telegramId}`, showMenu(ctx, 'main') as any);
      return;
    }
    const deleted = await deleteLead(found.id);
    ctx.reply(deleted ? `🗑️ Deleted lead: *${found.name ?? 'Unnamed'}* (${found.stage})` : 'Failed to delete.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Error: ${e?.message ?? 'unknown'}`, showMenu(ctx, 'main') as any);
  }
});

bot.command('ping', (ctx: any) => ctx.reply('pong'));

bot.command('addlead', (ctx: any) => {
  const id = getUid(ctx);
  if (id) userState[id] = { type: 'name' };
  ctx.reply('Please enter the lead\'s name:', { reply_markup: forceReply } as any);
});

hearsMenu('➕ Add Lead', (ctx: any) => {
  const id = getUid(ctx);
  if (id) userState[id] = { type: 'name' };
  ctx.reply('Please enter the lead\'s name:', { reply_markup: forceReply } as any);
});

hearsMenu('📊 Stats & Leads', (ctx: any) => {
  ctx.reply('📊 Choose an option:', showMenu(ctx, 'statsLeads') as any);
});
hearsMenu('📊 Stats', async (ctx: any) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage || 'unknown'] = (acc[cur.stage || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byStage).map(([k, v]) => `${k}: ${v}`).join(', ');
    ctx.reply(`📊 *Stats*\nTotal leads: *${total}*\nBreakdown: ${breakdown || 'none'}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'statsLeads').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Stats error (${e?.message ?? 'error'})`, showMenu(ctx, 'statsLeads') as any);
  }
});
hearsMenu('📂 Leads List', async (ctx: any) => {
  try {
    const leads = await getLeads();
    const stages = ['new', 'contacted', 'qualified', 'closed'];
    const filterKeyboard = { inline_keyboard: stages.map((s) => [{ text: s.toUpperCase(), callback_data: `search_stage_${s}` }]) };
    const listText = leads.length ? leads.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads yet.';
    ctx.reply(`📂 *Leads List* (${leads.length})\n${listText}\n\nFilter by stage 👇`, { parse_mode: 'Markdown', reply_markup: filterKeyboard } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Could not load leads (${e?.message ?? 'error'})`, showMenu(ctx, 'statsLeads') as any);
  }
});
hearsMenu('📈 Pipeline', (ctx: any) => {
  ctx.reply('📈 Pipeline overview — view full kanban board at /dashboard', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'statsLeads').reply_markup } as any);
});

// ---------- /stage ----------------------------------------------------------------

bot.command('stage', async (ctx: any) => {
  const id = getUid(ctx);
  const parts = (ctx.message as any).text.split(' ').slice(1).join(' ').trim().toLowerCase();
  const valid = ['new', 'contacted', 'qualified', 'closed'];
  if (!valid.includes(parts)) {
    ctx.reply('Usage: /stage <new|contacted|qualified|closed>', { reply_markup: stageKeyboard } as any);
    return;
  }
  if (id) {
    await updateLeadByTelegramId(id, { stage: parts });
    const ch = { new: '🏠 Welcome message triggered.', contacted: '📅 Contact made — schedule follow-up.', qualified: '📦 Lead qualified! Send proposal.', closed: '🎉 Deal closed — notify team.' } as Record<string, string>;
    ctx.reply(`✅ Stage set to *${parts}*\n🤖 Automation: ${ch[parts]}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  }
});

const stageActions: Record<string, string> = {
  stage_new: 'new',
  stage_contacted: 'contacted',
  stage_qualified: 'qualified',
  stage_closed: 'closed',
};
for (const [action, stageName] of Object.entries(stageActions)) {
  bot.action(action, async (ctx: any) => {
    await ctx.answerCbQuery(`${stageName} selected`);
    const id = getUid(ctx);
    if (id && userState[id]?.type === 'stage') {
      const lead = await addLead({ telegramId: id, name: userState[id].name, stage: stageName });
      const autoMsg = {
        new: '🤖 Automation: Welcome message triggered. Follow up within 24h.',
        contacted: '🤖 Automation: Contact made — schedule next touch in 3 days.',
        qualified: '🤖 Automation: Lead qualified! Send proposal now.',
        closed: '🤖 Automation: Deal closed. Update CRM and notify team.',
      } as Record<string, string>;
      await ctx.editMessageText(`✅ Lead *${lead.name ?? 'Unnamed'}* → *${stageName}*${autoMsg[stageName] ? `\n${autoMsg[stageName]}` : ''}`, { parse_mode: 'Markdown' });
      userState[id] = { type: 'idle' };
      saveState(userState);
      ctx.reply('Done! What next?', showMenu(ctx, 'main') as any);
    } else if (id) {
      await updateLeadByTelegramId(id, { stage: stageName });
      await ctx.editMessageText(`Stage set to *${stageName}*`, { parse_mode: 'Markdown' });
    }
  });
}

const searchStageActions: Record<string, string> = {
  search_stage_new: 'new',
  search_stage_contacted: 'contacted',
  search_stage_qualified: 'qualified',
  search_stage_closed: 'closed',
};
for (const [action, stageName] of Object.entries(searchStageActions)) {
  bot.action(action, async (ctx: any) => {
    await ctx.answerCbQuery(`Filter: ${stageName}`);
    try {
      const allLeads = await getLeads();
      const filtered = allLeads.filter((l: any) => l.stage === stageName);
      const listText = filtered.length ? filtered.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads in this stage.';
      await ctx.editMessageText(`📂 *Leads — ${stageName.toUpperCase()}* (${filtered.length})\n${listText}`, { parse_mode: 'Markdown' });
    } catch (e: any) {
      await ctx.editMessageText(`⚠️ Filter error (${e?.message ?? 'error'})`);
    }
  });
}

// ---------- Marketing submenu ------------------------------------------------

hearsMenu('💼 Marketing', (ctx: any) => {
  ctx.reply('💼 Marketing toolkit — choose a tool:', showMenu(ctx, 'marketing') as any);
});

hearsMenu('💳 Plan', (ctx: any) => {
  ctx.reply('💳 Choose a plan option:', showMenu(ctx, 'plan') as any);
});
hearsMenu('📊 Current Plan', async (ctx: any) => {
  try {
    const id = getUid(ctx);
    const label = getPlanLabel(id ? userState[id] : undefined);
    const leads = await getLeads();
    ctx.reply(`💳 *Subscription Plan*\nCurrent: *${label}*\nLeads: ${leads.length}\n\nChange below or use /plans.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'plan').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Plan error (${e?.message ?? 'error'})`, showMenu(ctx, 'plan') as any);
  }
});
hearsMenu('💳 Set Free', (ctx: any) => {
  const id = getUid(ctx);
  if (id) { userState[id] = userState[id] || {}; userState[id].plan = 'free'; delete userState[id].proUntil; saveState(userState); }
  ctx.reply('💳 Plan updated to *FREE*', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
hearsMenu('💳 Set Pro', (ctx: any) => {
  const id = getUid(ctx);
  if (id) { userState[id] = userState[id] || {}; userState[id].plan = 'navigator'; saveState(userState); }
  ctx.reply('💳 Plan updated to *NAVIGATOR*', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
hearsMenu('💳 Set Enterprise', (ctx: any) => {
  const id = getUid(ctx);
  if (id) { userState[id] = userState[id] || {}; userState[id].plan = 'thinker'; saveState(userState); }
  ctx.reply('💳 Plan updated to *THINKER*', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

hearsMenu('🎭 Persona', (ctx: any) => {
  ctx.reply('🎭 Choose persona setting:', showMenu(ctx, 'persona') as any);
});
hearsMenu('🎭 Tone', (ctx: any) => {
  const id = getUid(ctx);
  const current = (id && userState[id]?.persona?.tone) ? userState[id].persona.tone : 'professional';
  ctx.reply(`🎭 Current tone: *${current}*\nSend new tone value (e.g., friendly, professional, witty)`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'persona').reply_markup } as any);
  if (id) { userState[id] = userState[id] || {}; userState[id].type = 'persona_tone'; saveState(userState); }
});
hearsMenu('🎭 Audience', (ctx: any) => {
  const id = getUid(ctx);
  const current = (id && userState[id]?.persona?.audience) ? userState[id].persona.audience : 'general';
  ctx.reply(`🎭 Current audience: *${current}*\nSend new audience value (e.g., general, developers, marketers)`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'persona').reply_markup } as any);
  if (id) { userState[id] = userState[id] || {}; userState[id].type = 'persona_audience'; saveState(userState); }
});
hearsMenu('🎭 Style', (ctx: any) => {
  const id = getUid(ctx);
  const current = (id && userState[id]?.persona?.style) ? userState[id].persona.style : 'clear';
  ctx.reply(`🎭 Current style: *${current}*\nSend new style value (e.g., clear, concise, detailed)`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'persona').reply_markup } as any);
  if (id) { userState[id] = userState[id] || {}; userState[id].type = 'persona_style'; saveState(userState); }
});

hearsMenu('🔍 Meta', (ctx: any) => ctx.reply('🔍 SEO Meta — describe your topic:', showMenu(ctx, 'metaSub') as any));
hearsMenu('🔍 Generate Meta', (ctx: any) => startGuided(ctx, 'meta'));

hearsMenu('🗺️ Value', (ctx: any) => ctx.reply('🗺️ Value Map — describe your product:', showMenu(ctx, 'valueSub') as any));
hearsMenu('🗺️ Generate Map', (ctx: any) => startGuided(ctx, 'value'));

hearsMenu('✏️ Review', (ctx: any) => ctx.reply('✏️ Content Review — paste content to review:', showMenu(ctx, 'reviewSub') as any));
hearsMenu('✏️ Review Content', (ctx: any) => startGuided(ctx, 'review'));

hearsMenu('📈 Growth', (ctx: any) => {
  ctx.reply('📈 *Growth Prompts* — battle-tested angles for ads, SEO, email, CRO, content.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'growthSub').reply_markup } as any);
});
hearsMenu('📈 Show Prompts', async (ctx: any) => {
  try {
    const ai = await safeGenerateResponse('List 5 battle-tested growth marketing prompts for paid ads, SEO, email, CRO, and content. Keep each to one line.');
    ctx.reply(`📈 *Growth Prompts Library*\n${ai}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'growthSub').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Growth prompts error (${e?.message ?? 'error'})`, showMenu(ctx, 'growthSub') as any);
  }
});

hearsMenu('📂 Swipe', async (ctx: any) => {
  try {
    const ai = await safeGenerateResponse('Provide 3 ready-to-use swipe file hooks/headlines for marketing campaigns in English. Include a brief explanation of why each works.');
    ctx.reply(`📂 *Swipe Files*\n${ai}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'swipeSub').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Swipe files error (${e?.message ?? 'error'})`, showMenu(ctx, 'swipeSub') as any);
  }
});
hearsMenu('📂 Show Swipe', async (ctx: any) => {
  try {
    const ai = await safeGenerateResponse('Provide 3 ready-to-use swipe file hooks/headlines for marketing campaigns in English. Include a brief explanation of why each works.');
    ctx.reply(`📂 *Swipe Files*\n${ai}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'swipeSub').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Swipe files error (${e?.message ?? 'error'})`, showMenu(ctx, 'swipeSub') as any);
  }
});

hearsMenu('⚙️ Workflow', proGateWrapper((ctx: any) => ctx.reply('⚙️ *Automation Workflows* — trigger actions on stage changes / reminders.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'workflowSub').reply_markup } as any)));
hearsMenu('⚙️ Show Workflow', proGateWrapper((ctx: any) => ctx.reply('⚙️ Ready-to-use automation recipes:\n• New lead → welcome + 24h follow-up\n• Contacted → 3-day touch schedule\n• Qualified → send proposal\n• Closed → notify team\n\nManage triggers under ⚙️ Settings → ⚡ Automation Rules.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'workflowSub').reply_markup } as any)));

// ---------- Content Studio (PRO) ---------------------------------------------

hearsMenu('📝 Content', (ctx: any) => proGate(ctx, () => ctx.reply('📝 *Content Studio* — pick a format:', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'contentSub').reply_markup } as any)));
hearsMenu('📝 Post', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'post')));
hearsMenu('📧 Email', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'email')));
hearsMenu('✍️ Hook', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'hook')));
hearsMenu('🏷️ Caption', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'caption')));

// ---------- Campaign (PRO) ----------------------------------------------------

hearsMenu('✉️ Campaign', (ctx: any) => proGate(ctx, () => ctx.reply('✉️ *Campaign Builder* — choose an action:', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'campaignSub').reply_markup } as any)));
hearsMenu('💡 Ideas', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'ideas')));
hearsMenu('📰 Launch', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'launch')));

// ---------- Keywords (PRO) ----------------------------------------------------

hearsMenu('🔑 Keywords', (ctx: any) => proGate(ctx, () => ctx.reply('🔑 *Keyword Research* — describe your niche:', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'keywordsSub').reply_markup } as any)));
hearsMenu('🔑 Research', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'keywords')));

// ---------- Lead Magnet (PRO) -------------------------------------------------

hearsMenu('🧲 Lead Magnet', (ctx: any) => proGate(ctx, () => ctx.reply('🧲 *Lead Magnet Generator* — what do you sell?', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'leadMagnetSub').reply_markup } as any)));
hearsMenu('🧲 Generate', (ctx: any) => proGate(ctx, () => startGuided(ctx, 'leadmagnet')));

function proGateWrapper(fn: (ctx: any) => any) {
  return (ctx: any) => proGate(ctx, () => fn(ctx));
}

// ---------- Tools & Auto --------------------------------------------------------

hearsMenu('⚙️ Tools & Auto', (ctx: any) => {
  ctx.reply('⚙️ Tools & Automation — pick an option:', showMenu(ctx, 'toolsAuto') as any);
});

// --- Inbox ---
hearsMenu('📬 Inbox', async (ctx: any) => {
  const { total, byChannel } = unreadTotals();
  const lines = Object.entries(byChannel).map(([ch, n]) => `• ${ch}: ${n || 0} unread`).join('\n');
  const port = process.env.PORT || 3000;
  const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
  ctx.reply(
    `📬 *Unified Inbox*\n\nUnread across platforms: *${total}*\n${lines}\n\nOpen the dashboard to reply from all channels in one place.`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '📬 Open Inbox', url: `${base}/dashboard#inbox` }]] },
    } as any
  );
});
bot.command('inbox', async (ctx: any) => {
  const { total, byChannel } = unreadTotals();
  const lines = Object.entries(byChannel).map(([ch, n]) => `• ${ch}: ${n || 0} unread`).join('\n');
  const port = process.env.PORT || 3000;
  const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
  ctx.reply(`📬 *Unified Inbox*\n\nUnread: *${total}*\n${lines}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📬 Open Inbox', url: `${base}/dashboard#inbox` }]] } } as any);
});

// --- Handoff ---
hearsMenu('🚩 Handoff', async (ctx: any) => {
  const id = getUid(ctx);
  if (id) {
    await updateLeadByTelegramId(id, { stage: 'contacted' });
  }
  ctx.reply('🚩 Lead flagged for *human review*. Our team will contact you shortly.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'toolsAuto').reply_markup } as any);
});
bot.command('handoff', async (ctx: any) => {
  const id = getUid(ctx);
  if (id) await updateLeadByTelegramId(id, { stage: 'contacted' });
  ctx.reply('🚩 Lead flagged for *human review* (handoff requested).', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'toolsAuto').reply_markup } as any);
});

// --- Remind (guided) ---
hearsMenu('⏰ Remind', (ctx: any) => {
  const id = getUid(ctx);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'remind_after';
    saveState(userState);
  }
  ctx.reply('⏰ *Reminder*\nIn how many *minutes* should I remind you? (e.g. 30)', { parse_mode: 'Markdown', reply_markup: forceReply } as any);
});

bot.command('remind', (ctx: any) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const minutes = parseInt(args[0]);
  const msg = args.slice(1).join(' ');
  if (!minutes || isNaN(minutes) || !msg) {
    ctx.reply('Usage: /remind <minutes> <message> · or tap ⏰ Remind in ⚙️ Tools & Auto', showMenu(ctx, 'toolsAuto') as any);
    return;
  }
  const chatId = ctx.chat?.id?.toString() || '';
  scheduleReminder(chatId, minutes * 60000, msg);
  ctx.reply(`⏰ Reminder set for ${minutes} minute(s): "${msg}"`, { reply_markup: showMenu(ctx, 'toolsAuto').reply_markup } as any);
});

// --- Broadcast (admin) ---
hearsMenu('📣 Broadcast', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) {
    ctx.reply('⛔ Admin only.', showMenu(ctx, 'toolsAuto') as any);
    return;
  }
  const id = getUid(ctx);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'broadcast_msg';
    saveState(userState);
  }
  ctx.reply('📣 *Broadcast*\nType the message to send to all users & leads:', { parse_mode: 'Markdown', reply_markup: forceReply } as any);
});

// --- Export CSV (PRO) ---
hearsMenu('📦 Export CSV', (ctx: any) => proGate(ctx, () => exportCsv(ctx)));
bot.command('export', (ctx: any) => proGate(ctx, () => exportCsv(ctx)));
async function exportCsv(ctx: any): Promise<void> {
  try {
    const leads = await getLeads();
    const csv = toCsv(leads);
    const filePath = path.join(os.tmpdir(), `leads-${Date.now()}.csv`);
    fs.writeFileSync(filePath, csv, 'utf-8');
    await ctx.replyWithDocument({ source: filePath, filename: `leads-${Date.now()}.csv` } as any, { caption: '📦 Leads export (CSV)' } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Export failed (${e?.message ?? 'error'})`, showMenu(ctx, 'toolsAuto') as any);
  }
}

// --- Automation Rules ---
hearsMenu('⚡ Automation Rules', (ctx: any) => showRules(ctx));
bot.command('rules', (ctx: any) => showRules(ctx));
function showRules(ctx: any): void {
  const id = getUid(ctx);
  const rules = (id && userState[id]?.rules) ? userState[id].rules : { autoStage: true, dailyDigest: false };
  ctx.reply(
    `⚡ *Automation Rules*\n\n• Auto box: *${rules.autoStage ? 'ON' : 'OFF'}* — automatic stage-change messages\n• Daily digest: *${rules.dailyDigest ? 'ON' : 'OFF'}* — end-of-day lead summary\n\nToggle below 👇`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `${rules.autoStage ? '✅' : '⬜'} Auto box`, callback_data: 'rule_autoStage' }],
          [{ text: `${rules.dailyDigest ? '✅' : '⬜'} Daily digest`, callback_data: 'rule_dailyDigest' }],
          [{ text: '🚫 Close', callback_data: 'rule_close' }],
        ],
      },
    } as any
  );
}
bot.action(/^rule_/, async (ctx: any) => {
  const id = getUid(ctx);
  const rule = (ctx.match?.[0] as string).replace('rule_', '');
  await ctx.answerCbQuery();
  if (rule === 'close') {
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].rules = userState[id].rules || { autoStage: true, dailyDigest: false };
    userState[id].rules[rule] = !userState[id].rules[rule];
    saveState(userState);
  }
  showRules(ctx);
});

// ---------- Settings -------------------------------------------------------------

hearsMenu('⚙️ Settings', (ctx: any) => {
  ctx.reply('⚙️ Settings — pick an option:', showMenu(ctx, 'settings') as any);
});

hearsMenu('👤 Profile', (ctx: any) => {
  const id = getUid(ctx);
  const u = ctx.from;
  const s = id ? userState[id] : undefined;
  const lang = id ? (userState[id]?.lang || 'en') : 'en';
  const label = getPlanLabel(s);
  const trial = s?.trialEndsAt && new Date(s.trialEndsAt).getTime() > Date.now() ? ` · trial until ${new Date(s.trialEndsAt).toLocaleDateString()}` : '';
  ctx.reply(
    `👤 *Profile*\n\nID: \`${u?.id}\`\nName: ${u?.first_name ?? ''} ${u?.last_name ?? ''}\nLanguage: ${normalizeLang(lang).toUpperCase()}\nPlan: *${label}*${trial}\nAI conversations: ${s?.aiCount || 0}`,
    { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'settings').reply_markup } as any
  );
});
bot.command('profile', (ctx: any) => {
  const id = getUid(ctx);
  const u = ctx.from;
  const s = id ? userState[id] : undefined;
  const label = getPlanLabel(s);
  const trial = s?.trialEndsAt && new Date(s.trialEndsAt).getTime() > Date.now() ? ` · trial until ${new Date(s.trialEndsAt).toLocaleDateString()}` : '';
  ctx.reply(`👤 *Profile*\n\nID: \`${u?.id}\`\nName: ${u?.first_name ?? ''} ${u?.last_name ?? ''}\nPlan: *${label}*${trial}\nAI conversations: ${s?.aiCount || 0}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'settings').reply_markup } as any);
});

// --- Notifications ---
hearsMenu('🔔 Notifications', (ctx: any) => {
  const id = getUid(ctx);
  const on = (id && userState[id]?.notifications !== undefined) ? userState[id].notifications : true;
  ctx.reply(
    `🔔 *Notifications*\nReminders & automation alerts: *${on ? 'ON' : 'OFF'}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: on ? '🔕 Turn OFF' : '🔔 Turn ON', callback_data: 'notif_toggle' }]] },
    } as any
  );
});
bot.action('notif_toggle', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].notifications = !(userState[id].notifications !== undefined ? userState[id].notifications : true);
    saveState(userState);
  }
  ctx.reply(`🔔 Notifications: *${userState[id]?.notifications ? 'ON' : 'OFF'}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'settings').reply_markup } as any);
});

// --- Business profile (feeds AI writing with real facts) ---
hearsMenu('🏢 Business', (ctx: any) => startBusiness(ctx));
bot.command('business', (ctx: any) => startBusiness(ctx));
function startBusiness(ctx: any): void {
  const id = getUid(ctx);
  const biz = id ? userState[id]?.business : undefined;
  if (biz?.name && biz?.website) {
    ctx.reply(
      `🏢 *Business Profile*\nName: ${biz.name}\nWebsite: ${biz.website}\nDefault tone: ${biz.tone || 'professional'}\n\nUse it to ground all AI copy in real facts.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '✏️ Edit', callback_data: 'biz_edit' }], [{ text: '🚫 Close', callback_data: 'g_cancel' }]] },
      } as any
    );
  } else {
    const id = getUid(ctx);
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].type = 'biz_name';
      saveState(userState);
    }
    ctx.reply('🏢 *Business Profile*\n\nWhat is your business name? (type it, or /skip)', { parse_mode: 'Markdown', reply_markup: forceReply } as any);
  }
}
bot.action('biz_edit', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'biz_name';
    saveState(userState);
  }
  ctx.reply('✏️ Update business name:', { parse_mode: 'Markdown', reply_markup: forceReply } as any);
});

// --- Danger zone ---
hearsMenu('🗑️ Danger Zone', (ctx: any) => {
  ctx.reply(
    '🗑️ *Danger Zone*\nThis will delete your linked leads and reset your settings. This cannot be undone. Continue?',
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '✅ Yes, delete everything', callback_data: 'danger_confirm' }, { text: '🚫 Cancel', callback_data: 'g_cancel' }]] },
    } as any
  );
});
bot.action('danger_confirm', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery();
  if (id) {
    const leads = await getLeads();
    for (const l of leads) {
      if (l.telegramId === id) await deleteLead(l.id);
    }
    delete userState[id];
    saveState(userState);
  }
  ctx.reply('🗑️ Your data has been cleared.', { reply_markup: MENUS.main((s) => s) } as any);
});

// ---------- Trading-style commands (EzyAi lineage) -----------------------------

bot.command('watch', (ctx: any) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim();
  const parts = msg ? msg.split(' ') : [];
  const pair = (parts[0] || 'BTCUSD').toUpperCase();
  const style = parts[1] || 'scalping';
  const mode = parts[2] || 'safe';
  const id = getUid(ctx);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].watches = userState[id].watches || [];
    userState[id].watches.push({ pair, style, mode });
    saveState(userState);
  }
  ctx.reply(`👁️ Watch started: *${pair}* (${style}/${mode})`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
bot.hears('👁️ Watch', (ctx: any) => {
  ctx.reply('👁️ Watch mode — usage: /watch <PAIR> <STYLE> <MODE>\nExample: /watch BTCUSD intraday safe', { reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
bot.command('fundamentals', async (ctx: any) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  try {
    const ai = await safeGenerateResponse(`Provide fundamentals for ${msg}: source links (CoinGecko for crypto, Yahoo Finance for stocks/forex/metals), recent headlines, and a brief summary.`);
    ctx.reply(`📚 *Fundamentals — ${msg}*\n${ai}\n\nSources: CoinGecko / Yahoo Finance`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Fundamentals error (${e?.message ?? 'unknown'})`, showMenu(ctx, 'main') as any);
  }
});
bot.command('autopilot', (ctx: any) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim();
  const parts = msg ? msg.split(' ') : [];
  const style = parts[0] || 'scalping';
  const mode = parts[1] || 'aggressive';
  ctx.reply(`🚀 Autopilot active: *${style} / ${mode}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
bot.command('quote', async (ctx: any) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  try {
    const ai = await safeGenerateResponse(`Provide a quick market quote for ${msg}: current price, trend direction, support/resistance, and a brief outlook.`);
    ctx.reply(`💰 *Quote — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Quote error (${e?.message ?? 'unknown'})`, showMenu(ctx, 'main') as any);
  }
});
bot.command('watches', async (ctx: any) => {
  const id = getUid(ctx);
  const userWatches = (id && userState[id]?.watches) ? userState[id].watches : [];
  const text = userWatches.length ? userWatches.map((w: any) => `• *${w.pair}* (${w.style}/${w.mode})`).join('\n') : 'No active watches.';
  ctx.reply(`📋 *Active Watches*\n${text}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});
bot.command('unwatch', async (ctx: any) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  const id = getUid(ctx);
  if (id && userState[id]?.watches) {
    userState[id].watches = userState[id].watches.filter((w: any) => w.pair !== msg);
    saveState(userState);
  }
  ctx.reply(`🗑️ Unwatched: *${msg}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

// ---------- Commands for marketing tools ----------------------------------------

bot.command('plan', (ctx: any) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const id = getUid(ctx);
  if (args[0] === 'set' && args[1]) {
    if (id && isAdmin(id)) {
      userState[id] = userState[id] || {};
      userState[id].plan = args[1].toLowerCase();
      saveState(userState);
      ctx.reply(`💳 Plan updated to *${args[1]}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    } else {
      ctx.reply('⛔ Admin only — purchase a plan with /plans.', showMenu(ctx, 'main') as any);
    }
  } else {
    const label = currentLabel(ctx);
    ctx.reply(`💳 *Subscription Plan* — Current: *${label}*\nUpgrade with /plans.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  }
});
bot.command('persona', (ctx: any) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const id = getUid(ctx);
  if (args[0] === 'set' && args[1] && args[2]) {
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].persona = userState[id].persona || {};
      userState[id].persona[args[1]] = args.slice(2).join(' ');
      saveState(userState);
      ctx.reply(`🎭 Persona updated: *${args[1]}* = ${args.slice(2).join(' ')}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    }
  } else {
    const persona = (id && userState[id]?.persona) ? JSON.stringify(userState[id].persona) : '{ tone: "professional", audience: "general", style: "clear" }';
    ctx.reply(`🎭 *Brand Persona* — ${persona}\nUse /persona set <key> <value>`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  }
});
bot.command('meta', async (ctx: any) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const topic = msg || defaultTopic(ctx);
  const id = getUid(ctx);
  rememberTopic(id, topic);
  try {
    const ai = await safeGenerateResponse(TOOL_GENERATORS.meta.build(topic));
    ctx.reply(`${TOOL_GENERATORS.meta.title(topic)}\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Meta generation failed (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});
bot.command('valuemap', (ctx: any) => ctx.reply('🗺️ *Value Map Generator*\nUsage: /valuemap <product> — or tap 🗺️ Value in 💼 Marketing', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any));
bot.command('review', (ctx: any) => ctx.reply('✏️ *Content Review*\nUsage: /review — then paste content (guided) or tap ✏️ Review in 💼 Marketing', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any));
bot.command('growth', (ctx: any) => ctx.reply('📈 *Growth Prompts* — battle-tested prompts for ads, SEO, email, CRO, and content.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any));
bot.command('swipe', (ctx: any) => ctx.reply('📂 *Swipe Files* — hooks, headlines, and angles ready to copy/paste.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any));
bot.command('workflow', (ctx: any) => proGate(ctx, () => ctx.reply('⚙️ *Automation Workflows* — trigger actions based on stage changes or reminders. See ⚙️ Settings → ⚡ Automation Rules.', { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any)));

function withTopic(ctx: any): string {
  return (ctx.message as any).text.split(' ').slice(1).join(' ').trim();
}

bot.command('content', async (ctx: any) => {
  await proGate(ctx, async () => {
    const topic = withTopic(ctx) || defaultTopic(ctx);
    const id = getUid(ctx);
    rememberTopic(id, topic);
    try {
      const ai = await safeGenerateResponse(`Write a concise marketing content pack for "${topic}": one social post, one short email subject, and one strong hook.`);
      ctx.reply(`📝 *Content Studio — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Content error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(topic) } as any);
    }
  });
});
bot.command('campaign', async (ctx: any) => {
  await proGate(ctx, async () => {
    const topic = withTopic(ctx) || defaultTopic(ctx);
    const id = getUid(ctx);
    rememberTopic(id, topic);
    try {
      const ai = await safeGenerateResponse(`Give 3 solid marketing campaign ideas for "${topic}", each with channel, format, and goal.`);
      ctx.reply(`✉️ *Campaign Ideas — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Campaign error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(topic) } as any);
    }
  });
});
bot.command('keywords', async (ctx: any) => {
  await proGate(ctx, async () => {
    const topic = withTopic(ctx) || defaultTopic(ctx);
    const id = getUid(ctx);
    rememberTopic(id, topic);
    try {
      const ai = await safeGenerateResponse(`List 8 keyword ideas for "${topic}" grouped by search intent (informational, commercial, transactional).`);
      ctx.reply(`🔑 *Keywords — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Keyword error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(topic) } as any);
    }
  });
});
bot.command('leadmagnet', async (ctx: any) => {
  await proGate(ctx, async () => {
    const topic = withTopic(ctx) || defaultTopic(ctx);
    const id = getUid(ctx);
    rememberTopic(id, topic);
    try {
      const ai = await safeGenerateResponse(`Suggest 4 high-converting lead magnet ideas for "${topic}" (ebook, checklist, template, webinar). For each: format and main promise.`);
      ctx.reply(`🧲 *Lead Magnets — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Lead magnet error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(topic) } as any);
    }
  });
});

// ---------- /plans (EzyAi-style pricing) ------------------------------------------

function currentLabel(ctx: any): string {
  const id = getUid(ctx);
  const acc = id ? getAccountByProviderKey('telegram', id) : undefined;
  if (acc && tierIndex(acc.plan) > 0) {
    return PLANS.find((p) => p.tier === acc.plan)?.label || String(acc.plan).toUpperCase();
  }
  return getPlanLabel(id ? userState[id] : undefined);
}

function plansInline(): any {
  return {
    inline_keyboard: [
      ...PLANS.filter((p) => p.tier !== 'free').map((p) => [{ text: `Choose ${p.label} · ${p.price}`, callback_data: `plan_${p.tier}` }]),
      [{ text: '🎁 Claim FREE 3-day trial', callback_data: 'trial_claim' }],
      [{ text: '🎫 Redeem a code', callback_data: 'redeem_prompt' }],
    ],
  };
}

function sendPlansMessage(ctx: any, label: string) {
  const plansText = PLANS.map((p) => `\n*${p.label}* — ${p.price}\n• ${p.features}`).join('\n');
  ctx.reply(`💳 *Plans*\nCurrent: *${label}*${plansText}\n\nTap a plan to pay securely by card (or choose USDT), claim your free trial, or redeem a code.`, { parse_mode: 'Markdown', reply_markup: plansInline() } as any);
}

bot.command('plans', (ctx: any) => {
  sendPlansMessage(ctx, currentLabel(ctx));
});

bot.action('plans_back', async (ctx: any) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(`💳 *Plans*\nCurrent: *${currentLabel(ctx)}*`, { parse_mode: 'Markdown', reply_markup: plansInline() } as any);
});

bot.action(/^plan_/, async (ctx: any) => {
  const tier = (ctx.match?.[0] as string).replace('plan_', '');
  const id = getUid(ctx);
  if (!isTier(tier) || tier === 'free') {
    await ctx.answerCbQuery('Pick a paid plan');
    return;
  }
  const p = PLANS.find((x) => x.tier === tier);
  await ctx.answerCbQuery(`Checkout: ${p?.label}`);
  const res = await createCheckoutForChatId(id, ctx.from?.first_name, tier, 'stripe');
  if (res.status === 'ok') {
    await ctx.editMessageText(
      `💳 *${p?.label}* — ${priceLabel(tier)}\n\nPay securely by card below. 30 days of access start right after confirmation.`,
      { parse_mode: 'Markdown', reply_markup: {
        inline_keyboard: [
          [{ text: `💳 Pay ${p?.price} by card`, url: res.url }],
          [{ text: '₮ Pay with USDT', callback_data: `pay_usdt_${tier}` }, { text: '↩️ Back', callback_data: 'plans_back' }],
        ],
      } } as any
    );
    return;
  }
  if (res.status === 'usdt-manual') {
    await ctx.editMessageText(`₮ *${p?.label}* — ${priceLabel(tier)}\n\nUSDT (TRC-20) to:\n\n\`${res.usdtAddress}\`\n\nSend the exact amount with your Telegram username in the memo, then tap confirm.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Done — confirm my payment', callback_data: `pay_usdt_${tier}` }, { text: '↩️ Back', callback_data: 'plans_back' }]] } } as any);
    return;
  }
  if (res.status === 'pending-config') {
    await ctx.editMessageText('💤 Payments are being connected — try again in a moment, claim your free trial, or redeem a code.', { reply_markup: plansInline() } as any);
    return;
  }
  await ctx.editMessageText('❌ Could not start checkout. Try again shortly.', { reply_markup: plansInline() } as any);
});

bot.action(/^pay_usdt_/, async (ctx: any) => {
  const tier = (ctx.match?.[0] as string).replace('pay_usdt_', '');
  const p = PLANS.find((x) => x.tier === tier);
  const address = process.env.USDT_ADDRESS;
  if (!address || !usdtConfigured()) {
    await ctx.answerCbQuery('USDT not configured yet');
    return;
  }
  await ctx.answerCbQuery('USDT instructions');
  await ctx.reply(`₮ *USDT payment — ${p?.label}* (${priceLabel(tier)})\n\nSend the exact amount in USDT (TRC-20) to:\n\n\`${address}\`\n\n📝 Put your Telegram *username* in the memo.\n\nOnce you've sent it, ping the admin — your plan is activated on confirmation.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

// ---------- Admin: confirm a USDT / manual payment ----------

bot.command('confirmpay', (ctx: any) => {
  const adm = getUid(ctx);
  if (!isAdmin(adm)) {
    ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any);
    return;
  }
  const args = ((ctx.message as any).text || '').split(' ').slice(1);
  const [uid, tier] = args;
  if (!uid || !isTier(tier) || tier === 'free') {
    ctx.reply('Usage: /confirmpay <telegramUid> <tier>', showMenu(ctx, 'main') as any);
    return;
  }
  const account = getAccountByProviderKey('telegram', uid.toLowerCase());
  if (!account) {
    ctx.reply(`No linked web account for Telegram id *${uid}* yet.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return;
  }
  const updated = activateAccount(account.id, tier);
  if (!updated) {
    ctx.reply('Could not activate that plan.', showMenu(ctx, 'main') as any);
    return;
  }
  // keep the bot's own view of the chat in sync
  if (userState[uid]) {
    userState[uid].plan = tier;
    userState[uid].proUntil = updated.planUntil;
    saveState(userState);
  }
  ctx.reply(`✅ Activated *${PLANS.find((x) => x.tier === tier)?.label || tier}* for Telegram id *${uid}* until ${new Date(updated.planUntil || '').toDateString()}.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

bot.action('redeem_prompt', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery('Send your code...');
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].type = 'redeem_code';
    saveState(userState);
  }
  ctx.reply('🎫 Paste your redeem code (e.g. `EZY-1234-567`)', { parse_mode: 'Markdown', reply_markup: forceReply } as any);
});

// ---------- /redeem CODE -----------------------------------------------------------

function redeemCode(ctx: any, code: string): boolean {
  const id = getUid(ctx);
  const c = String(code || '').toUpperCase().trim();
  if (!c) {
    ctx.reply('Usage: /redeem CODE', showMenu(ctx, 'main') as any);
    return false;
  }
  const codes = userState.__codes || {};
  const entry = codes[c];
  if (!entry) {
    ctx.reply(`❌ Code *${c}* not found or already used.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return false;
  }
  const used = entry.usedBy || [];
  const idStr = id || '';
  const alreadyUsed = used.includes(idStr);
  if (used.length >= (entry.uses || 1) && !alreadyUsed) {
    ctx.reply(`❌ Code *${c}* has no uses left.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return false;
  }
  if (id) {
    userState[id] = userState[id] || {};
    if (entry.kind === 'trial') {
      const days = entry.days || 3;
      userState[id].trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
      if (!alreadyUsed) used.push(id);
      userState.__codes = codes;
      saveState(userState);
      ctx.reply(`🎁 Trial activated: *${days} days of PRO*! Enjoy all premium marketing tools.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    } else if (entry.kind === 'months') {
      userState[id].plan = 'navigator';
      const months = entry.months;
      userState[id].proUntil = new Date(Date.now() + months * 30 * 86400000).toISOString();
      if (!alreadyUsed) used.push(id);
      userState.__codes = codes;
      saveState(userState);
      ctx.reply(`🎉 Code redeemed: *${months} month(s) of PRO*! Welcome aboard. 🚀`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    } else {
      ctx.reply('❌ Unknown code type.', showMenu(ctx, 'main') as any);
      return false;
    }
  }
  return true;
}
bot.command('redeem', (ctx: any) => {
  const code = (ctx.message as any).text.split(' ').slice(1)[0];
  redeemCode(ctx, code);
});

// ---------- Admin monetization -------------------------------------------------------

bot.command('mkcode', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) { ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any); return; }
  const args = (ctx.message as any).text.split(' ').slice(1);
  const codes = userState.__codes || {};
  userState.__codes = codes;
  let created = 0;
  const make = (code: string, entry: any) => {
    const existing = Object.keys(codes).length;
    const finalCode = code || `EZY-${String(1000 + existing).slice(-4)}-${Math.floor(100 + Math.random() * 900)}`;
    codes[finalCode] = entry;
    created++;
  };
  if (args[0] === 'trial') {
    const days = parseInt(args[1]);
    const count = Math.max(1, parseInt(args[2]) || 1);
    const uses = Math.max(1, parseInt(args[3]) || 1);
    if (!days) { ctx.reply('Usage: /mkcode trial <DAYS> [COUNT] [USES]', showMenu(ctx, 'main') as any); return; }
    for (let i = 0; i < count; i++) make('', { kind: 'trial', days, uses, createdAt: Date.now(), usedBy: [] });
  } else if (args[0] === '1mo' || args[0] === 'months') {
    const months = args[0] === '1mo' ? 1 : parseInt(args[1]) || 1;
    const count = Math.max(1, parseInt(args[1] || args[2]) || 1);
    const uses = Math.max(1, parseInt(args[2] || args[3]) || 1);
    for (let i = 0; i < count; i++) make('', { kind: 'months', months, uses, createdAt: Date.now(), usedBy: [] });
  } else {
    ctx.reply('Usage: /mkcode trial <DAYS> [COUNT] [USES]  OR  /mkcode 1mo [COUNT] [USES]', showMenu(ctx, 'main') as any);
    return;
  }
  userState.__codes = codes;
  saveState(userState);
  const newCodes = Object.keys(codes).slice(-created);
  ctx.reply(`✅ Created *${created}* code(s):\n${newCodes.join('\n')}\n\nCustomers redeem with /redeem CODE`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

bot.command('codes', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) { ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any); return; }
  const codes = userState.__codes || {};
  const list = Object.entries(codes).map(([code, e]: any) => `• *${code}* — ${e.kind === 'trial' ? `${e.days}d trial` : `${e.months || 1}mo`} · uses ${(e.usedBy || []).length}/${e.uses || 1}`).join('\n');
  ctx.reply(`🗂️ *Active codes*\n${list || 'None yet. Create with /mkcode'}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

bot.command('revokecode', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) { ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any); return; }
  const code = (ctx.message as any).text.split(' ').slice(1).join(' ').toUpperCase().trim();
  const codes = userState.__codes || {};
  if (!code || !codes[code]) { ctx.reply('Usage: /revokecode CODE', showMenu(ctx, 'main') as any); return; }
  delete codes[code];
  userState.__codes = codes;
  saveState(userState);
  ctx.reply(`♻️ Code *${code}* revoked.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

bot.command('settrial', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) { ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any); return; }
  const days = parseInt((ctx.message as any).text.split(' ').slice(1)[0]);
  if (days) {
    userState.__trialDays = days;
    saveState(userState);
    ctx.reply(`🎁 Default trial set to *${days} days*.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  } else {
    ctx.reply(`🎁 Default trial is currently *${userState.__trialDays || 3} days*. Use /settrial <DAYS> (1-30).`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
  }
});

// ---------- /admin overview ------------------------------------------------------------

bot.command('admin', (ctx: any) => {
  if (!isAdmin(getUid(ctx))) { ctx.reply('⛔ Admin only.', showMenu(ctx, 'main') as any); return; }
  const ids = Object.keys(userState).filter((k) => /^\d{6,}$/.test(k));
  const proUsers = ids.filter((k) => isPayingUser(k)).length;
  const leadIds = new Set<string>();
  return getLeads().then((leads) => {
    leads.forEach((l) => leadIds.add(l.telegramId));
    const totalUsers = new Set([...ids, ...leadIds]).size;
    ctx.reply(
      `🛡️ *Admin panel*\n\nUsers: *${totalUsers}*\nActive state entries: ${ids.length}\nPRO / trial users: ${proUsers}\nLeads: ${leads.length}\nTrial days default: ${userState.__trialDays || 3}\n\nTools: /mkcode · /codes · /revokecode · /settrial · /broadcast`,
      { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any
    );
  });
});

// ---------- Plan / trial inline callbacks ----------------------------------------------

bot.action(/^plan_/, async (ctx: any) => {
  const tier = (ctx.match?.[0] as string).replace('plan_', '');
  const id = getUid(ctx);
  await ctx.answerCbQuery(`Plan: ${tier}`);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].plan = tier;
    saveState(userState);
  }
  await ctx.editMessageText(`💳 Plan set to *${PLANS.find((p) => p.tier === tier)?.label || tier.toUpperCase()}*.\n\n${PLANS.find((p) => p.tier === tier)?.features || ''}`, { parse_mode: 'Markdown' });
  ctx.reply('Done! What next?', showMenu(ctx, 'main') as any);
});

bot.action('trial_claim', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery('Claiming trial...');
  const days = userState.__trialDays || 3;
  if (id) {
    userState[id] = userState[id] || {};
    if (userState[id].trialClaimed) {
      ctx.reply('🎁 You already claimed your free trial.', showMenu(ctx, 'main') as any);
      return;
    }
    userState[id].trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
    userState[id].trialClaimed = true;
    saveState(userState);
  }
  await ctx.editMessageText(`🎁 *Free trial claimed!* You have ${days} days of PRO.\n🧰 Open 💼 Marketing to use Content Studio, Campaigns, Keywords, Lead Magnets.`, { parse_mode: 'Markdown' });
  ctx.reply('Enjoy PRO!', showMenu(ctx, 'main') as any);
});

// ---------- /help & /dashboard -------------------------------------------------------------

bot.command('help', (ctx: any) => {
  const helpText =
    `*🧰 TG Ezy AI OS — Marketing Command Center*` +
    `\n\n*Core:* /start · /help · /plans · /dashboard · /inbox` +
    `\n*Leads:* /addlead · /stage · /stats · /leads · /deletelead` +
    `\n*Marketing:* /plan · /persona · /meta · /valuemap · /review · /growth · /swipe` +
    `\n*Content Studio (PRO):* /content · /campaign · /keywords · /leadmagnet` +
    `\n*Automation:* /workflow · /rules · /remind` +
    `\n*Settings:* /profile · /business · /export (PRO)` +
    `\n*Watches:* /quote · /fundamentals · /watch · /watches · /unwatch · /autopilot` +
    `\n*Billing:* /plans · /redeem CODE` +
    `\n\n💡 Tip: tap ⚙️ Tools & Auto and ⚙️ Settings to explore guided flows.`;
  ctx.reply(helpText, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

bot.command('dashboard', (ctx: any) => {
  const port = process.env.PORT || 3000;
  const base = process.env.PUBLIC_URL || `http://localhost:${port}`;
  ctx.reply(`📊 *Marketing Dashboard*\n\nOpen: ${base}/dashboard\n(Expose the app publicly with a PUBLIC_URL to share the link.)`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

// ---------- Reminders (persisted across restarts) -------------------------------------

interface StoredReminder { chatId: string; when: number; message: string; }

function storeReminder(chatId: string, when: number, message: string): void {
  const list = userState.__reminders || [];
  list.push({ chatId, when, message });
  userState.__reminders = list.slice(-200);
  saveState(userState);
}

function scheduleReminder(chatId: string, delayMs: number, message: string): NodeJS.Timeout {
  storeReminder(chatId, Date.now() + delayMs, message);
  const t = setTimeout(() => fireReminder(chatId, message), delayMs);
  t.unref();
  return t;
}

async function fireReminder(chatId: string, message: string): Promise<void> {
  const list = userState.__reminders || [];
  userState.__reminders = list.filter((r) => !(r.chatId === chatId && r.message === message && r.when <= Date.now()));
  saveState(userState);
  try {
    const s = userState[chatId];
    const l = localize(s?.lang);
    await bot.telegram.sendMessage(chatId, `⏰ *Reminder:* ${message}`, { parse_mode: 'Markdown', reply_markup: MENUS.main(l) } as any);
  } catch (e) {
    console.error('Reminder send failed:', e);
  }
}

function restoreReminders(): void {
  const list = userState.__reminders || [];
  userState.__reminders = [];
  const now = Date.now();
  for (const r of list) {
    if (r.when > now) {
      setTimeout(() => fireReminder(r.chatId, r.message), r.when - now).unref();
      userState.__reminders.push(r);
    }
  }
  saveState(userState);
}

// ---------- Message flow (guided captures + default AI) -------------------------------

bot.on('text', async (ctx: any) => {
  const id = getUid(ctx);
  const msg = (String(ctx.message.text || '')).trim();

  if (buttonTexts.has(msg)) return; // it's a keyboard button (handled by hears)

  const s = id ? userState[id] : undefined;

  // Lead name capture
  if (s?.type === 'name') {
    userState[id].name = msg;
    userState[id].type = 'stage';
    saveState(userState);
    ctx.reply(`Name saved: ${msg}\nNow choose a stage 👇`, { reply_markup: stageKeyboard } as any);
    return;
  }

  // Stage text fallback
  if (s?.type === 'stage') {
    const valid = ['new', 'contacted', 'qualified', 'closed'];
    if (valid.includes(msg.toLowerCase())) {
      const lead = await addLead({ telegramId: id, name: userState[id].name, stage: msg.toLowerCase() });
      ctx.reply(`✅ Lead added: *${lead.name ?? 'Unnamed'}* – ${lead.stage}`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
      userState[id] = { type: 'idle' };
      saveState(userState);
    } else {
      ctx.reply('Please pick a stage with the buttons 👆', { reply_markup: stageKeyboard } as any);
    }
    return;
  }

  // Persona captures
  if (s?.type === 'persona_tone') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.tone = msg;
    userState[id].type = 'idle';
    saveState(userState);
    ctx.reply(`🎭 Tone updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return;
  }
  if (s?.type === 'persona_audience') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.audience = msg;
    userState[id].type = 'idle';
    saveState(userState);
    ctx.reply(`🎭 Audience updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return;
  }
  if (s?.type === 'persona_style') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.style = msg;
    userState[id].type = 'idle';
    saveState(userState);
    ctx.reply(`🎭 Style updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
    return;
  }

  // Guided marketing tool capture
  if (s?.type === 'guided' && s.guided?.tool) {
    const tool = s.guided.tool;
    userState[id].type = 'idle';
    delete userState[id].guided;
    saveState(userState);
    await runGuided(ctx, tool, msg);
    return;
  }

  // Reminder guided capture
  if (s?.type === 'remind_after') {
    const minutes = parseInt(msg);
    if (!minutes || isNaN(minutes) || minutes <= 0 || minutes > 4320) {
      ctx.reply('Please send a number of minutes (1–4320):', { reply_markup: forceReply } as any);
      return;
    }
    userState[id].remindAfter = minutes;
    userState[id].type = 'remind_msg';
    saveState(userState);
    ctx.reply(`Great — reminder in *${minutes} min*. What should I remind you about?`, { parse_mode: 'Markdown', reply_markup: forceReply } as any);
    return;
  }
  if (s?.type === 'remind_msg' && s.remindAfter) {
    scheduleReminder(ctx.chat?.id?.toString() || '', s.remindAfter * 60000, msg);
    userState[id].type = 'idle';
    delete userState[id].remindAfter;
    saveState(userState);
    ctx.reply(`⏰ Reminder set for ${s.remindAfter} minute(s): "${msg}"`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'toolsAuto').reply_markup } as any);
    return;
  }

  // Broadcast capture (admin)
  if (s?.type === 'broadcast_msg') {
    if (!isAdmin(id)) { cancelFlows(ctx, '⛔ Admin only.'); return; }
    userState[id].type = 'idle';
    userState[id].pendingBroadcast = msg;
    saveState(userState);
    ctx.reply(
      `📣 *Confirm broadcast*\n\n"${msg}"\n\nSend to all users & leads?`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '✅ Send', callback_data: 'broadcast_confirm' }, { text: '🚫 Cancel', callback_data: 'g_cancel' }]] },
      } as any
    );
    return;
  }

  // Redeem code capture
  if (s?.type === 'redeem_code') {
    userState[id].type = 'idle';
    saveState(userState);
    redeemCode(ctx, msg);
    return;
  }

  // Business profile capture
  if (s?.type === 'biz_name') {
    if (msg.toLowerCase() === '/skip') {
      userState[id].business = userState[id].business || { tone: 'professional' };
      userState[id].type = 'biz_website';
      saveState(userState);
      ctx.reply('What is your website? (or /skip)', { reply_markup: forceReply } as any);
      return;
    }
    userState[id].business = { ...(userState[id].business || {}), name: msg };
    userState[id].type = 'biz_website';
    saveState(userState);
    ctx.reply(`Business name: *${msg}*\nWhat is your website? (or /skip)`, { parse_mode: 'Markdown', reply_markup: forceReply } as any);
    return;
  }
  if (s?.type === 'biz_website') {
    userState[id].business = { ...(userState[id].business || {}), website: msg.toLowerCase() === '/skip' ? undefined : msg };
    userState[id].type = 'biz_tone';
    saveState(userState);
    ctx.reply('Default writing tone? (e.g. friendly, professional, witty) — or /skip', { reply_markup: forceReply } as any);
    return;
  }
  if (s?.type === 'biz_tone') {
    userState[id].business = { ...(userState[id].business || {}), tone: msg.toLowerCase() === '/skip' ? 'professional' : msg };
    userState[id].type = 'idle';
    saveState(userState);
    const biz = userState[id].business;
    ctx.reply(`🏢 *Business profile saved*\n\n${Object.entries(biz).filter(([, v]) => v).map(([k, v]) => `• ${k}: ${v}`).join('\n')}\n\nYour AI copy is now grounded in these facts.`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'settings').reply_markup } as any);
    return;
  }

  // Default AI reply — re-show the right menu
  try {
    await ctx.telegram.sendChatAction(id || '', 'typing');
    const persona = (id && userState[id]?.persona) ? userState[id].persona : undefined;
    const biz = (id && userState[id]?.business) ? userState[id].business : undefined;
    let prompt = msg;
    if (persona?.tone || persona?.audience || persona?.style) {
      prompt = `(Brand persona: tone "${persona.tone || 'professional'}", audience "${persona.audience || 'general'}", style "${persona.style || 'clear'}".) ${prompt}`;
    }
    if (biz?.name || biz?.website || biz?.tone) {
      prompt = `(Business facts: ${[biz.name, biz.website, biz.tone].filter(Boolean).join(', ') || 'none'}.) ${prompt}`;
    }
    let aiResponse = await safeGenerateResponse(prompt);
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].aiCount = (userState[id].aiCount || 0) + 1;
      saveState(userState);
    }
    const menu = (id && userState[id]?.menu && MENUS[userState[id].menu]) ? userState[id].menu : 'main';
    const l = localize(id ? userState[id]?.lang : undefined);
    ctx.reply(aiResponse, { reply_markup: MENUS[menu](l) } as any);
  } catch (err: any) {
    console.error('AI reply error:', err);
    ctx.reply(`Sorry, I couldn't process that. (${err?.message ?? 'AI error'})`, { reply_markup: MENUS.main((s) => s) } as any);
  }
});

// ---------- Broadcast execution (admin) ------------------------------------------------

bot.action('broadcast_confirm', async (ctx: any) => {
  const id = getUid(ctx);
  await ctx.answerCbQuery('Broadcasting...');
  if (!isAdmin(id)) return;
  const msg = userState[id]?.pendingBroadcast;
  if (!msg) {
    ctx.reply('No pending broadcast.', showMenu(ctx, 'main') as any);
    return;
  }
  delete userState[id].pendingBroadcast;
  saveState(userState);
  const leads = await getLeads();
  const ids = new Set<string>(Object.keys(userState).filter((k) => /^\d{6,}$/.test(k)));
  leads.forEach((l: any) => ids.add(l.telegramId));
  let sent = 0;
  for (const uid of ids) {
    try {
      await bot.telegram.sendMessage(uid, `📣 *Broadcast:*\n${msg}`, { parse_mode: 'Markdown' } as any);
      sent++;
    } catch (e) {
      // skip unreachable users
    }
  }
  ctx.reply(`📣 Broadcast sent to *${sent}* user(s).`, { parse_mode: 'Markdown', reply_markup: showMenu(ctx, 'main').reply_markup } as any);
});

// ---------- Dead-button guard (single source of truth) --------------------------------

const missing = ALL_LABELS.filter((l) => !handledLabels.has(l));
if (missing.length) {
  console.warn(`[menu-guard] BUTTONS WITHOUT HANDLERS: ${missing.join(', ')}`);
} else {
  console.log(`[menu-guard] All ${ALL_LABELS.length} keyboard labels have handlers ✔`);
}

// ---------- Launch / shutdown -----------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

async function launch(): Promise<void> {
  restoreReminders();
  const ok = await bot.launch();
  try {
    await bot.telegram.setMyCommands(botCommands as any);
  } catch (e) {
    console.warn('Could not set commands menu', e);
  }
  console.log('Bot started');
}

launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));