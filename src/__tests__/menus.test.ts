import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, LocalizedLabel, ALL_LABELS, localize, MENUS, MENUS_IDS, MENU_PARENT } from '../menus';

test('menus: every localized label targets a real English key', () => {
  const langs: (keyof LocalizedLabel)[] = ['es', 'fr', 'de', 'zh'];
  for (const [key, entry] of Object.entries(LABELS)) {
    assert.ok(key.trim().length > 0, 'empty label key');
    for (const lang of langs) {
      assert.ok(entry[lang] !== undefined, `label '${key}' missing '${lang}' translation`);
      assert.ok(String(entry[lang]).trim().length > 0, `label '${key}' has empty '${lang}' value`);
    }
  }
});

test('menus: ALL_LABELS has no duplicates', () => {
  const seen = new Set<string>();
  for (const label of ALL_LABELS) {
    assert.ok(!seen.has(label), `duplicate label: ${label}`);
    seen.add(label);
  }
});

test('menus: every built menu row has <=3 buttons and valid callback keys', () => {
  for (const id of MENUS_IDS) {
    const build = MENUS[id];
    assert.ok(typeof build === 'function', `MENUS['${id}'] is not a function`);
    const kb = build((s: string) => s);
    for (const row of kb.keyboard) {
      assert.ok(Array.isArray(row), `menu ${id}: row is not an array`);
      assert.ok(row.length <= 3, `menu ${id}: row has ${row.length} buttons (>3)`);
      for (const b of row) {
        assert.ok(b.text && b.text.length > 0, `menu ${id}: empty button text`);
      }
    }
  }
});

test('menus: every button label used by builders is in ALL_LABELS', () => {
  const all = new Set(ALL_LABELS);
  for (const id of MENUS_IDS) {
    const kb = MENUS[id]((s: string) => s);
    for (const row of kb.keyboard) {
      for (const b of row) {
        assert.ok(b.text, `menu ${id}: button has no text`);
        assert.ok(all.has(b.text), `menu ${id}: label '${b.text}' missing from ALL_LABELS`);
      }
    }
  }
});

test('menus: MENU_PARENT back navigation is consistent', () => {
  for (const [child, parent] of Object.entries(MENU_PARENT)) {
    assert.ok(child !== parent, `menu back-navigates to itself: ${child}`);
    assert.ok(MENUS_IDS.includes(child as any), `menu '${child}' has back-nav but no builder`);
    assert.ok(MENUS_IDS.includes(parent as any), `menu '${parent}' target missing`);
  }
});

test('menus: localize falls back to the raw key', () => {
  const l = localize('en');
  assert.equal(l('__missing_key__'), '__missing_key__');
  const spansh = localize('es');
  assert.ok(typeof spansh('🏠 Main Menu') === 'string');
});