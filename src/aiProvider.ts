import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const API_KEY = process.env.MISTRAL_API_KEY;
const MODEL = process.env.AI_MODEL || 'mistral-tiny'; // free tier compatible

async function rawFetch(prompt: string, signal: AbortSignal): Promise<string> {
  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: process.env.AI_TEMPERATURE ? Number(process.env.AI_TEMPERATURE) : 0.7,
    max_tokens: process.env.AI_MAX_TOKENS ? Number(process.env.AI_MAX_TOKENS) : 1024,
  };

  const res = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    const e = new Error(`Mistral API error: ${res.status} ${err.slice(0, 300)}`) as any;
    e.status = res.status;
    throw e;
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

export async function generateResponse(prompt: string): Promise<string> {
  if (!API_KEY) {
    throw new Error('MISTRAL_API_KEY not set in environment');
  }

  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 25000);
  const maxRetries = Number(process.env.AI_RETRIES || 2);

  let lastErr: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await rawFetch(prompt, controller.signal);
    } catch (err: any) {
      lastErr = err;
      const retriable = err?.status === 429 || err?.status === 500 || err?.status === 502 || err?.status === 503 || err?.name === 'AbortError';
      if (!retriable || attempt === maxRetries) {
        if (err?.name === 'AbortError') {
          throw new Error('AI request timed out');
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('AI request failed');
}