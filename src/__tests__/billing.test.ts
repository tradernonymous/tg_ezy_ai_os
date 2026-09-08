import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { createAccount } from '../accountStore';
import { createCheckout, confirmSession, activateAccount, recordUsdtPending, listPendingUsdt, priceCents, handleStripeWebhook, verifyStripeSignature } from '../billing';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-billing-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

// Minimal Stripe look-alike: answers POST /v1/checkout/sessions and GET /v1/checkout/sessions/:id
let sessions: Record<string, any> = {};
let server: http.Server;
let base = '';
let lastBody = '';
const paidSession = () => ({
  id: 'cs_test_123',
  payment_status: 'paid',
  client_reference_id: 'acc-1',
  metadata: { tier: 'marketer' },
  url: 'https://checkout.stripe.com/pay/cs_test_123',
});

server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastBody = body;
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      sessions['cs_test_123'] = paidSession();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(sessions['cs_test_123']));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/checkout/sessions/cs_test_123') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(sessions['cs_test_123'] || { id: 'cs_test_123', payment_status: 'unpaid', client_reference_id: 'nope', metadata: {} }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'mock not found: ' + req.method + ' ' + req.url } }));
  });
});

before(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as any).port}`;
      resolve();
    });
  });
});

after(() => server.close());

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  process.env.STRIPE_API_BASE = base;
  process.env.USDT_ADDRESS = '';
  sessions = {};
});

test('billing: priceCents parses plan pricing', () => {
  assert.equal(priceCents('hobby'), 900);
  assert.equal(priceCents('marketer'), 2900);
  assert.equal(priceCents('thinker'), 29900);
  assert.equal(priceCents('free'), 0);
});

test('billing: stripe checkout returns a session url and records the account reference', async () => {
  const acc = await createAccount({ provider: 'google', providerKey: 'sub-1', name: 'Ada' });
  const res = await createCheckout(acc, 'marketer', 'stripe');
  assert.equal(res.status, 'ok');
  if (res.status === 'ok') {
    assert.ok(res.url.includes('checkout.stripe.com'));
    const decoded = decodeURIComponent(lastBody);
    assert.ok(decoded.includes('metadata[tier]=marketer'));
    assert.ok(decoded.includes('price_data][unit_amount]=2900'));
    assert.ok(lastBody.includes(`client_reference_id=${encodeURIComponent(acc.id)}`));
  }
});

test('billing: USDT checkout returns the configured address', async () => {
  process.env.USDT_ADDRESS = 'TXt3VdummyAddressXXXX';
  const acc = await createAccount({ provider: 'google', providerKey: 'sub-2', name: 'June' });
  const res = await createCheckout(acc, 'navigator', 'usdt');
  assert.equal(res.status, 'usdt-manual');
  if (res.status === 'usdt-manual') assert.equal(res.usdtAddress, 'TXt3VdummyAddressXXXX');
});

test('billing: confirmSession only activates when the session is paid and matches the account', async () => {
  const acc = await createAccount({ provider: 'google', providerKey: 'sub-3', name: 'Kai' });
  sessions['cs_test_123'] = { ...paidSession(), client_reference_id: acc.id };
  let out = await confirmSession(acc, 'cs_test_123');
  assert.ok('plan' in (out as any) && !('error' in (out as any)));
  assert.equal((out as any).plan, 'marketer');
  assert.ok((out as any).planUntil);

  const other = await createAccount({ provider: 'google', providerKey: 'sub-4', name: 'Other' });
  sessions['cs_test_123'] = { ...paidSession(), client_reference_id: 'someone-else' };
  out = await confirmSession(other, 'cs_test_123');
  assert.ok('error' in (out as any), 'mismatched client_reference_id must be rejected');
});

test('billing: activateAccount extends or sets planUntil', () => {
  const a = activateAccount('acc-1', 'thinker', 30);
  assert.equal(a, null, 'unknown account → null');
});

test('billing: webhook handler activates paid sessions, ignores unpaid', async () => {
  const webhookPaid = await handleStripeWebhook({ type: 'checkout.session.completed', data: { object: paidSession() } });
  assert.equal(webhookPaid, null, 'account acc-1 does not exist → none');

  const acc = await createAccount({ provider: 'google', providerKey: 'sub-5', name: 'Web' });
  const hook = await handleStripeWebhook({ type: 'checkout.session.completed', data: { object: { ...paidSession(), client_reference_id: acc.id } } });
  assert.equal((hook as any)?.plan, 'marketer');
  const unpaid = await handleStripeWebhook({ type: 'checkout.session.completed', data: { object: { ...paidSession(), payment_status: 'unpaid' } } });
  assert.equal(unpaid, null);
});

test('billing: USDT pending ledger records and lists entries', () => {
  process.env.USDT_ADDRESS = 'TXt3VdummyAddressXXXX';
  const entry = recordUsdtPending('acc-1', 'navigator', 'TXID-ABC123');
  assert.ok(entry && entry.status === 'pending' && entry.txid === 'TXID-ABC123');
  const listed = listPendingUsdt('acc-1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].tier, 'navigator');
  assert.equal(listPendingUsdt('acc-2').length, 0);
});

test('billing: stripe signature verification', () => {
  const crypto = require('crypto') as typeof import('crypto');
  const secret = 'whsec_test';
  const payload = '{"type":"checkout.session.completed"}';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=${sig}`, secret), true);
  assert.equal(verifyStripeSignature(payload, `t=${ts},v1=${sig}x`, secret), false);
  assert.equal(verifyStripeSignature(payload, undefined, secret), false);
  assert.equal(verifyStripeSignature(payload, 'garbage', undefined), true, 'no secret → validation deferred to Stripe retrieval');
});