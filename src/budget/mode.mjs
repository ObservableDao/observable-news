// Layer-1 control: every Observable job decides how much work it may do from
// the age and status of the latest budget reading. Missing data is never zero.
export function readingAgeMode({ readingTakenAt, now = Date.now(), stopFlag = false }) {
  if (stopFlag) return 'pause';
  if (!readingTakenAt) return 'pause';
  const ageH = (now - Date.parse(readingTakenAt)) / 3.6e6;
  if (!Number.isFinite(ageH)) return 'pause';
  if (ageH < 3) return 'normal';
  if (ageH <= 12) return 'degrade';
  return 'pause';
}

// Classify a metric value from analytics: unknown is never treated as zero.
export function classifyMetric(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  return 'known';
}

export function levelFor({ observableUse, observableAllocation, accountTotal, allowance }) {
  if (classifyMetric(observableUse) === 'unknown' || classifyMetric(accountTotal) === 'unknown') return 'warning';
  const own = observableAllocation > 0 ? observableUse / observableAllocation : (observableUse > 0 ? Infinity : 0);
  const acct = accountTotal / allowance;
  if (own >= 1 || acct >= 0.60) return 'stop';
  if (own >= 0.8 || acct >= 0.55) return 'degrade';
  if (own >= 0.5 || acct >= 0.50) return 'warning';
  return 'normal';
}
