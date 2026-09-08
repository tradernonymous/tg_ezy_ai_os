import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { addLead, updateLeadByTelegramId, getLeads, deleteLead } from './leadStore';
import { generateResponse } from './aiProvider';

async function safeGenerateResponse(prompt: string): Promise<string> {
  const reply = await generateResponse(prompt);
  return truncateText(reply || 'No response from AI.');
}
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');

// ---------- Monetization config (EzyAi-style) ----------
const ADMIN_TELEGRAM_ID = (process.env.ADMIN_TELEGRAM_ID || '').toString();
const PRO_ACCESS_IDS = (process.env.PRO_ACCESS_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PLANS = [
  { tier: 'free', label: 'Free', price: '$0', features: 'Leads, Stats, Plan, Persona, Meta, Value, Review, Growth, Swipe, Workflow' },
  { tier: 'pro', label: 'PRO', price: '$14.99/mo', features: 'Everything in Free + Content Studio, Campaigns, Keywords, Lead Magnets, Auto-workflows, Priority AI' },
  { tier: 'enterprise', label: 'Enterprise', price: 'Custom', features: 'Everything in PRO + multi-seat, exports, dedicated support' },
];
const PRO_FEATURES = ['📝 Content', '✉️ Campaign', '🔑 Keywords', '🧲 Lead Magnet', '⚙️ Workflow', '📈 Growth'];

function isPayingUser(id?: string): boolean {
  if (!id) return false;
  if (PRO_ACCESS_IDS.includes(id)) return true;
  const s = userState[id];
  if (!s) return false;
  if (s.plan === 'pro' || s.plan === 'enterprise') return true;
  if (s.trialEndsAt && new Date(s.trialEndsAt).getTime() > Date.now()) return true;
  return false;
}
function isAdmin(id?: string): boolean {
  return !!id && (id === ADMIN_TELEGRAM_ID);
}
function getPlanLabel(state: any): string {
  if (state?.plan) return PLANS.find(p => p.tier === state.plan)?.label || state.plan.toUpperCase();
  if (state?.trialEndsAt && new Date(state.trialEndsAt).getTime() > Date.now()) return 'PRO (trial)';
  return 'Free';
}

// ---------- Persistent session state ----------
const STATE_PATH = path.resolve(__dirname, '..', 'db', 'state.json');
function loadState(): Record<string, any> {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const raw = fs.readFileSync(STATE_PATH, 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveState(state: Record<string, any>) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

const userState = loadState();

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

// ---------- Raw markup objects (guaranteed to render in Telegram clients) ----------
const mainMenu = {
  keyboard: [
    [{ text: '📊 Stats & Leads' }, { text: '➕ Add Lead' }],
    [{ text: '💼 Marketing' }, { text: '⚙️ Tools & Auto' }],
    [{ text: '🌐 Language' }, { text: '⚙️ Settings' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const statsLeadsSubMenu = {
  keyboard: [
    [{ text: '📊 Stats' }, { text: '📂 Leads List' }],
    [{ text: '📈 Pipeline' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const marketingSubMenu = {
  keyboard: [
    [{ text: '💳 Plan' }, { text: '🎭 Persona' }],
    [{ text: '🔍 Meta' }, { text: '🗺️ Value' }],
    [{ text: '✏️ Review' }, { text: '📈 Growth' }],
    [{ text: '📂 Swipe' }, { text: '⚙️ Workflow' }],
    [{ text: '📝 Content' }, { text: '✉️ Campaign' }],
    [{ text: '🔑 Keywords' }, { text: '🧲 Lead Magnet' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const settingsAutoSubMenu = {
  keyboard: [
    [{ text: '⏰ Remind' }, { text: '🚩 Handoff' }],
    [{ text: '⚙️ Settings' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const langSubMenu = {
  keyboard: [
    [{ text: '🇬🇧 EN' }, { text: '🇪🇸 ES' }],
    [{ text: '🇫🇷 FR' }, { text: '🇩🇪 DE' }],
    [{ text: '🇨🇳 ZH' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};

const planSubMenu = {
  keyboard: [
    [{ text: '📊 Current Plan' }, { text: '💳 Set Free' }],
    [{ text: '💳 Set Pro' }, { text: '💳 Set Enterprise' }],
    [{ text: '🏠 Main Menu' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const personaSubMenu = {
  keyboard: [
    [{ text: '🎭 Tone' }, { text: '🎭 Audience' }],
    [{ text: '🎭 Style' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const metaSubMenu = {
  keyboard: [
    [{ text: '🔍 Generate Meta' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const valueSubMenu = {
  keyboard: [
    [{ text: '🗺️ Generate Map' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const reviewSubMenu = {
  keyboard: [
    [{ text: '✏️ Review Content' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const growthSubMenu = {
  keyboard: [
    [{ text: '📈 Show Prompts' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const swipeSubMenu = {
  keyboard: [
    [{ text: '📂 Show Swipe' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const workflowSubMenu = {
  keyboard: [
    [{ text: '⚙️ Show Workflow' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};

const contentSubMenu = {
  keyboard: [
    [{ text: '📝 Post' }, { text: '📧 Email' }],
    [{ text: '✍️ Hook' }, { text: '🏷️ Caption' }],
    [{ text: '🏠 Main Menu' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const campaignSubMenu = {
  keyboard: [
    [{ text: '💡 Ideas' }, { text: '📰 Launch' }],
    [{ text: '🏠 Main Menu' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const keywordsSubMenu = {
  keyboard: [
    [{ text: '🔑 Research' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const leadMagnetSubMenu = {
  keyboard: [
    [{ text: '🧲 Generate' }, { text: '🏠 Main Menu' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};

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

// ---------- One-tap follow-ups (EzyAi style: Watch / Fundamentals / Quote on every result) ----------
function followUpRow(topic: string): Record<string, any> {
  return {
    inline_keyboard: [
      [
        { text: '✍️ More Hooks', callback_data: `fup_hooks` },
        { text: '🏷️ Captions', callback_data: `fup_captions` },
      ],
      [
        { text: '📧 Email', callback_data: `fup_email` },
        { text: '🏠 Main Menu', callback_data: `fup_menu` },
      ],
    ],
  };
}
function rememberTopic(id: string | undefined, topic: string) {
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].lastTopic = topic;
    saveState(userState);
  }
}
bot.action('fup_hooks', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const topic = (id && userState[id]?.lastTopic) ? userState[id].lastTopic : 'our product';
  await ctx.answerCbQuery('Generating hooks...');
  try {
    const ai = await safeGenerateResponse(`Create 5 attention-grabbing hooks/openers for "${topic}". One line each, punchy.`);
    ctx.reply(`✍️ *Hooks — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Hook error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});
bot.action('fup_captions', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const topic = (id && userState[id]?.lastTopic) ? userState[id].lastTopic : 'our product';
  await ctx.answerCbQuery('Generating captions...');
  try {
    const ai = await safeGenerateResponse(`Write 10 short captions (under 100 chars) with 4-5 fitting hashtags for "${topic}".`);
    ctx.reply(`🏷️ *Captions — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Caption error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});
bot.action('fup_email', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const topic = (id && userState[id]?.lastTopic) ? userState[id].lastTopic : 'our product';
  await ctx.answerCbQuery('Writing email...');
  try {
    const ai = await safeGenerateResponse(`Write a short cold outreach email (subject + 80-120 word body + CTA) for "${topic}". Keep it personal and non-spammy.`);
    ctx.reply(`📧 *Email — ${topic}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Email error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});
bot.action('fup_menu', async (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = { type: 'idle' }; saveState(userState); }
  await ctx.answerCbQuery('Opening menu');
  ctx.reply('🏠 Main menu:', { reply_markup: mainMenu } as any);
});

// ---------- Language ----------
bot.command('lang', (ctx) => {
  ctx.reply('🌐 Choose your language:', { reply_markup: langSubMenu } as any);
});
bot.hears('🇬🇧 EN', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = userState[id] || {}; userState[id].lang = 'en'; saveState(userState); }
  ctx.reply('🇬🇧 Language set to English.', { reply_markup: mainMenu } as any);
});
bot.hears('🇪🇸 ES', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = userState[id] || {}; userState[id].lang = 'es'; saveState(userState); }
  ctx.reply('🇪🇸 Idioma cambiado a Español.', { reply_markup: mainMenu } as any);
});
bot.hears('🇫🇷 FR', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = userState[id] || {}; userState[id].lang = 'fr'; saveState(userState); }
  ctx.reply('🇫🇷 Langue définie sur Français.', { reply_markup: mainMenu } as any);
});
bot.hears('🇩🇪 DE', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = userState[id] || {}; userState[id].lang = 'de'; saveState(userState); }
  ctx.reply('🇩🇪 Sprache auf Deutsch eingestellt.', { reply_markup: mainMenu } as any);
});
bot.hears('🇨🇳 ZH', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = userState[id] || {}; userState[id].lang = 'zh'; saveState(userState); }
  ctx.reply('🇨🇳 语言已设置为中文。', { reply_markup: mainMenu } as any);
});

// ---------- Bot commands for the header Menu button ----------
const botCommands = [
  { command: 'start', description: '🏠 Show main menu' },
  { command: 'addlead', description: '➕ Add a new lead' },
  { command: 'stage', description: '🔄 Set lead stage' },
  { command: 'stats', description: '📊 Show stats' },
  { command: 'leads', description: '📂 List/search leads' },
  { command: 'deletelead', description: '🗑️ Delete a lead' },
  { command: 'remind', description: '⏰ Set reminder' },
  { command: 'handoff', description: '🚩 Human handoff' },
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
  { command: 'plans', description: '💳 Pricing & plans' },
  { command: 'redeem', description: '🎫 Redeem a code' },
  { command: 'help', description: '📖 Help menu' },
  { command: 'dashboard', description: '📊 Open dashboard' },
  { command: 'ping', description: '🏓 Ping the bot' },
];

// ---------- Navigation ----------
bot.hears('🏠 Main Menu', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) { userState[id] = { type: 'idle' }; saveState(userState); }
  ctx.reply('🏠 Main menu:', { reply_markup: mainMenu } as any);
});
bot.command('back', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = { type: 'idle' };
    saveState(userState);
  }
  ctx.reply('⬅️ Back to main menu:', { reply_markup: mainMenu } as any);
});
bot.hears('⬅️ Back', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = { type: 'idle' };
    saveState(userState);
  }
  ctx.reply('⬅️ Back to main menu:', { reply_markup: mainMenu } as any);
});

// ---------- /start ----------
bot.start((ctx) => {
  const id = ctx.from?.id?.toString();
  if (id && !userState[id]) userState[id] = { type: 'idle' };
  saveState(userState);
  const langCode = (id && userState[id]?.lang) ? userState[id].lang : 'en';
  const lang = loadLang(langCode);
  const welcomeMsg = (lang.welcome ? lang.welcome : 'Welcome to *TG Ezy AI OS*! 👋') + '\n\n' + (lang.welcome_sub ? lang.welcome_sub : 'Tap a button below or use commands.') + '\n\n✨ Quick links: /stats · /leads · /plan · /persona · /meta · /valuemap\n⚡ Commands available below 👇';
  ctx.reply(welcomeMsg, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- /ping ----------
bot.command('leads', async (ctx) => {
  try {
    const leads = await getLeads();
    const stages = ['new', 'contacted', 'qualified', 'closed'];
    const filterKeyboard = {
      inline_keyboard: stages.map((s) => [{ text: s.toUpperCase(), callback_data: `search_stage_${s}` }]),
    };
    const listText = leads.length ? leads.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads yet.';
    ctx.reply(`📂 *Leads List* (${leads.length})\n` + listText + '\n\nFilter by stage 👇', {
      parse_mode: 'Markdown',
      reply_markup: filterKeyboard,
    } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Could not load leads (${e?.message ?? 'error'})`, { reply_markup: mainMenu } as any);
  }
});

bot.command('handoff', async (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    await updateLeadByTelegramId(id, { stage: 'contacted' });
    ctx.reply('🚩 Lead flagged for *human review* (handoff requested). Our team will contact you shortly.', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});

bot.command('deletelead', async (ctx) => {
  const telegramId = (ctx.message as any).text.split(' ').slice(1).join(' ').trim();
  if (!telegramId) {
    ctx.reply('Usage: /deletelead <telegramId>', { reply_markup: mainMenu } as any);
    return;
  }
  try {
    const leads = await getLeads();
    const found = leads.find((l: any) => l.telegramId === telegramId);
    if (!found) {
      ctx.reply(`No lead found for telegramId: ${telegramId}`, { reply_markup: mainMenu } as any);
      return;
    }
    const deleted = await deleteLead(found.id);
    ctx.reply(deleted ? `🗑️ Deleted lead: *${found.name ?? 'Unnamed'}* (${found.stage})` : 'Failed to delete.', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Error: ${e?.message ?? 'unknown'}`, { reply_markup: mainMenu } as any);
  }
});

bot.command('stats', async (ctx) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage || 'unknown'] = (acc[cur.stage || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byStage)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    ctx.reply(
      `📊 *Stats*\nTotal leads: *${total}*\nBreakdown: ${breakdown || 'none'}\n` +
      `Check full list: /leads`,
      { parse_mode: 'Markdown', reply_markup: mainMenu } as any
    );
  } catch (e: any) {
    ctx.reply(`⚠️ Could not fetch stats (${e?.message ?? 'error'})`, { reply_markup: mainMenu } as any);
  }
});

bot.command('ping', (ctx) => ctx.reply('pong'));

// ---------- /addlead ----------
bot.command('addlead', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) userState[id] = { type: 'name' };
  ctx.reply('Please enter the lead\'s name:', { reply_markup: forceReply } as any);
});

// ---------- Handle STAT / PROFILE / SETTINGS / LEADS LIST buttons ----------
bot.hears('➕ ADD LEAD', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) userState[id] = { type: 'name' };
  ctx.reply('Please enter the lead\'s name:', { reply_markup: forceReply } as any);
});

bot.hears('📊 Stats & Leads', (ctx) => {
  ctx.reply('📊 Choose an option:', { reply_markup: statsLeadsSubMenu } as any);
});
bot.hears('📊 Stats', async (ctx) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage || 'unknown'] = (acc[cur.stage || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byStage).map(([k, v]) => `${k}: ${v}`).join(', ');
    ctx.reply(`📊 *Stats*\nTotal leads: *${total}*\nBreakdown: ${breakdown || 'none'}`, { parse_mode: 'Markdown', reply_markup: statsLeadsSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Stats error (${e?.message ?? 'error'})`, { reply_markup: statsLeadsSubMenu } as any);
  }
});
bot.hears('📂 Leads List', async (ctx) => {
  try {
    const leads = await getLeads();
    const stages = ['new', 'contacted', 'qualified', 'closed'];
    const filterKeyboard = {
      inline_keyboard: stages.map((s) => [{ text: s.toUpperCase(), callback_data: `search_stage_${s}` }]),
    };
    const listText = leads.length ? leads.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads yet.';
    ctx.reply(`📂 *Leads List* (${leads.length})\n` + listText + '\n\nFilter by stage 👇', {
      parse_mode: 'Markdown',
      reply_markup: filterKeyboard,
    } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Could not load leads (${e?.message ?? 'error'})`, { reply_markup: statsLeadsSubMenu } as any);
  }
});
bot.hears('📈 Pipeline', (ctx) => {
  ctx.reply('📈 Pipeline overview — view full chart at /dashboard', { parse_mode: 'Markdown', reply_markup: statsLeadsSubMenu } as any);
});
bot.hears('👤 PROFILE', (ctx) => {
  const u = ctx.from;
  ctx.reply(
    `👤 *Profile*\nID: \`${u?.id}\`\nName: ${u?.first_name ?? ''} ${u?.last_name ?? ''}`,
    { parse_mode: 'Markdown', reply_markup: mainMenu } as any
  );
});
bot.hears('📂 LEADS LIST', (ctx) => {
  ctx.reply('📂 Leads list — check http://localhost:3000/api/leads', { reply_markup: mainMenu } as any);
});
bot.hears('🌐 Language', (ctx) => {
  ctx.reply('🌐 Choose your language:', { reply_markup: langSubMenu } as any);
});
bot.hears('💳 PLAN', (ctx) => {
  ctx.reply('💳 Choose a plan option:', { reply_markup: planSubMenu } as any);
});
bot.hears('📊 Current Plan', async (ctx) => {
  try {
    const id = ctx.from?.id?.toString();
    const userPlan = (id && userState[id]?.plan) ? userState[id].plan : 'free';
    const leads = await getLeads();
    ctx.reply(`💳 *Subscription Plan* — Current: *${userPlan.toUpperCase()}*\nLeads: ${leads.length}\nUse /plan set <tier> to change.`, { parse_mode: 'Markdown', reply_markup: planSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Plan error (${e?.message ?? 'error'})`, { reply_markup: planSubMenu } as any);
  }
});
bot.hears('💳 Set Free', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].plan = 'free';
    saveState(userState);
  }
  ctx.reply('💳 Plan updated to *FREE*', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.hears('💳 Set Pro', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].plan = 'pro';
    saveState(userState);
  }
  ctx.reply('💳 Plan updated to *PRO*', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.hears('💳 Set Enterprise', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].plan = 'enterprise';
    saveState(userState);
  }
  ctx.reply('💳 Plan updated to *ENTERPRISE*', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.hears('🎭 PERSONA', (ctx) => {
  ctx.reply('🎭 Choose persona setting:', { reply_markup: personaSubMenu } as any);
});
bot.hears('🎭 Tone', (ctx) => {
  const id = ctx.from?.id?.toString();
  const current = (id && userState[id]?.persona?.tone) ? userState[id].persona.tone : 'professional';
  ctx.reply(`🎭 Current tone: *${current}*\nSend new tone value (e.g., friendly, professional, witty)`, { reply_markup: personaSubMenu } as any);
  userState[id || ''] = userState[id || ''] || {};
  userState[id || ''].type = 'persona_tone';
  saveState(userState);
});
bot.hears('🎭 Audience', (ctx) => {
  const id = ctx.from?.id?.toString();
  const current = (id && userState[id]?.persona?.audience) ? userState[id].persona.audience : 'general';
  ctx.reply(`🎭 Current audience: *${current}*\nSend new audience value (e.g., general, developers, marketers)`, { reply_markup: personaSubMenu } as any);
  userState[id || ''] = userState[id || ''] || {};
  userState[id || ''].type = 'persona_audience';
  saveState(userState);
});
bot.hears('🎭 Style', (ctx) => {
  const id = ctx.from?.id?.toString();
  const current = (id && userState[id]?.persona?.style) ? userState[id].persona.style : 'clear';
  ctx.reply(`🎭 Current style: *${current}*\nSend new style value (e.g., clear, concise, detailed)`, { reply_markup: personaSubMenu } as any);
  userState[id || ''] = userState[id || ''] || {};
  userState[id || ''].type = 'persona_style';
  saveState(userState);
});
bot.hears('🔍 META', (ctx) => {
  ctx.reply('🔍 Choose meta action:', { reply_markup: metaSubMenu } as any);
});
bot.hears('🔍 Generate Meta', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const topic = msg || 'marketing';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, topic);
  try {
    const aiMeta = await safeGenerateResponse(`Generate SEO meta title (50-60 chars), meta description (155-160 chars), and URL slug for topic: ${topic}`);
    ctx.reply(`🔍 *SEO Meta for "${topic}"*\n` + aiMeta, { parse_mode: 'Markdown', reply_markup: followUpRow(topic) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Meta generation failed (${e?.message ?? 'error'})`, { reply_markup: followUpRow(topic) } as any);
  }
});
bot.hears('🗺️ VALUE', (ctx) => {
  ctx.reply('🗺️ Choose value action:', { reply_markup: valueSubMenu } as any);
});
bot.hears('🗺️ Generate Map', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const product = msg || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, product);
  try {
    const aiVal = await safeGenerateResponse(`Generate an OSP-style product value map for product: ${product}. Include tagline, value statements, persona needs, and feature categories.`);
    ctx.reply(`🗺️ *Value Map for "${product}"*\n` + aiVal, { parse_mode: 'Markdown', reply_markup: followUpRow(product) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Value map error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(product) } as any);
  }
});
bot.hears('✏️ REVIEW', (ctx) => {
  ctx.reply('✏️ Choose review action:', { reply_markup: reviewSubMenu } as any);
});
bot.hears('✏️ Review Content', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const content = msg || 'Sample content.';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, content);
  try {
    const aiReview = await safeGenerateResponse(`Review this content using OSP editing codes (scope, flow, style, word choice, grammar, technical accuracy). Provide constructive feedback with before/after examples. Content: ${content}`);
    ctx.reply(`✏️ *Content Review*\n` + aiReview, { parse_mode: 'Markdown', reply_markup: followUpRow(content) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Review error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(content) } as any);
  }
});
bot.hears('📈 GROWTH', async (ctx) => {
  try {
    const aiGrowth = await safeGenerateResponse('List 5 battle-tested growth marketing prompts for paid ads, SEO, email, CRO, and content. Keep each to one line.');
    ctx.reply(`📈 *Growth Prompts Library*\n` + aiGrowth, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Growth prompts error (${e?.message ?? 'error'})`, { reply_markup: mainMenu } as any);
  }
});
bot.hears('📂 Show Swipe', async (ctx) => {
  try {
    const aiSwipe = await safeGenerateResponse('Provide 3 ready-to-use swipe file hooks/headlines for marketing campaigns in English. Include a brief explanation of why each works.');
    ctx.reply(`📂 *Swipe Files*\n` + aiSwipe, { parse_mode: 'Markdown', reply_markup: swipeSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Swipe files error (${e?.message ?? 'error'})`, { reply_markup: swipeSubMenu } as any);
  }
});
bot.hears('📈 Show Prompts', async (ctx) => {
  try {
    const aiGrowth = await safeGenerateResponse('List 5 battle-tested growth marketing prompts for paid ads, SEO, email, CRO, and content. Keep each to one line.');
    ctx.reply(`📈 *Growth Prompts Library*\n` + aiGrowth, { parse_mode: 'Markdown', reply_markup: growthSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Growth prompts error (${e?.message ?? 'error'})`, { reply_markup: growthSubMenu } as any);
  }
});
bot.hears('⚙️ Show Workflow', (ctx) => {
  ctx.reply('⚙️ *Automation Workflows* — Trigger actions based on stage changes, reminders, and lead updates. Check automation settings under SETTINGS.', { parse_mode: 'Markdown', reply_markup: workflowSubMenu } as any);
});
bot.hears('📂 SWIPE', async (ctx) => {
  try {
    const aiSwipe = await safeGenerateResponse('Provide 3 ready-to-use swipe file hooks/headlines for marketing campaigns in English. Include a brief explanation of why each works.');
    ctx.reply(`📂 *Swipe Files*\n` + aiSwipe, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Swipe files error (${e?.message ?? 'error'})`, { reply_markup: mainMenu } as any);
  }
});
bot.hears('⚙️ WORKFLOW', (ctx) => {
  ctx.reply('⚙️ *Automation Workflows* — Trigger actions based on stage changes, reminders, and lead updates. Check automation settings under SETTINGS.', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- Content Studio ----------
bot.hears('📝 Content', (ctx) => {
  proGate(ctx, () => ctx.reply('📝 *Content Studio* — pick a format:', { parse_mode: 'Markdown', reply_markup: contentSubMenu } as any));
});
bot.hears('📝 Post', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Write a social media post (140-220 words) about "${msg}". Give 3 tones: friendly, professional, witty. Keep each punchy with a strong hook.`);
    ctx.reply(`📝 *Social Post — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Post error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});
bot.hears('📧 Email', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Write a short cold outreach email (subject + 80-120 word body + CTA) for "${msg}". Keep it personal and non-spammy.`);
    ctx.reply(`📧 *Email — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Email error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});
bot.hears('✍️ Hook', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Create 5 attention-grabbing hooks/openers for "${msg}" (question, stat, story, contrarian, direct). One line each.`);
    ctx.reply(`✍️ *Hooks — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Hook error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});
bot.hears('🏷️ Caption', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Write 10 short captions (under 100 chars) with 4-5 fitting hashtags for "${msg}".`);
    ctx.reply(`🏷️ *Captions — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Caption error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});

// ---------- Campaign ----------
bot.hears('✉️ Campaign', (ctx) => {
  proGate(ctx, () => ctx.reply('✉️ *Campaign Builder* — choose an action:', { parse_mode: 'Markdown', reply_markup: campaignSubMenu } as any));
});
bot.hears('💡 Ideas', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our business';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Give 7 creative marketing campaign ideas for "${msg}". For each: name, one-line concept, target channel, and expected goal.`);
    ctx.reply(`💡 *Campaign Ideas — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Campaign ideas error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});
bot.hears('📰 Launch', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Create a product launch checklist for "${msg}": pre-launch, launch day, post-launch phases with concrete marketing actions and channels.`);
    ctx.reply(`📰 *Launch Checklist — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Launch error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});

// ---------- Keywords ----------
bot.hears('🔑 Keywords', (ctx) => {
  proGate(ctx, () => ctx.reply('🔑 *Keyword Research* — describe your niche:', { parse_mode: 'Markdown', reply_markup: keywordsSubMenu } as any));
});
bot.hears('🔑 Research', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'digital marketing';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`For the niche "${msg}", list 12 keyword ideas grouped by search intent: informational, commercial, transactional. Suggest a primary and secondary keyword for each group.`);
    ctx.reply(`🔑 *Keyword Research — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Keyword error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});

// ---------- Lead Magnet ----------
bot.hears('🧲 Lead Magnet', (ctx) => {
  proGate(ctx, () => ctx.reply('🧲 *Lead Magnet Generator* — what do you sell?', { parse_mode: 'Markdown', reply_markup: leadMagnetSubMenu } as any));
});
bot.hears('🧲 Generate', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Suggest 5 high-converting lead magnet ideas for "${msg}" (ebook, checklist, template, webinar, tool). For each: format, main promise/benefit, and how to deliver.`);
    ctx.reply(`🧲 *Lead Magnets — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Lead magnet error (${e?.message ?? 'error'})`, { reply_markup: followUpRow(msg) } as any);
  }
});

bot.hears('⚙️ SETTINGS', (ctx) => {
  ctx.reply('⚙️ Settings — nothing to configure yet.', { reply_markup: mainMenu } as any);
});

// ---------- /stage command ----------
bot.command('stage', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const parts = (ctx.message as any).text.split(' ').slice(1).join(' ').trim().toLowerCase();
  const valid = ['new', 'contacted', 'qualified', 'closed'];
  if (!valid.includes(parts)) {
    ctx.reply('Usage: /stage <new|contacted|qualified|closed>', { reply_markup: stageKeyboard } as any);
    return;
  }
  if (id) {
    await updateLeadByTelegramId(id, { stage: parts });
    let autoMsg = '';
    if (parts === 'new') autoMsg = '\n🤖 Automation: Welcome message triggered.';
    else if (parts === 'contacted') autoMsg = '\n🤖 Automation: Contact made — schedule follow-up.';
    else if (parts === 'qualified') autoMsg = '\n🤖 Automation: Lead qualified! Send proposal.';
    else if (parts === 'closed') autoMsg = '\n🤖 Automation: Deal closed — notify team.';
    ctx.reply(`✅ Stage set to *${parts}*${autoMsg}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});

// ---------- Message flow (name capture, stage text fallback, echo) ----------
const buttonTexts = new Set([
  '📊 Stats & Leads', '➕ Add Lead', '💼 Marketing', '⚙️ Tools & Auto',
  '🌐 Language', '⬅️ Back',
  '📊 Stats', '📂 Leads List', '📈 Pipeline',
  '💳 Plan', '📊 Current Plan', '💳 Set Free', '💳 Set Pro', '💳 Set Enterprise',
  '🎭 Persona', '🎭 Tone', '🎭 Audience', '🎭 Style',
  '🔍 Meta', '🔍 Generate Meta',
  '🗺️ Value', '🗺️ Generate Map',
  '✏️ Review', '✏️ Review Content',
  '📈 Growth', '📈 Show Prompts',
  '📂 Swipe', '📂 Show Swipe',
  '⚙️ Workflow', '⚙️ Show Workflow',
  '📝 Content', '📝 Post', '📧 Email', '✍️ Hook', '🏷️ Caption',
  '✉️ Campaign', '💡 Ideas', '📰 Launch',
  '🔑 Keywords', '🔑 Research',
  '🧲 Lead Magnet', '🧲 Generate',
  '📊 STATS', '📂 LEADS LIST', '💳 PLAN', '🎭 PERSONA', '🔍 META', '🗺️ VALUE', '✏️ REVIEW', '📈 GROWTH', '📂 SWIPE', '⚙️ WORKFLOW',
  '➕ ADD LEAD', '⬅️ BACK', '📊 Current Plan', '💳 Set Free', '💳 Set Pro', '💳 Set Enterprise',
  '🎭 Tone', '🎭 Audience', '🎭 Style', '🔍 Generate Meta', '🗺️ Generate Map', '✏️ Review Content', '📈 Show Prompts', '📂 Show Swipe', '⚙️ Show Workflow',
  '🇬🇧 EN', '🇪🇸 ES', '🇫🇷 FR', '🇩🇪 DE', '🇨🇳 ZH', '🏠 Main Menu',
]);

bot.on('text', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const msg = (ctx.message as any).text;

  // Skip AI trigger for known menu/submenu buttons
  if (buttonTexts.has(msg.trim())) return;

  if (id && userState[id]?.type === 'name') {
    userState[id].name = msg;
    userState[id].type = 'stage';
    saveState(userState);
    ctx.reply(`Name saved: ${msg}\nNow choose a stage 👇`, { reply_markup: stageKeyboard } as any);
    return;
  }

  if (id && userState[id]?.type === 'persona_tone') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.tone = msg;
    saveState(userState);
    ctx.reply(`🎭 Tone updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    userState[id].type = 'idle';
    saveState(userState);
    return;
  }
  if (id && userState[id]?.type === 'persona_audience') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.audience = msg;
    saveState(userState);
    ctx.reply(`🎭 Audience updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    userState[id].type = 'idle';
    saveState(userState);
    return;
  }
  if (id && userState[id]?.type === 'persona_style') {
    userState[id].persona = userState[id].persona || {};
    userState[id].persona.style = msg;
    saveState(userState);
    ctx.reply(`🎭 Style updated to *${msg}*`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    userState[id].type = 'idle';
    saveState(userState);
    return;
  }

  if (id && userState[id]?.type === 'stage') {
    const valid = ['new', 'contacted', 'qualified', 'closed'];
    if (valid.includes(msg.toLowerCase())) {
      const lead = await addLead({ telegramId: id, name: userState[id].name, stage: msg.toLowerCase() });
      ctx.reply(`✅ Lead added: *${lead.name ?? 'Unnamed'}* – ${lead.stage}`, {
        parse_mode: 'Markdown',
        reply_markup: mainMenu,
      } as any);
      userState[id] = { type: 'idle' };
      saveState(userState);
    } else {
      ctx.reply('Please pick a stage with the buttons 👆', { reply_markup: stageKeyboard } as any);
    }
    return;
  }

  // default AI reply — always re‑show the keyboard
  try {
    await ctx.telegram.sendChatAction((ctx.from?.id?.toString()) || '', 'typing');
    let aiResponse = await safeGenerateResponse(msg);
    aiResponse = aiResponse || 'No response from AI.';
    if (aiResponse.length > 3600) {
      aiResponse = aiResponse.slice(0, 3600) + '... [truncated]';
    }
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].aiCount = (userState[id].aiCount || 0) + 1;
      saveState(userState);
    }
    ctx.reply(aiResponse, { reply_markup: mainMenu } as any);
  } catch (err: any) {
    console.error('AI reply error:', err);
    ctx.reply(`Sorry, I couldn't process that. (${err?.message ?? 'AI error'})`, { reply_markup: mainMenu } as any);
  }
});

// ---------- Filter by stage (search) ----------
const searchStageActions: Record<string, string> = {
  search_stage_new: 'new',
  search_stage_contacted: 'contacted',
  search_stage_qualified: 'qualified',
  search_stage_closed: 'closed',
};
for (const [action, stage] of Object.entries(searchStageActions)) {
  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery(`Filter: ${stage}`);
    try {
      const allLeads = await getLeads();
      const filtered = allLeads.filter((l: any) => l.stage === stage);
      const listText = filtered.length ? filtered.map((l: any) => `• *${l.name ?? 'Unnamed'}* (${l.stage})`).join('\n') : 'No leads in this stage.';
      await ctx.editMessageText(`📂 *Leads — ${stage.toUpperCase()}* (${filtered.length})\n` + listText, { parse_mode: 'Markdown' });
    } catch (e: any) {
      await ctx.editMessageText(`⚠️ Filter error (${e?.message ?? 'error'})`);
    }
  });
}

// ---------- Inline button callbacks ----------
const stageActions: Record<string, string> = {
  stage_new: 'new',
  stage_contacted: 'contacted',
  stage_qualified: 'qualified',
  stage_closed: 'closed',
};

for (const [action, stage] of Object.entries(stageActions)) {
  bot.action(action, async (ctx) => {
    await ctx.answerCbQuery(`${stage} selected`);
    const id = ctx.from?.id?.toString();
    if (id && userState[id]?.type === 'stage') {
      const lead = await addLead({ telegramId: id, name: userState[id].name, stage });
      let autoMsg = '';
      if (stage === 'new') autoMsg = '🤖 Automation: Welcome message triggered. Follow up within 24h.';
      else if (stage === 'contacted') autoMsg = '🤖 Automation: Contact made — schedule next touch in 3 days.';
      else if (stage === 'qualified') autoMsg = '🤖 Automation: Lead qualified! Send proposal now.';
      else if (stage === 'closed') autoMsg = '🤖 Automation: Deal closed. Update CRM and notify team.';
      await ctx.editMessageText(`✅ Lead *${lead.name ?? 'Unnamed'}* → *${stage}*` + (autoMsg ? `\n${autoMsg}` : ''), { parse_mode: 'Markdown' });
      userState[id] = { type: 'idle' };
      saveState(userState);
      ctx.reply('Done! What next?', { reply_markup: mainMenu } as any);
    } else if (id) {
      await updateLeadByTelegramId(id, { stage });
      await ctx.editMessageText(`Stage set to *${stage}*`, { parse_mode: 'Markdown' });
    }
  });
}

bot.command('plan', (ctx) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const id = ctx.from?.id?.toString();
  if (args[0] === 'set' && args[1]) {
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].plan = args[1].toLowerCase();
      saveState(userState);
      ctx.reply(`💳 Plan updated to *${args[1]}*`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    }
  } else {
    const userPlan = (id && userState[id]?.plan) ? userState[id].plan : 'free';
    ctx.reply(`💳 *Subscription Plan* — Current: *${userPlan.toUpperCase()}*\nUse /plan set <tier> to change (free/pro/enterprise).`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});
bot.command('persona', (ctx) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const id = ctx.from?.id?.toString();
  if (args[0] === 'set' && args[1] && args[2]) {
    if (id) {
      userState[id] = userState[id] || {};
      userState[id].persona = userState[id].persona || {};
      userState[id].persona[args[1]] = args.slice(2).join(' ');
      saveState(userState);
      ctx.reply(`🎭 Persona updated: *${args[1]}* = ${args.slice(2).join(' ')}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    }
  } else {
    const persona = (id && userState[id]?.persona) ? JSON.stringify(userState[id].persona) : '{ tone: "professional", audience: "general", style: "clear" }';
    ctx.reply(`🎭 *Brand Persona* — Settings: ${persona}\nUse /persona set <key> <value>`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});
bot.command('meta', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const topic = msg || 'marketing';
  try {
    const aiMeta = await safeGenerateResponse(`Generate SEO meta title (50-60 chars), meta description (155-160 chars), and URL slug for topic: ${topic}`);
    ctx.reply(`🔍 *SEO Meta for "${topic}"*\n` + aiMeta, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Meta generation failed (${e?.message ?? 'error'})`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});
bot.command('valuemap', (ctx) => {
  ctx.reply('🗺️ *Value Map Generator* — Build structured product value maps for positioning. (osp_marketing_tools-inspired)', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.command('review', async (ctx) => {
  ctx.reply('✏️ *Content Review* — Apply semantic editing codes for structure, flow, and accuracy. (osp_marketing_tools-inspired)', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.command('growth', (ctx) => {
  ctx.reply('📈 *Growth Prompts* — Access battle-tested prompts for ads, SEO, email, CRO, and content. (growthack88-inspired)', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.command('swipe', (ctx) => {
  ctx.reply('📂 *Swipe Files* — Hooks, headlines, and angles ready to copy/paste. (growthack88-inspired)', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.command('workflow', (ctx) => {
  ctx.reply('⚙️ *Automation Workflows* — Trigger actions based on stage changes or reminders. (marketing-dashboard-inspired)', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.command('content', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
  const id = ctx.from?.id?.toString();
  rememberTopic(id, msg);
  try {
    const ai = await safeGenerateResponse(`Write a concise marketing content pack for "${msg}": one social post, one short email subject, and one strong hook.`);
    ctx.reply(`📝 *Content Studio — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Content error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(msg) } as any);
  }
});
bot.command('campaign', async (ctx) => {
  proGate(ctx, async () => {
    const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our business';
    const id = ctx.from?.id?.toString();
    rememberTopic(id, msg);
    try {
      const ai = await safeGenerateResponse(`Give 3 solid marketing campaign ideas for "${msg}", each with channel, format, and goal.`);
      ctx.reply(`✉️ *Campaign Ideas — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Campaign error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(msg) } as any);
    }
  });
});
bot.command('keywords', async (ctx) => {
  proGate(ctx, async () => {
    const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'digital marketing';
    const id = ctx.from?.id?.toString();
    rememberTopic(id, msg);
    try {
      const ai = await safeGenerateResponse(`List 8 keyword ideas for "${msg}" grouped by search intent (informational, commercial, transactional).`);
      ctx.reply(`🔑 *Keywords — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Keyword error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(msg) } as any);
    }
  });
});
bot.command('leadmagnet', async (ctx) => {
  proGate(ctx, async () => {
    const msg = (ctx.message as any).text.split(' ').slice(1).join(' ').trim() || 'our product';
    const id = ctx.from?.id?.toString();
    rememberTopic(id, msg);
    try {
      const ai = await safeGenerateResponse(`Suggest 4 high-converting lead magnet ideas for "${msg}" (ebook, checklist, template, webinar). For each: format and main promise.`);
      ctx.reply(`🧲 *Lead Magnets — ${msg}*\n${ai}`, { parse_mode: 'Markdown', reply_markup: followUpRow(msg) } as any);
    } catch (e: any) {
      ctx.reply(`⚠️ Lead magnet error (${e?.message ?? 'unknown'})`, { reply_markup: followUpRow(msg) } as any);
    }
  });
});

// ---------- /watch (guided like EzyAi) ----------
bot.command('watch', (ctx) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim();
  const parts = msg ? msg.split(' ') : [];
  const pair = (parts[0] || 'BTCUSD').toUpperCase();
  const style = parts[1] || 'scalping';
  const mode = parts[2] || 'safe';
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].watches = userState[id].watches || [];
    userState[id].watches.push({ pair, style, mode });
    saveState(userState);
  }
  ctx.reply(`👁️ Watch started: *${pair}* (${style}/${mode})\nStyle sets timeframe/check freq; mode sets risk per trade, R/R targets, confirmation strictness and daily signal limits.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});
bot.hears('👁️ Watch', (ctx) => {
  ctx.reply('👁️ Watch mode — guided flow:\nUsage: /watch <PAIR> <STYLE> <MODE>\nExample: /watch BTCUSD intraday safe', { reply_markup: mainMenu } as any);
});

// ---------- /fundamentals ----------
bot.command('fundamentals', async (ctx) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  try {
    const aiFund = await safeGenerateResponse(`Provide fundamentals for ${msg}: source links (CoinGecko for crypto, Yahoo Finance chart API for stocks/forex/metals), recent headlines, and a brief summary. Keep it concise.`);
    ctx.reply(`📚 *Fundamentals — ${msg}*\n${aiFund}\n\nSources: CoinGecko / Yahoo Finance`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Fundamentals error (${e?.message ?? 'unknown'})`, { reply_markup: mainMenu } as any);
  }
});

// ---------- /autopilot ----------
bot.command('autopilot', (ctx) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim();
  const parts = msg ? msg.split(' ') : [];
  const style = parts[0] || 'scalping';
  const mode = parts[1] || 'aggressive';
  ctx.reply(`🚀 Autopilot active: *${style} / ${mode}*\nRandom pair selection from universe. Capped by mode daily limit.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- /quote ----------
bot.command('quote', async (ctx) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  try {
    const aiQuote = await safeGenerateResponse(`Provide a quick market quote for ${msg}: current price, trend direction, support/resistance, and a brief outlook.`);
    ctx.reply(`💰 *Quote — ${msg}*\n${aiQuote}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Quote error (${e?.message ?? 'unknown'})`, { reply_markup: mainMenu } as any);
  }
});

// ---------- /watches ----------
bot.command('watches', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const state = loadState();
  const userWatches = (id && state[id]?.watches) ? state[id].watches : [];
  const text = userWatches.length ? userWatches.map((w: any) => `• *${w.pair}* (${w.style}/${w.mode})`).join('\n') : 'No active watches.';
  ctx.reply(`📋 *Active Watches*\n${text}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- /unwatch ----------
bot.command('unwatch', async (ctx) => {
  const msg = (ctx.message as any)?.text?.split(' ').slice(1).join(' ').trim() || 'BTCUSD';
  const id = ctx.from?.id?.toString();
  if (id) {
    const state = loadState();
    if (state[id]?.watches) {
      state[id].watches = (state[id].watches || []).filter((w: any) => w.pair !== msg);
      saveState(state);
    }
  }
  ctx.reply(`🗑️ Unwatched: *${msg}*`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- /plans (EzyAi-style pricing) ----------
bot.command('plans', (ctx) => {
  const id = ctx.from?.id?.toString();
  const label = getPlanLabel(id ? userState[id] : undefined);
  const plansText = PLANS.map(p =>
    `\n*${p.label}* — ${p.price}\n• ${p.features}`
  ).join('\n');
  const inline = {
    inline_keyboard: [
      ...PLANS.filter(p => p.tier !== 'free').map(p => ([{ text: `Choose ${p.label}`, callback_data: `plan_${p.tier}` }])),
      [{ text: '🎁 Claim FREE 3-day trial', callback_data: 'trial_claim' }],
    ],
  };
  ctx.reply(
    `💳 *Plans*\nCurrent: *${label}*${plansText}\n\nUse buttons to switch or claim your free trial.`,
    { parse_mode: 'Markdown', reply_markup: inline } as any
  );
});

// ---------- /redeem CODE ----------
bot.command('redeem', async (ctx) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const code = (args[0] || '').toUpperCase().trim();
  const id = ctx.from?.id?.toString();
  if (!code) {
    ctx.reply('Usage: /redeem CODE', { reply_markup: mainMenu } as any);
    return;
  }
  const state = loadState();
  const codes = state.__codes || {};
  const entry = codes[code];
  if (!entry) {
    ctx.reply(`❌ Code *${code}* not found or already used.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    return;
  }
  const used = entry.usedBy || [];
  if (used.length >= (entry.uses || 1)) {
    ctx.reply(`❌ Code *${code}* has no uses left.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    return;
  }
  if (id) {
    userState[id] = userState[id] || {};
    if (entry.kind === 'trial') {
      const days = entry.days || 3;
      userState[id].trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
      used.push(id);
      state[id] = userState[id];
      state.__codes = codes;
      saveState(state);
      ctx.reply(`🎁 Trial activated: *${days} days of PRO*! Enjoy all premium marketing tools.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    } else if (entry.kind === 'months') {
      userState[id].plan = 'pro';
      const months = entry.months;
      userState[id].proUntil = new Date(Date.now() + months * 30 * 86400000).toISOString();
      used.push(id);
      state[id] = userState[id];
      state.__codes = codes;
      saveState(state);
      ctx.reply(`🎉 Code redeemed: *${months} month(s) of PRO*! Welcome aboard. 🚀`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    } else {
      ctx.reply(`❌ Unknown code type.`, { reply_markup: mainMenu } as any);
    }
  }
});

// ---------- Admin: code minting ----------
bot.command('mkcode', (ctx) => {
  if (!isAdmin(ctx.from?.id?.toString())) {
    ctx.reply('⛔ Admin only.', { reply_markup: mainMenu } as any);
    return;
  }
  const args = (ctx.message as any).text.split(' ').slice(1);
  // e.g. /mkcode trial 7 10  |  /mkcode 1mo 5 [COUNT] [USES]
  const state = loadState();
  const codes = state.__codes || {};
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
    if (!days) {
      ctx.reply('Usage: /mkcode trial <DAYS> [COUNT] [USES]', { reply_markup: mainMenu } as any);
      return;
    }
    for (let i = 0; i < count; i++) make('', { kind: 'trial', days, uses, createdAt: Date.now(), usedBy: [] });
  } else if (args[0] === '1mo' || args[0] === 'months') {
    const months = args[0] === '1mo' ? 1 : parseInt(args[1]) || 1;
    const count = Math.max(1, parseInt(args[1] || args[2]) || 1);
    const uses = Math.max(1, parseInt(args[2] || args[3]) || 1);
    for (let i = 0; i < count; i++) make('', { kind: 'months', months, uses, createdAt: Date.now(), usedBy: [] });
  } else {
    ctx.reply('Usage: /mkcode trial <DAYS> [COUNT] [USES]  OR  /mkcode 1mo [COUNT] [USES]', { reply_markup: mainMenu } as any);
    return;
  }
  state.__codes = codes;
  saveState(state);
  const newCodes = Object.keys(codes).slice(-created);
  ctx.reply(`✅ Created *${created}* code(s):\n${newCodes.join('\n')}\n\nCustomers redeem with /redeem CODE`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

bot.command('codes', (ctx) => {
  if (!isAdmin(ctx.from?.id?.toString())) { ctx.reply('⛔ Admin only.', { reply_markup: mainMenu } as any); return; }
  const state = loadState();
  const codes = state.__codes || {};
  const list = Object.entries(codes).map(([code, e]: any) =>
    `• *${code}* — ${e.kind === 'trial' ? `${e.days}d trial` : `${e.months || 1}mo`} · uses ${(e.usedBy || []).length}/${e.uses || 1}`
  ).join('\n');
  ctx.reply(`🗂️ *Active codes*\n${list || 'None yet. Create with /mkcode'}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

bot.command('revokecode', (ctx) => {
  if (!isAdmin(ctx.from?.id?.toString())) { ctx.reply('⛔ Admin only.', { reply_markup: mainMenu } as any); return; }
  const code = (ctx.message as any).text.split(' ').slice(1).join(' ').toUpperCase().trim();
  const state = loadState();
  const codes = state.__codes || {};
  if (!code || !codes[code]) { ctx.reply('Usage: /revokecode CODE', { reply_markup: mainMenu } as any); return; }
  delete codes[code];
  state.__codes = codes;
  saveState(state);
  ctx.reply(`♻️ Code *${code}* revoked.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

bot.command('settrial', (ctx) => {
  if (!isAdmin(ctx.from?.id?.toString())) { ctx.reply('⛔ Admin only.', { reply_markup: mainMenu } as any); return; }
  const days = parseInt((ctx.message as any).text.split(' ').slice(1)[0]);
  if (days) {
    const state = loadState();
    state.__trialDays = days;
    saveState(state);
    ctx.reply(`🎁 Default trial set to *${days} days*.`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } else {
    const state = loadState();
    const days = state.__trialDays || 3;
    ctx.reply(`🎁 Default trial is currently *${days} days*. Use /settrial <DAYS> (1-30).`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  }
});

// ---------- Plan / trial inline callbacks ----------
bot.action(/^plan_/, async (ctx) => {
  const tier = (ctx as any).match[0].replace('plan_', '');
  const id = ctx.from?.id?.toString();
  await ctx.answerCbQuery(`Plan: ${tier}`);
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].plan = tier;
    saveState(userState);
  }
  await ctx.editMessageText(`💳 Plan set to *${tier.toUpperCase()}*.\n\n${PLANS.find(p => p.tier === tier)?.features || ''}`, { parse_mode: 'Markdown' });
  ctx.reply('Done! What next?', { reply_markup: mainMenu } as any);
});
bot.action('trial_claim', async (ctx) => {
  const id = ctx.from?.id?.toString();
  await ctx.answerCbQuery('Claiming trial...');
  const state = loadState();
  const days = state.__trialDays || 3;
  if (id) {
    userState[id] = userState[id] || {};
    userState[id].trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
    saveState(userState);
  }
  await ctx.editMessageText(`🎁 *Free trial claimed!* You have ${days} days of PRO.\n🧰 Open the Marketing menu to use Content Studio, Campaigns, Keywords, and Lead Magnets.`, { parse_mode: 'Markdown' });
  ctx.reply('Enjoy PRO!', { reply_markup: mainMenu } as any);
});

// ---------- PRO gate for premium features ----------
const proGate = (ctx: any, premiumAction: () => any) => {
  const id = ctx.from?.id?.toString();
  if (!isPayingUser(id)) {
    ctx.reply('🔒 *This is a PRO feature.*\n\nUpgrade with /plans or claim your free trial to unlock Content Studio, Campaigns, Keywords, Lead Magnets & more.', { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
    return;
  }
  return premiumAction();
};

// ---------- /help ----------
bot.command('help', (ctx) => {
  const helpText =
    `*🧰 TG Ezy AI OS — Marketing Command Center*` +
    `\n\n*Core:* /start · /help · /plans · /dashboard` +
    `\n*Leads:* /addlead · /stage · /stats · /leads · /deletelead` +
    `\n*Marketing:* /plan · /persona · /meta · /valuemap · /review · /growth · /swipe` +
    `\n*Content Studio:* /content · /campaign · /keywords · /leadmagnet` +
    `\n*Automation:* /workflow · /remind` +
    `\n*Trading (EzyAi-style):* /quote · /fundamentals · /watch · /watches · /unwatch · /autopilot` +
    `\n*Billing:* /plans · /redeem CODE` +
    `\n\n⏰ Reminder: /remind <minutes> <message>`;
  ctx.reply(helpText, { parse_mode: 'Markdown' } as any);
});

// ---------- /dashboard ----------
bot.command('dashboard', (ctx) => {
  const port = process.env.PORT || 3000;
  ctx.reply(`📊 *Marketing Dashboard*\n\nOpen: http://localhost:${port}/dashboard\n(Expose the app publicly to access it from anywhere.)`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
});

// ---------- Reminders ----------
const reminders: { chatId: string; message: string; timeout: NodeJS.Timeout }[] = [];

bot.command('remind', (ctx) => {
  const args = (ctx.message as any).text.split(' ').slice(1);
  const minutes = parseInt(args[0]);
  const msg = args.slice(1).join(' ');
  if (!minutes || isNaN(minutes) || !msg) {
    ctx.reply('Usage: /remind <minutes> <message>', { reply_markup: mainMenu } as any);
    return;
  }
  const chatId = ctx.chat?.id?.toString() || '';
  const timeout = setTimeout(() => {
    ctx.reply(`⏰ Reminder: ${msg}`, { reply_markup: mainMenu } as any);
  }, minutes * 60000);
  reminders.push({ chatId, message: msg, timeout });
  ctx.reply(`⏰ Reminder set for ${minutes} minute(s): "${msg}"`, { reply_markup: mainMenu } as any);
});

// ---------- Launch ----------
bot.launch().then(async () => {
  try {
    await bot.telegram.setMyCommands(botCommands as any);
  } catch (e) {
    console.warn('Could not set commands menu', e);
  }
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));