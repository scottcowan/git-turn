'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const heatmap = require('./heatmap');

// Anchors every fixture timestamp to a LOCAL wall-clock time so assertions
// stay TZ-independent (never hardcode a UTC-derived string — see
// 03.1-RESEARCH.md Pitfall 1).
function iso(y, m0, d, h = 12, min = 0) {
  return new Date(y, m0, d, h, min).toISOString();
}

// Formats the same local components dayKey() should produce, so assertions
// never compare against a hardcoded UTC-derived string.
function expectedKey(y, m0, d) {
  const mm = String(m0 + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

describe('dayKey', () => {
  test('uses the LOCAL day, not the UTC day, even when hour 23:30 crosses the UTC date line', () => {
    const ts = iso(2026, 8, 7, 23, 30);
    assert.equal(heatmap.dayKey(ts), expectedKey(2026, 8, 7));
  });

  test('zero pads single-digit month and day, always length 10', () => {
    const ts = iso(2026, 0, 5, 12, 0);
    const key = heatmap.dayKey(ts);
    assert.equal(key, expectedKey(2026, 0, 5));
    assert.equal(key.length, 10);
  });
});

describe('groupByCalendarDay', () => {
  test('three turns on one local day and one turn on another produce a Map of size 2', () => {
    const turns = [
      { session_id: 's1', ts: iso(2026, 8, 1, 9, 0) },
      { session_id: 's1', ts: iso(2026, 8, 1, 10, 0) },
      { session_id: 's1', ts: iso(2026, 8, 1, 11, 0) },
      { session_id: 's1', ts: iso(2026, 8, 2, 9, 0) },
    ];
    const map = heatmap.groupByCalendarDay(turns);
    assert.equal(map.size, 2);
    assert.equal(map.get(expectedKey(2026, 8, 1)), 3);
    assert.equal(map.get(expectedKey(2026, 8, 2)), 1);
  });

  test('D-02: turns from different sessions on the same local day are summed into one bucket', () => {
    const turns = [
      { session_id: 'sessionA', ts: iso(2026, 8, 1, 9, 0) },
      { session_id: 'sessionB', ts: iso(2026, 8, 1, 15, 0) },
    ];
    const map = heatmap.groupByCalendarDay(turns);
    assert.equal(map.size, 1);
    assert.equal(map.get(expectedKey(2026, 8, 1)), 2);
  });

  test('empty input returns an empty Map, not null', () => {
    const map = heatmap.groupByCalendarDay([]);
    assert.ok(map instanceof Map);
    assert.equal(map.size, 0);
  });
});

describe('bucketFor', () => {
  test('D-01: 0 turns is always level 0', () => {
    assert.equal(heatmap.bucketFor(0, 200), 0);
  });

  test('D-01: count === maxCount is always level 4', () => {
    assert.equal(heatmap.bucketFor(200, 200), 4);
  });

  test('D-01: any nonzero count is at least level 1, never level 0', () => {
    assert.equal(heatmap.bucketFor(1, 200), 1);
  });

  test('D-01 data-relative (Pitfall 2): same level range exercised at small and large data scales', () => {
    assert.equal(heatmap.bucketFor(1, 4), 1);
    assert.equal(heatmap.bucketFor(2, 4), 2);
    assert.equal(heatmap.bucketFor(3, 4), 3);
    assert.equal(heatmap.bucketFor(4, 4), 4);

    assert.equal(heatmap.bucketFor(200, 200), 4);
  });
});

describe('computeSummaryStats', () => {
  test('D-04: computes totals, busiest day, first/last day and streak from a known fixture', () => {
    const map = new Map([
      ['2026-09-01', 2],
      ['2026-09-02', 5],
      ['2026-09-04', 1],
    ]);
    const stats = heatmap.computeSummaryStats(map);
    assert.equal(stats.totalTurns, 8);
    assert.equal(stats.activeDays, 3);
    assert.equal(stats.busiestDay, '2026-09-02');
    assert.equal(stats.busiestCount, 5);
    assert.equal(stats.firstDay, '2026-09-01');
    assert.equal(stats.lastDay, '2026-09-04');
    assert.equal(stats.longestStreak, 2);
    assert.ok(Math.abs(stats.avgPerActiveDay - 8 / 3) < 0.01);
  });

  test('empty Map returns zeroed stats with no throw and no NaN', () => {
    const stats = heatmap.computeSummaryStats(new Map());
    assert.equal(stats.totalTurns, 0);
    assert.equal(stats.activeDays, 0);
    assert.equal(stats.busiestDay, null);
    assert.equal(stats.busiestCount, 0);
    assert.equal(stats.firstDay, null);
    assert.equal(stats.lastDay, null);
    assert.equal(stats.longestStreak, 0);
    assert.equal(stats.currentStreak, 0);
    assert.ok(!Number.isNaN(stats.avgPerActiveDay));
  });

  test('ties for busiest day resolve to the earliest date, deterministically', () => {
    const map = new Map([
      ['2026-09-03', 5],
      ['2026-09-01', 5],
      ['2026-09-02', 5],
    ]);
    const stats = heatmap.computeSummaryStats(map);
    assert.equal(stats.busiestDay, '2026-09-01');
    assert.equal(stats.busiestCount, 5);
  });
});
