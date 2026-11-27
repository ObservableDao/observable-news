// M0 acceptance test B (harness part): layer-1 controls and threshold logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingAgeMode, classifyMetric, levelFor } from '../src/budget/mode.mjs';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3.6e6).toISOString();

test('B4 skipped monitor schedules: jobs degrade at 3 h and pause after 12 h', () => {
  assert.equal(readingAgeMode({ readingTakenAt: hoursAgo(1), now: NOW }), 'normal');
  assert.equal(readingAgeMode({ readingTakenAt: hoursAgo(4), now: NOW }), 'degrade');
  assert.equal(readingAgeMode({ readingTakenAt: hoursAgo(13), now: NOW }), 'pause');
  assert.equal(readingAgeMode({ readingTakenAt: null, now: NOW }), 'pause');
  assert.equal(readingAgeMode({ readingTakenAt: hoursAgo(1), now: NOW, stopFlag: true }), 'pause');
});

test('B3 missing metrics are unknown, never zero, and raise a warning', () => {
  assert.equal(classifyMetric(null), 'unknown');
  assert.equal(classifyMetric(undefined), 'unknown');
  assert.equal(classifyMetric(0), 'known');
  assert.equal(levelFor({ observableUse: 0, observableAllocation: 10, accountTotal: null, allowance: 100 }), 'warning');
});

test('B5 existing-project spike: Observable warns at 50%, degrades at 55%, stops at 60% of the account total', () => {
  const at = pct => levelFor({ observableUse: 0, observableAllocation: 10_000, accountTotal: pct * 1000, allowance: 100_000 });
  assert.equal(at(40), 'normal');
  assert.equal(at(52), 'warning');
  assert.equal(at(57), 'degrade');
  assert.equal(at(61), 'stop');
});

test('B6 Observable use of a resource planned at zero is an immediate stop', () => {
  assert.equal(levelFor({ observableUse: 1, observableAllocation: 0, accountTotal: 10, allowance: 100_000 }), 'stop');
});
