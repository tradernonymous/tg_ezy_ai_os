import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import fetch from 'node-fetch';
import type { Account } from './accountStore';
import { getAccount, getAccountByProviderKey, createAccount, updateAccount } from './accountStore';
import { isTier, PlanTier, PLANS } from './plans';
import { dataDir } from './stateStore';

// ---------- Live billing (Stripe Checkout + USDT swap) ----------
// STRIPE_SECRET_KEY  → hosted Stripe checkout (one-time monthly payment; a
//   successful session grants 30 days via /api/billing/confirm or the webhook).
//   To move to true recurring subscriptions, switch mode to 'subscription' with
//   price_data.recurring and add STRIPE_WEBHOOK_SECRET handling for invoice.paid.
// USDT_ADDRESS       → manual swap; payments are recorded via /api/billing/usdt/pending
//   and can be activated by the Telegram admin with /confirmpay <tgUid> <tier>.

export type CheckoutResult =
  | { status: 'ok'; url: string; sessionId: string }
  | { status: 'usdt-manual'; usdtAddress: string; tier: PlanTier; amount: string }
  | { status: 'pending-config' }
  | { status: 'error'; error: string };

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function usdtConfigured(): boolean {
  return !!process.env.USDT_ADDRESS;
}

export function priceCents(tier: string): number {
  const p = PLANS.find((x) => x.tier === tier);
  const m = /^\$(\d+)/.exec(p?.price || '');
  return m ? Number(m[1]) * 100 : 0;
}

export function priceLabel(tier: string): string {
  return PLANS.find((x) => x.tier === tier)?.price || '';
}

function baseUrl(): string {
  return (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function strippe(pathname: string, init: Record<string, any> = {}): Promise<any> {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk) return Promise.reject(new Error('stripe-not-configured'));
  const base = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
  return fetch(`${base}/v1${pathname}`, {
    method: init.method || 'GET',
    headers: {
      Authorization: `Bearer ${sk}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init.headers || {}),
    },
    body: init.body || undefined,
  }).then(async (r) => {
    const text = await r.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      data = { raw: text.slice(0, 500) };
    }
    if (!r.ok) throw new Error(data?.error?.message || `Stripe ${r.status}: ${text.slice(0, 300)}`);
    return data;
  });
}

export async function createCheckout(account: Account, tier: string, provider: string): Promise<CheckoutResult> {
  const normalized: PlanTier = isTier(tier) ? (tier as PlanTier) : 'free';
  if (!PLANS.some((p) => p.tier === normalized && normalized !== 'free')) {
    return { status: 'error', error: 'Unknown tier' };
  }

  if (provider === 'usdt') {
    if (!usdtConfigured()) return { status: 'pending-config' };
    return { status: 'usdt-manual', usdtAddress: process.env.USDT_ADDRESS!, tier: normalized, amount: priceLabel(normalized) };
  }

  if (!stripeConfigured()) return { status: 'pending-config' };
  try {
    const cents = priceCents(normalized);
    const body = new URLSearchParams();
    body.set('mode', 'payment');
    body.set('client_reference_id', account.id);
    body.set('metadata[tier]', normalized);
    body.set('line_items[0][price_data][currency]', 'usd');
    body.set('line_items[0][price_data][unit_amount]', String(cents));
    body.set('line_items[0][price_data][product_data][name]', `EzyViral OS — ${PLANS.find((p) => p.tier === normalized)?.label} (1 month)`);
    body.set('line_items[0][quantity]', '1');
    body.set('success_url', `${baseUrl()}/dashboard?billing=success&session_id={CHECKOUT_SESSION_ID}`);
    body.set('cancel_url', `${baseUrl()}/dashboard?billing=cancel`);
    if (account.email) body.set('customer_email', account.email);
    if (process.env.STRIPE_TAX_RATE_ID) body.set('line_items[0][tax_rates][0]', process.env.STRIPE_TAX_RATE_ID);

    const session = await strippe('/checkout/sessions', { method: 'POST', body });
    if (!session?.url) return { status: 'error', error: 'Stripe did not return a checkout URL' };
    return { status: 'ok', url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[billing] Stripe checkout failed:', (err as Error)?.message ?? err);
    return { status: 'pending-config' };
  }
}

export async function createCheckoutForChatId(chatId: string, name: string | undefined, tier: string, provider: string): Promise<CheckoutResult> {
  let account = getAccountByProviderKey('telegram', chatId);
  if (!account) {
    account = await createAccount({ provider: 'telegram', providerKey: chatId, name: name?.slice(0, 120) });
  }
  return createCheckout(account, tier, provider);
}

function planEnd(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}

export function activateAccount(accountId: string, tier: string, days = 30): Account | null {
  if (!isTier(tier) || tier === 'free') return null;
  const account = getAccount(accountId);
  if (!account) return null;
  const existing = account.planUntil ? new Date(account.planUntil).getTime() : 0;
  const next = existing > Date.now() ? new Date(existing + days * 86400000).toISOString() : planEnd(days);
  return updateAccount(accountId, { plan: tier as PlanTier, planUntil: next });
}

export async function confirmSession(account: Account, sessionId: string): Promise<Account | { error: string }> {
  if (!stripeConfigured()) return { error: 'Stripe is not configured.' };
  try {
    const s = await strippe(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
    if (s?.payment_status !== 'paid') return { error: 'Payment not completed.' };
    if (s?.client_reference_id !== account.id) return { error: 'Checkout session does not match this account.' };
    const tier = String(s?.metadata?.tier || '');
    if (!isTier(tier) || tier === 'free') return { error: 'Checkout session has an unknown tier.' };
    const next = activateAccount(account.id, tier);
    return next || { error: 'Account not found.' };
  } catch (err) {
    console.error('[billing] confirm failed:', (err as Error)?.message ?? err);
    return { error: 'Could not verify that payment.' };
  }
}

export async function handleStripeWebhook(event: any): Promise<Account | null> {
  const type = event?.type as string;
  if (type === 'checkout.session.completed') return handleWebhookSession(event?.data?.object);
  return null;
}

export async function handleWebhookSession(s: any): Promise<Account | null> {
  if (!s || s?.payment_status !== 'paid') return null;
  const accountId = String(s?.client_reference_id || '');
  const tier = String(s?.metadata?.tier || '');
  if (!accountId || !isTier(tier) || tier === 'free') return null;
  return activateAccount(accountId, tier);
}

export function verifyStripeSignature(payload: string, sigHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true; // no webhook secret configured → rely on Stripe session retrieval for validation
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const eq = p.trim().indexOf('=');
      return [p.trim().slice(0, eq), p.trim().slice(eq + 1)];
    })
  );
  const ts = Number(parts['t']);
  const signature = parts['v1'];
  if (!ts || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- USDT manual-swap ledger ----------

interface PendingPayment {
  accountId: string;
  tier: PlanTier;
  txid?: string;
  createdAt: string;
  status: 'pending';
}

function paymentsPath(): string {
  return path.join(dataDir(), 'payments.json');
}

function readPayments(): PendingPayment[] {
  try {
    const raw = fs.readFileSync(paymentsPath(), 'utf-8').trim();
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function recordUsdtPending(accountId: string, tier: string, txid?: string): PendingPayment | null {
  if (!usdtConfigured() || !isTier(tier) || tier === 'free') return null;
  const entry: PendingPayment = {
    accountId,
    tier: tier as PlanTier,
    txid: txid?.trim() ? String(txid).slice(0, 200) : undefined,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  const all = readPayments();
  all.push(entry);
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = paymentsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf-8');
  fs.renameSync(tmp, paymentsPath());
  return entry;
}

export function listPendingUsdt(accountId?: string): PendingPayment[] {
  return readPayments().filter((p) => p.status === 'pending' && (!accountId || p.accountId === accountId));
}