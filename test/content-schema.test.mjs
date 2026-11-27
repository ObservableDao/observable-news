// Strict content gate: negative tests (N) and a positive control.
// Each case starts from a valid bundle and breaks exactly one thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBundleContent } from '../src/bundle/allowlist.mjs';
import { validContent, bytesOf, NOW } from './helpers.mjs';

const check = c => validateBundleContent(bytesOf(c), { now: NOW });
function rejects(name, mutate, expectedError) {
  test(name, () => {
    const c = validContent(); mutate(c);
    const r = check(c);
    assert.equal(r.ok, false, 'must be rejected');
    assert.ok(r.errors.includes(expectedError), `expected ${expectedError}, got ${r.errors.join(' ')}`);
  });
}
const story = c => c.stories[0];
const src = c => c.stories[0].sources[0];

test('N0 control: the complete valid bundle is accepted', () => {
  const r = check(validContent());
  assert.deepEqual(r.errors, []); assert.equal(r.ok, true);
});

// 1. Approved stories with no source-permission evidence.
rejects('N1 approved story whose source has no permission record', c => { delete src(c).permission; }, 'required:$.stories[0].sources[0].permission');
rejects('N2 permission record without evidence id', c => { delete src(c).permission.evidenceId; }, 'required:$.stories[0].sources[0].permission.evidenceId');
rejects('N3 permission evidence hash that is not a SHA-256', c => { src(c).permission.evidenceSha256 = 'abc'; }, 'pattern:$.stories[0].sources[0].permission.evidenceSha256');
rejects('N4 approved story with no sources at all', c => { story(c).sources = []; }, 'min-items:$.stories[0].sources');
rejects('N5 "approved" status with no approval record', c => { delete story(c).approval; }, 'required:$.stories[0].approval');
rejects('N6 summary shown without summary rights', c => { src(c).permission.rights.summary = false; }, 'summary-without-permission:$.stories[0]');
rejects('N7 headline shown without headline rights', c => { src(c).permission.rights.headline = false; }, 'headline-without-permission:$.stories[0]');
rejects('N8 link-only basis claiming summary rights', c => { src(c).permission.basis = 'link-and-headline-only'; }, 'rights-exceed-basis:$.stories[0].sources[0].permission');
rejects('N9 expired source permission', c => { src(c).permission.expiresAt = '2026-11-01T00:00:00Z'; }, 'permission-expired:$.stories[0].sources[0].permission');
rejects('N10 source URL that is not https', c => { src(c).url = 'http://example.com/a'; }, 'https-url:$.stories[0].sources[0].url');
rejects('N11 javascript: URL', c => { src(c).url = 'javascript:alert(1)'; }, 'https-url:$.stories[0].sources[0].url');

// 2. AI classifications containing empty evidence objects.
rejects('N12 classification with an empty evidence object', c => { c.classifications[0].evidence = [{}]; }, 'required:$.classifications[0].evidence[0].url');
rejects('N13 classification evidence with an empty excerpt', c => { c.classifications[0].evidence[0].excerpt = '   '; }, 'empty:$.classifications[0].evidence[0].excerpt');
rejects('N14 classification with no evidence', c => { c.classifications[0].evidence = []; }, 'min-items:$.classifications[0].evidence');
rejects('N15 unreviewed AI classification', c => { c.classifications[0].review.status = 'pending'; }, 'const:$.classifications[0].review.status');
rejects('N16 badge text claiming verification', c => { c.classifications[0].badgeText = 'Verified true'; }, 'badge-says-verified:$.classifications[0].badgeText');
rejects('N17 classification pointing at content that is not in the bundle', c => { c.classifications[0].target = 'no-such-story'; }, 'dangling-target:$.classifications[0].target');

// 3. Unreviewed explainers without references.
rejects('N18 explainer with no references', c => { c.explainers[0].references = []; }, 'min-items:$.explainers[0].references');
rejects('N19 unreviewed explainer', c => { delete c.explainers[0].review; }, 'required:$.explainers[0].review');
rejects('N20 explainer reference with an empty object', c => { c.explainers[0].references = [{}]; }, 'required:$.explainers[0].references[0].url');

// 4. Images marked verified without licence or attribution details.
rejects('N21 verified image without licence', c => { delete c.images[0].licence; }, 'required:$.images[0].licence');
rejects('N22 verified image without attribution', c => { delete c.images[0].attribution; }, 'required:$.images[0].attribution');
rejects('N23 verified image with empty licence and attribution objects', c => { c.images[0].licence = {}; c.images[0].attribution = {}; }, 'required:$.images[0].attribution.creator');
rejects('N24 image without permission evidence', c => { delete c.images[0].permission; }, 'required:$.images[0].permission');
rejects('N25 image not marked verified', c => { c.images[0].verified = false; }, 'const:$.images[0].verified');
rejects('N26 story pointing at an image that is not in the bundle', c => { story(c).imageId = 'missing-image'; }, 'dangling-image:$.stories[0].imageId');

// Structure-level bypasses.
rejects('N27 unknown field anywhere is rejected (closed schema)', c => { c.images[0].demo = false; }, 'unexpected-field:$.images[0].demo');
rejects('N28 unknown top-level section', c => { c.extra = []; }, 'unexpected-field:$.extra');
rejects('N29 missing top-level section', c => { delete c.explainers; }, 'required:$.explainers');
rejects('N30 private field at any depth', c => { c.stories[0].sources[0].note = 'private'; }, 'forbidden-field:$.stories[0].sources[0].note');
rejects('N31 duplicate ids', c => { c.explainers[0].id = c.stories[0].id; }, 'duplicate-id:$.explainers[0]');
rejects('N32 future-dated review', c => { c.explainers[0].review.reviewedAt = '2027-01-01T00:00:00Z'; }, 'in-future:$.explainers[0].review.reviewedAt');
rejects('N33 control characters in text', c => { story(c).headline = 'bad\u0007text'; }, 'control-chars:$.stories[0].headline');
rejects('N34 featured item that does not exist', c => { c.controls.featured = ['ghost']; }, 'dangling-target:$.controls.featured[0]');

test('N35 non-JSON and oversized bundles are rejected', () => {
  assert.deepEqual(validateBundleContent(Buffer.from('{not json')).errors, ['not-json']);
  assert.deepEqual(validateBundleContent(Buffer.alloc(5 * 1024 * 1024 + 1)).errors, ['bundle-too-large']);
});
