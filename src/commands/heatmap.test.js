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

describe('availableWeeks', () => {
  test('non-TTY / piped output (undefined columns) gets the full 53-week window', () => {
    assert.equal(heatmap.availableWeeks(undefined), 53);
  });

  test('MAX_WEEKS caps even very wide terminals', () => {
    assert.equal(heatmap.availableWeeks(200), 53);
  });

  test('fits a normal 80-column terminal to 38 weeks', () => {
    assert.equal(heatmap.availableWeeks(80), Math.floor((80 - 4) / 2));
  });

  test('never returns 0 or negative on absurdly narrow terminals', () => {
    assert.equal(heatmap.availableWeeks(6), 1);
  });
});

describe('buildWeekColumns', () => {
  test('returns exactly `weeks` columns, oldest first, each column length 7', () => {
    const grid = heatmap.buildWeekColumns(new Map(), { endDate: '2026-09-07', weeks: 4 });
    assert.equal(grid.length, 4);
    for (const col of grid) {
      assert.equal(col.length, 7);
    }
  });

  test('the last column contains endDate at the weekday index matching getDay(), with counts pulled from dayMap', () => {
    const map = new Map([['2026-09-07', 3]]);
    const grid = heatmap.buildWeekColumns(map, { endDate: '2026-09-07', weeks: 4 });
    const idx = new Date(2026, 8, 7).getDay();
    const last = grid[grid.length - 1];
    assert.equal(last[idx].date, '2026-09-07');
    assert.equal(last[idx].count, 3);
  });

  test('slots after endDate in the last column are null-date, zero-count (future days not rendered)', () => {
    const grid = heatmap.buildWeekColumns(new Map(), { endDate: '2026-09-09', weeks: 2 });
    const idx = new Date(2026, 8, 9).getDay();
    const last = grid[grid.length - 1];
    for (let k = idx + 1; k < 7; k++) {
      assert.equal(last[k].date, null);
      assert.equal(last[k].count, 0);
    }
  });

  test('every non-null slot date is a YYYY-MM-DD string with count from dayMap.get(date) or 0', () => {
    const map = new Map([['2026-09-05', 7]]);
    const grid = heatmap.buildWeekColumns(map, { endDate: '2026-09-07', weeks: 2 });
    let found = false;
    for (const col of grid) {
      for (const slot of col) {
        if (slot.date === null) continue;
        assert.match(slot.date, /^\d{4}-\d{2}-\d{2}$/);
        if (slot.date === '2026-09-05') {
          assert.equal(slot.count, 7);
          found = true;
        } else {
          assert.equal(slot.count, map.get(slot.date) || 0);
        }
      }
    }
    assert.ok(found, 'expected the fixture day to appear in the grid');
  });

  test('a fixture day whose local getDay() is 3 lands on inner index 3, not 0 or 2', () => {
    // 2026-09-02 is a Wednesday (getDay() === 3); derived, not hardcoded.
    const wednesday = new Date(2026, 8, 2);
    assert.equal(wednesday.getDay(), 3);
    const map = new Map([['2026-09-02', 9]]);
    const grid = heatmap.buildWeekColumns(map, { endDate: '2026-09-07', weeks: 4 });
    let matched = false;
    for (const col of grid) {
      if (col[3].date === '2026-09-02') {
        assert.equal(col[3].count, 9);
        matched = true;
      }
    }
    assert.ok(matched, 'expected 2026-09-02 to land at inner index 3');
  });

  test('the window is exactly weeks * 7 slots — days before the window do not appear', () => {
    const grid = heatmap.buildWeekColumns(new Map(), { endDate: '2026-09-07', weeks: 3 });
    let total = 0;
    for (const col of grid) total += col.length;
    assert.equal(total, 21);
  });

  test('an empty dayMap still returns a full weeks-length grid of zero-count slots', () => {
    const grid = heatmap.buildWeekColumns(new Map(), { endDate: '2026-09-07', weeks: 5 });
    assert.equal(grid.length, 5);
    for (const col of grid) {
      for (const slot of col) {
        assert.equal(slot.count, 0);
      }
    }
  });
});

describe('densityGlyph / densityAnsi', () => {
  test('densityGlyph maps levels 0..4 to the expected ASCII glyphs', () => {
    assert.equal(heatmap.densityGlyph(0), ' ');
    assert.equal(heatmap.densityGlyph(1), '.');
    assert.equal(heatmap.densityGlyph(2), ':');
    assert.equal(heatmap.densityGlyph(3), '+');
    assert.equal(heatmap.densityGlyph(4), '#');
  });

  test('densityGlyph does not throw on an out-of-range level', () => {
    assert.doesNotThrow(() => heatmap.densityGlyph(-1));
    assert.doesNotThrow(() => heatmap.densityGlyph(99));
  });

  test('densityAnsi maps levels 0..4 to the expected 256-color palette indices', () => {
    assert.equal(heatmap.densityAnsi(0), 236);
    assert.equal(heatmap.densityAnsi(1), 22);
    assert.equal(heatmap.densityAnsi(2), 28);
    assert.equal(heatmap.densityAnsi(3), 34);
    assert.equal(heatmap.densityAnsi(4), 40);
  });

  test('densityAnsi does not throw on an out-of-range level', () => {
    assert.doesNotThrow(() => heatmap.densityAnsi(-1));
    assert.doesNotThrow(() => heatmap.densityAnsi(99));
  });
});

describe('renderGrid', () => {
  function makeGrid(dayMap = new Map(), weeks = 5) {
    return heatmap.buildWeekColumns(dayMap, { endDate: '2026-09-07', weeks });
  }

  test('returns exactly 9 lines: 1 month-label line + 7 weekday rows + 1 legend line', () => {
    const grid = makeGrid();
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    assert.equal(lines.length, 9);
  });

  test('useColor: false emits no \\x1b anywhere (D-01 no-color degradation)', () => {
    const grid = makeGrid(new Map([['2026-09-07', 4]]));
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    assert.ok(!lines.some(line => /\x1b/.test(line)));
  });

  test('useColor: true emits at least one 48;5; sequence with balanced open/reset counts per line (Pitfall 3)', () => {
    const grid = makeGrid(new Map([['2026-09-07', 4]]));
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: true });
    assert.ok(lines.some(line => /\x1b\[48;5;/.test(line)));
    for (const line of lines) {
      const opens = (line.match(/\x1b\[48;5;/g) || []).length;
      const resets = (line.match(/\x1b\[0m/g) || []).length;
      assert.equal(opens, resets, `unbalanced ANSI in line: ${JSON.stringify(line)}`);
    }
  });

  test('each of the 7 weekday rows starts with a 4-character label prefix; Mon/Wed/Fri carry the abbreviation, others are blank', () => {
    const grid = makeGrid();
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    const weekdayRows = lines.slice(1, 8);
    assert.equal(weekdayRows.length, 7);
    assert.equal(weekdayRows[0].slice(0, 4), '    ');
    assert.equal(weekdayRows[1].slice(0, 4), 'Mon ');
    assert.equal(weekdayRows[2].slice(0, 4), '    ');
    assert.equal(weekdayRows[3].slice(0, 4), 'Wed ');
    assert.equal(weekdayRows[4].slice(0, 4), '    ');
    assert.equal(weekdayRows[5].slice(0, 4), 'Fri ');
    assert.equal(weekdayRows[6].slice(0, 4), '    ');
  });

  test('each weekday row cell region is grid.length * CELL_WIDTH characters wide when useColor is false', () => {
    const weeks = 5;
    const grid = makeGrid(new Map(), weeks);
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    const weekdayRows = lines.slice(1, 8);
    for (const row of weekdayRows) {
      assert.equal(row.length - heatmap.LABEL_WIDTH, weeks * heatmap.CELL_WIDTH);
    }
  });

  test('legend line contains the literal Less and More', () => {
    const grid = makeGrid();
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    const legend = lines[lines.length - 1];
    assert.ok(legend.includes('Less'));
    assert.ok(legend.includes('More'));
  });

  test('month-label line places a month abbreviation and never places two labels within 3 columns of each other', () => {
    const grid = makeGrid(new Map(), 20);
    const lines = heatmap.renderGrid(grid, { maxCount: 4, useColor: false });
    const monthLine = lines[0];
    const positions = [];
    for (let i = heatmap.LABEL_WIDTH; i < monthLine.length; i++) {
      if (/[A-Z]/.test(monthLine[i]) && (i === 0 || monthLine[i - 1] === ' ')) {
        positions.push(i);
      }
    }
    assert.ok(positions.length >= 1, 'expected at least one month label');
    for (let i = 1; i < positions.length; i++) {
      const colDelta = (positions[i] - positions[i - 1]) / heatmap.CELL_WIDTH;
      assert.ok(colDelta > 3, `labels too close: ${positions[i - 1]} vs ${positions[i]}`);
    }
  });

  test('a grid whose slots are all zero count renders without throwing and, with useColor: false, contains only spaces in its cell region', () => {
    const grid = makeGrid(new Map());
    const lines = heatmap.renderGrid(grid, { maxCount: 0, useColor: false });
    const weekdayRows = lines.slice(1, 8);
    for (const row of weekdayRows) {
      const cellRegion = row.slice(heatmap.LABEL_WIDTH);
      assert.ok(/^ *$/.test(cellRegion), `expected only spaces, got: ${JSON.stringify(cellRegion)}`);
    }
  });
});
