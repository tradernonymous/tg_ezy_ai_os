console.log('Bot init, env token length:', (process.env.BOT_TOKEN || '').length);

import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';
import { generateResponse } from './aiProvider';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.start((ctx) => ctx.reply('Welcome! I\'m the TG Ezy AI OS bot.'));

bot.command('ping', (ctx) => ctx.reply('pong'));

bot.on('text', async (ctx) => {
  const userMessage = ctx.message.text;
  try {
    const reply = await generateResponse(userMessage);
    await ctx.reply(reply || `You said: ${userMessage}`);
  } catch (err) {
    console.error('AI error', err);
    await ctx.reply('Sorry, I couldn\'t process that right now.');
  }
});

bot.launch().then(() => console.log('Bot started'));
