import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS,
  getChannel,
  isChannelId,
  missingEnv,
  isConfigured,
  supportOf,
  channelStatus,
  channelSummary,
} from '../channels';

// Every case passes an explicit env object, so these never depend on the
// machine's real environment.
const EMPTY = {} as NodeJS.ProcessEnv;

test('channels: every definition has an id, label, glyph and docs link', () => {
  for (const c of CHANNELS) {
    assert.ok(c.id, 'id');
    assert.ok(c.label, `label for ${c.id}`);
    assert.ok(c.glyph, `glyph for ${c.id}`);
    assert.match(c.docsUrl, /^https:\/\//, `docsUrl for ${c.id}`);
  }
});

test('channels: ids are unique', () => {
  const ids = CHANNELS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('channels: lookup by id', () => {
  assert.equal(getChannel('whatsapp')?.label, 'WhatsApp');
  assert.equal(getChannel('nope'), undefined);
  assert.equal(isChannelId('instagram'), true);
  assert.equal(isChannelId('myspace'), false);
});

test('channels: nothing is configured with an empty environment', () => {
  for (const c of CHANNELS) {
    assert.equal(isConfigured(c, EMPTY), false, `${c.id} must not be configured`);
  }
});

test('channels: telegram becomes ready once BOT_TOKEN is set', () => {
  const tg = getChannel('telegram')!;
  assert.deepEqual(missingEnv(tg, EMPTY), ['BOT_TOKEN']);
  assert.equal(supportOf(tg, EMPTY), 'needs-credentials');

  const env = { BOT_TOKEN: 'abc123' } as NodeJS.ProcessEnv;
  assert.deepEqual(missingEnv(tg, env), []);
  assert.equal(isConfigured(tg, env), true);
  assert.equal(supportOf(tg, env), 'ready');
});

test('channels: whitespace-only values do not count as configured', () => {
  const tg = getChannel('telegram')!;
  assert.equal(isConfigured(tg, { BOT_TOKEN: '   ' } as NodeJS.ProcessEnv), false);
});

test('channels: every Meta-family channel requires webhook signature verification', () => {
  for (const id of ['whatsapp', 'messenger', 'instagram'] as const) {
    const c = getChannel(id)!;
    assert.ok(
      c.requiredEnv.includes('META_APP_SECRET'),
      `${id} must require META_APP_SECRET so X-Hub-Signature-256 can be verified`,
    );
    assert.ok(c.requiredEnv.includes('WEBHOOK_VERIFY_TOKEN'), `${id} must require WEBHOOK_VERIFY_TOKEN`);
  }
});

test('channels: whatsapp env names match the wsapi-dashboard repo', () => {
  const wa = getChannel('whatsapp')!;
  assert.ok(wa.requiredEnv.includes('WHATSAPP_PHONE_NUMBER_ID'));
  assert.ok(wa.requiredEnv.includes('WHATSAPP_ACCESS_TOKEN'));
  assert.ok(wa.optionalEnv.includes('WHATSAPP_WABA_ID'));
  assert.ok(wa.optionalEnv.includes('WHATSAPP_APP_ID'));
});

test('channels: whatsapp needs every credential, not just some', () => {
  const wa = getChannel('whatsapp')!;
  const partial = {
    WHATSAPP_PHONE_NUMBER_ID: '1',
    WHATSAPP_ACCESS_TOKEN: '2',
  } as NodeJS.ProcessEnv;
  assert.equal(isConfigured(wa, partial), false, 'must not be ready without the webhook secrets');
  assert.deepEqual(missingEnv(wa, partial).sort(), ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN']);

  const full = {
    ...partial,
    META_APP_SECRET: '3',
    WEBHOOK_VERIFY_TOKEN: '4',
  } as NodeJS.ProcessEnv;
  assert.equal(isConfigured(wa, full), true);
});

test('channels: tiktok is unsupported and can never become ready', () => {
  const tk = getChannel('tiktok')!;
  assert.equal(tk.unsupported, true);
  assert.equal(tk.capabilities.inbound, false);
  assert.equal(tk.capabilities.outbound, false);
  assert.equal(supportOf(tk, { ANYTHING: 'x' } as NodeJS.ProcessEnv), 'unsupported');
});

test('channels: threads is comments, not DMs', () => {
  const th = getChannel('threads')!;
  assert.equal(th.capabilities.kind, 'comments');
  assert.match(String(th.note), /no direct-message API/i);
});

test('channels: legacy meta id still resolves but is hidden from status', () => {
  assert.equal(getChannel('meta')?.deprecated, true);
  assert.equal(
    channelStatus(EMPTY).some((c) => c.id === 'meta'),
    false,
    'deprecated channels stay resolvable for old data but are not offered',
  );
});

test('channels: status never leaks credential values', () => {
  const env = { BOT_TOKEN: 'super-secret-value' } as NodeJS.ProcessEnv;
  const json = JSON.stringify(channelStatus(env));
  assert.equal(json.includes('super-secret-value'), false, 'status must expose names only');
  assert.ok(json.includes('WHATSAPP_ACCESS_TOKEN'), 'missing var NAMES are expected');
});

test('channels: summary counts add up to the visible channel list', () => {
  const s = channelSummary(EMPTY);
  assert.equal(s.ready + s.needsCredentials + s.unsupported, channelStatus(EMPTY).length);
  assert.equal(s.ready, 0, 'nothing is ready with an empty environment');
  assert.equal(s.unsupported, 1, 'tiktok');
});
