// Source register v1: schema, right rules and the M0 coverage gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRegister, coverage } from '../src/sources/register.mjs';

const REAL = JSON.parse(readFileSync(new URL('../config/sources.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(REAL);
const find = (r, id) => r.sources.find(s => s.id === id);
const rejects = (name, mutate, code) => test(name, () => {
  const r = clone(); mutate(r);
  const v = validateRegister(r);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => e.startsWith(code)), `expected ${code}, got ${v.errors.join(' ')}`);
});

test('S0 the committed register is valid', () => assert.deepEqual(validateRegister(REAL).errors, []));

rejects('S1 a confirmed right needs a legal basis', r => { find(r, 'the-guardian').rights.headline = { status: 'confirmed', basis: 'none', clause: 'x' }; }, 'confirmed-without-basis');
rejects('S2 a confirmed excerpt needs a length limit', r => { delete find(r, 'global-voices').rights.excerpt.maxChars; }, 'excerpt-without-limit');
rejects('S3 no right can be confirmed without the fetch right', r => { find(r, 'global-voices').rights.fetch = { status: 'pending', basis: 'none', clause: 'x' }; }, 'right-without-fetch');
rejects('S4 written-permission basis needs a granted permission', r => { find(r, 'the-guardian').rights.fetch = { status: 'confirmed', basis: 'written-permission', clause: 'x' }; find(r, 'the-guardian').rights.headline = { status: 'confirmed', basis: 'written-permission', clause: 'x' }; find(r, 'the-guardian').termsUrl = 'https://example.com/t'; find(r, 'the-guardian').feeds = [{ url: 'https://example.com/f', verified: false }]; }, 'written-permission-not-granted');
rejects('S5 duplicate source ids', r => { r.sources.push(structuredClone(r.sources[0])); }, 'duplicate-id');
rejects('S6 unknown fields are rejected', r => { r.sources[0].notes = 'x'; }, 'unexpected-field');
rejects('S7 a confirmed headline needs a terms URL', r => { find(r, 'global-voices').termsUrl = null; }, 'confirmed-without-terms-url');
rejects('S8 an excerpt needs the headline right', r => { find(r, 'global-voices').rights.headline = { status: 'pending', basis: 'none', clause: 'x' }; }, 'excerpt-without-headline');
rejects('S9 an archived terms record needs its hash', r => { find(r, 'gov-uk').evidence.termsArchive = { status: 'archived' }; }, 'archive-incomplete');
rejects('S10 a non-confirmed right cannot claim a licence basis', r => { find(r, 'the-guardian').rights.headline = { status: 'pending', basis: 'open-licence', clause: 'x' }; }, 'basis-without-confirmation');

test('S11 coverage counts independent organisations by ownership group', () => {
  const r = clone();
  r.sources.push({ ...structuredClone(find(r, 'mongabay')), id: 'mongabay-india', sections: ['business'] });
  assert.equal(coverage(r).independent.organisations, coverage(REAL).independent.organisations, 'a second title from one owner counts once');
});

test('S12 government sources never count as independent news', () => {
  const r = clone(); r.sources = r.sources.filter(s => s.sourceType !== 'independent-news');
  assert.equal(coverage(r).independent.organisations, 0);
  assert.equal(coverage(r).gate, 'not-met');
});

test('S13 the strict gate counts only sources with archived terms', () => {
  assert.equal(coverage(REAL, { strict: true }).gate, 'not-met');
  const r = clone();
  for (const s of r.sources) if (s.rights.headline.status === 'confirmed') s.evidence.termsArchive = { status: 'archived', sha256: 'a'.repeat(64), retrievedAt: '2026-11-28T12:00:00Z', url: s.termsUrl };
  assert.equal(coverage(r, { strict: true }).gate, coverage(REAL).gate);
});

test('S14 the M0 verdict from the committed register (by published licence)', () => {
  const c = coverage(REAL);
  assert.equal(c.independent.organisations, 6);
  assert.deepEqual(c.sectionsMeeting, ['uk', 'world', 'science-space']);
  assert.equal(c.gate, 'met-with-fewer-sections');
});
