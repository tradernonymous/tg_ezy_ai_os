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

// ---------- Raw markup objects (guaranteed to render in Telegram clients) ----------
const mainMenu = {
  keyboard: [
    [{ text: '📊 STATS' }, { text: '👤 PROFILE' }],
    [{ text: '➕ ADD LEAD' }, { text: '📂 LEADS LIST' }],
    [{ text: '💳 PLAN' }, { text: '🎭 PERSONA' }],
    [{ text: '🔍 META' }, { text: '🗺️ VALUE' }],
    [{ text: '✏️ REVIEW' }, { text: '📈 GROWTH' }],
    [{ text: '📂 SWIPE' }, { text: '⚙️ WORKFLOW' }],
    [{ text: '⚙️ SETTINGS' }, { text: '⬅️ BACK' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const planSubMenu = {
  keyboard: [
    [{ text: '📊 Current Plan' }, { text: '💳 Set Free' }],
    [{ text: '💳 Set Pro' }, { text: '💳 Set Enterprise' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const personaSubMenu = {
  keyboard: [
    [{ text: '🎭 Tone' }, { text: '🎭 Audience' }],
    [{ text: '🎭 Style' }, { text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const metaSubMenu = {
  keyboard: [
    [{ text: '🔍 Generate Meta' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const valueSubMenu = {
  keyboard: [
    [{ text: '🗺️ Generate Map' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const reviewSubMenu = {
  keyboard: [
    [{ text: '✏️ Review Content' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const growthSubMenu = {
  keyboard: [
    [{ text: '📈 Show Prompts' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const swipeSubMenu = {
  keyboard: [
    [{ text: '📂 Show Swipe' }],
    [{ text: '⬅️ Back' }],
  ],
  resize_keyboard: true,
};
const workflowSubMenu = {
  keyboard: [
    [{ text: '⚙️ Show Workflow' }],
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
  { command: 'workflow', description: '⚙️ Automation' },
  { command: 'ping', description: '🏓 Ping the bot' },
];

// ---------- Navigation ----------
bot.command('back', (ctx) => {
  const id = ctx.from?.id?.toString();
  if (id) {
    userState[id] = { type: 'idle' };
    saveState(userState);
  }
  ctx.reply('⬅️ Back to main menu:', { reply_markup: mainMenu } as any);
});
bot.hears('⬅️ BACK', (ctx) => {
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
  const welcomeMsg = `👋 Welcome to *TG Ezy AI OS* — your AI-powered marketing command center!\n\n✨ *Quick links:* /stats · /leads · /plan · /persona · /meta · /valuemap\n⚡ Commands available below 👇`;
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

bot.hears('📊 STATS', async (ctx) => {
  try {
    const leads = await getLeads();
    const total = leads.length;
    const byStage = leads.reduce((acc: any, cur: any) => {
      acc[cur.stage || 'unknown'] = (acc[cur.stage || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byStage).map(([k, v]) => `${k}: ${v}`).join(', ');
    ctx.reply(`📊 *Stats*\nTotal leads: *${total}*\nBreakdown: ${breakdown || 'none'}`, { parse_mode: 'Markdown', reply_markup: mainMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Stats error (${e?.message ?? 'error'})`, { reply_markup: mainMenu } as any);
  }
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
  try {
    const aiMeta = await safeGenerateResponse(`Generate SEO meta title (50-60 chars), meta description (155-160 chars), and URL slug for topic: ${topic}`);
    ctx.reply(`🔍 *SEO Meta for "${topic}"*\n` + aiMeta, { parse_mode: 'Markdown', reply_markup: metaSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Meta generation failed (${e?.message ?? 'error'})`, { reply_markup: metaSubMenu } as any);
  }
});
bot.hears('🗺️ VALUE', (ctx) => {
  ctx.reply('🗺️ Choose value action:', { reply_markup: valueSubMenu } as any);
});
bot.hears('🗺️ Generate Map', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const product = msg || 'our product';
  try {
    const aiVal = await safeGenerateResponse(`Generate an OSP-style product value map for product: ${product}. Include tagline, value statements, persona needs, and feature categories.`);
    ctx.reply(`🗺️ *Value Map for "${product}"*\n` + aiVal, { parse_mode: 'Markdown', reply_markup: valueSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Value map error (${e?.message ?? 'error'})`, { reply_markup: valueSubMenu } as any);
  }
});
bot.hears('✏️ REVIEW', (ctx) => {
  ctx.reply('✏️ Choose review action:', { reply_markup: reviewSubMenu } as any);
});
bot.hears('✏️ Review Content', async (ctx) => {
  const msg = (ctx.message as any).text.split(' ').slice(1).join(' ');
  const content = msg || 'Sample content.';
  try {
    const aiReview = await safeGenerateResponse(`Review this content using OSP editing codes (scope, flow, style, word choice, grammar, technical accuracy). Provide constructive feedback with before/after examples. Content: ${content}`);
    ctx.reply(`✏️ *Content Review*\n` + aiReview, { parse_mode: 'Markdown', reply_markup: reviewSubMenu } as any);
  } catch (e: any) {
    ctx.reply(`⚠️ Review error (${e?.message ?? 'error'})`, { reply_markup: reviewSubMenu } as any);
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
bot.on('text', async (ctx) => {
  const id = ctx.from?.id?.toString();
  const msg = (ctx.message as any).text;

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