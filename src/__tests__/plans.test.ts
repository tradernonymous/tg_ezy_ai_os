import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, PLANS, mapLegacy, tierIndex, tierAtLeast, isTier } from '../plans';

test('plans: five tiers in canonical order', () => {
  assert.deepEqual([...TIERS], ['free', 'hobby', 'marketer', 'navigator', 'thinker']);
  assert.equal(PLANS.length, 5);
  assert.equal(PLANS[0].tier, 'free');
  assert.equal(PLANS[4].tier, 'thinker');
});

test('plans: legacy schemes map onto the 5-tier lineup', () => {
  assert.equal(mapLegacy('pro'), 'navigator');
  assert.equal(mapLegacy('enterprise'), 'thinker');
  assert.equal(mapLegacy('PRO-TRIAL'), 'navigator');
  assert.equal(mapLegacy(undefined), 'free');
  assert.equal(mapLegacy('thinker'), 'thinker');
});

test('plans: tierIndex + tierAtLeast', () => {
  assert.equal(tierIndex('marketer'), 2);
  assert.equal(tierIndex('bogus'), 0);
  assert.equal(tierIndex(undefined), 0);
  assert.equal(tierAtLeast('navigator', 'marketer'), true);
  assert.equal(tierAtLeast('hobby', 'marketer'), false);
  assert.equal(tierAtLeast('THINKER', 'navigator'), true);
  assert.ok(isTier('thinker'));
  assert.ok(!isTier('pro'));
});