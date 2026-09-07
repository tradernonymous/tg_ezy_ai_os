import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const API_KEY = process.env.MISTRAL_API_KEY;

export async function generateResponse(prompt: string): Promise<string> {
  if (!API_KEY) {
    throw new Error('MISTRAL_API_KEY not set in environment');
  }

  const body = {
    model: 'mistral-large-2407', // adjust to the free tier model if needed (e.g., 'mistral-tiny')
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  };

  const res = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mistral API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  // Mistral returns { choices: [{ message: { content: '...' } }] }
  const reply = data?.choices?.[0]?.message?.content;
  return reply ?? '';
}
