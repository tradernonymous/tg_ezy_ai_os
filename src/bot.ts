import { Telegraf } from 'telegraf';
import * as dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN || '');

bot.start((ctx) => ctx.reply('Welcome! I\'m the TG Ezy AI OS bot.'));

bot.command('ping', (ctx) => ctx.reply('pong'));

bot.on('text', async (ctx) => {
  // Placeholder: forward message to OpenAI for processing
  const reply = `You said: ${ctx.message.text}`;
  await ctx.reply(reply);
});

bot.launch().then(() => console.log('Bot started'));
