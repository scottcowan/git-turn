'use strict';

const { shouldColor } = require('../git');
const blameUtil = require('../blame-util');

// Pure, git-free core of `git turn heatmap`. Day bucketing deliberately uses
// LOCAL date components, never UTC (03.1-RESEARCH.md Pitfall 1 — slicing the
// UTC prefix of an ISO timestamp assigns turns to the wrong day for anyone
// not in UTC). Density levels are deliberately data-relative — computed from
// the busiest day WITHIN THE RENDERED WINDOW (via gridMaxCount(grid)), never
// fixed absolute thresholds and never the all-time dayMap
// (03.1-RESEARCH.md Pitfall 2 / Assumption A2) — so a low-activity repo and
// a high-activity repo both render the full 0..4 level range for the days
// actually on screen. Scaling against the all-time dayMap instead of the
// rendered grid was the WR-01 defect closed by plan 03.1-04
// (03.1-VERIFICATION.md) — a future reader should not "fix" this back to
// all-time scoping, nor should the UTC-vs-local day bucketing be "fixed"
// into UTC slicing or fixed thresholds; all of this is intentional.

// Builds a 'YYYY-MM-DD' key from the LOCAL date components of `isoTs`.
// Never uses getUTCFullYear/getUTCMonth/getUTCDate and never slices the raw
// ISO string — see the header comment above.
function dayKey(isoTs) {
  const d = new Date(isoTs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Buckets turns into a Map<'YYYY-MM-DD', count>. `session_id` is ignored
// entirely — turns from every session land in the same day bucket per D-02
// (cross-session scope).
function groupByCalendarDay(turns) {
  const map = new Map();
  for (const turn of turns) {
    const key = dayKey(turn.ts);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

// Maps a raw turn count to a data-relative density level 0..4, per D-01.
// 0 only when count is 0 (or maxCount is non-positive, degenerate input);
// any positive count is clamped to at least level 1. Callers must pass a
// window-scoped `maxCount` (the rendered grid's own max, e.g.
// gridMaxCount(grid)) so the busiest VISIBLE day always reaches level 4
// regardless of scale — bucketFor() itself stays a pure (count, maxCount)
// function with no opinion on where maxCount comes from.
function bucketFor(count, maxCount) {
  if (count <= 0 || maxCount <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

// Adds `delta` calendar days to a local (y, m0, d) date using Date component
// arithmetic (never +86400000 ms, which is DST-unsafe).
function addDaysToLocalDate(y, m0, d, delta) {
  return new Date(y, m0, d + delta);
}

// Computes activity-only summary statistics from a day-count Map, per D-04.
// No token/cost/model data is used or required — every field is derivable
// from the day buckets alone.
function computeSummaryStats(dayMap) {
  const keys = [...dayMap.keys()].sort();

  if (keys.length === 0) {
    return {
      totalTurns: 0,
      activeDays: 0,
      busiestDay: null,
      busiestCount: 0,
      firstDay: null,
      lastDay: null,
      longestStreak: 0,
      currentStreak: 0,
      avgPerActiveDay: 0,
    };
  }

  let totalTurns = 0;
  let busiestDay = keys[0];
  let busiestCount = dayMap.get(keys[0]);
  for (const key of keys) {
    const count = dayMap.get(key);
    totalTurns += count;
    // Strictly-greater only — keeps the earliest date on a tie, since keys
    // are visited in ascending (lexicographic-sorted) order.
    if (count > busiestCount) {
      busiestCount = count;
      busiestDay = key;
    }
  }

  const firstDay = keys[0];
  const lastDay = keys[keys.length - 1];

  let longestStreak = 1;
  let runStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < keys.length; i++) {
    const [py, pm, pd] = keys[i - 1].split('-').map(Number);
    const expectedNext = dayKey(addDaysToLocalDate(py, pm - 1, pd, 1));
    if (keys[i] === expectedNext) {
      runStreak += 1;
    } else {
      runStreak = 1;
    }
    if (runStreak > longestStreak) longestStreak = runStreak;
    // currentStreak tracks the run ending at the day being processed; once
    // the loop finishes, keys[keys.length - 1] === lastDay, so this is
    // exactly the run ending on lastDay.
    currentStreak = runStreak;
  }

  return {
    totalTurns,
    activeDays: keys.length,
    busiestDay,
    busiestCount,
    firstDay,
    lastDay,
    longestStreak,
    currentStreak,
    avgPerActiveDay: totalTurns / keys.length,
  };
}

const LABEL_WIDTH = 4; // day-of-week label column
const CELL_WIDTH = 2; // each grid cell renders as two characters
const MAX_WEEKS = 53; // hard cap — a repo with years of turns never produces an unbounded grid

// Returns how many week columns fit in a terminal `columns` wide, clamped to
// [1, MAX_WEEKS]. `columns` is `process.stdout.columns`, which is undefined
// for non-TTY (piped/redirected) output — that case gets the full window
// since piped output has no "wrap" problem to avoid.
function availableWeeks(columns) {
  if (!columns) return MAX_WEEKS;
  return Math.max(1, Math.min(MAX_WEEKS, Math.floor((columns - LABEL_WIDTH) / CELL_WIDTH)));
}

// Builds the bounded week-column grid model for the calendar heatmap.
//
// "All-time" (D-03) means no `--since`/range CLI flag was needed to produce
// this data — it does NOT mean an unbounded grid. The window always ends on
// `endDate` (today, from the caller) and spans at most `weeks` columns
// (itself capped at MAX_WEEKS and further narrowed by availableWeeks() to
// fit the terminal). Turns older than the window are simply not part of
// `dayMap`'s render — Plan 02's `run()` is responsible for telling the user
// when older turns fell outside the window (03.1-RESEARCH.md Open
// Question 1).
//
// `dayMap` is keyed by dayKey()'s 'YYYY-MM-DD' format so lookups here always
// match what groupByCalendarDay() produced.
function buildWeekColumns(dayMap, { endDate, weeks }) {
  const [ey, em, ed] = endDate.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);

  // Find the Sunday of endDate's week, then step back (weeks - 1) weeks to
  // get the window's first Sunday.
  const endSunday = addDaysToLocalDate(ey, em - 1, ed, -end.getDay());
  const firstSunday = new Date(
    endSunday.getFullYear(),
    endSunday.getMonth(),
    endSunday.getDate() - (weeks - 1) * 7
  );

  const columns = [];
  let cursor = firstSunday;
  for (let w = 0; w < weeks; w++) {
    const column = [];
    for (let day = 0; day < 7; day++) {
      if (cursor.getTime() > end.getTime()) {
        column.push({ date: null, count: 0 });
      } else {
        const localKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        column.push({ date: localKey, count: dayMap.get(localKey) || 0 });
      }
      cursor = addDaysToLocalDate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 1);
    }
    columns.push(column);
  }

  return columns;
}

// Returns the highest `count` across every slot of every column in `grid`
// (the RENDERED window, not the all-time `dayMap`). This denominator is
// deliberately scoped to what the user actually sees on screen — scaling
// against the unbounded `dayMap` was the WR-01 defect closed by plan
// 03.1-04 (03.1-VERIFICATION.md): a busiest day outside the rendered window
// would otherwise flatten every visible cell toward level 1. A future
// reader should not "fix" this back to spreading the all-time dayMap values
// into Math.max directly.
// The leading `0` seed guarantees an empty or all-zero grid returns `0`
// rather than `Math.max()`'s no-args `-Infinity`.
function gridMaxCount(grid) {
  return Math.max(0, ...grid.flat().map(slot => slot.count));
}

const DENSITY_GLYPHS = [' ', '.', ':', '+', '#'];
const DENSITY_ANSI = [236, 22, 28, 34, 40];

// Maps a density level to an ASCII glyph for no-color degradation. Levels
// outside 0..4 clamp rather than throw (defensive — bucketFor() never
// produces an out-of-range level in practice).
function densityGlyph(level) {
  const idx = Math.max(0, Math.min(DENSITY_GLYPHS.length - 1, level));
  return DENSITY_GLYPHS[idx];
}

// Maps a density level to a 256-color ANSI background palette index
// (dim-gray zero state plus a 4-step green ramp). 256-color mode per
// Assumption A1 — never truecolor (`48;2;`).
function densityAnsi(level) {
  const idx = Math.max(0, Math.min(DENSITY_ANSI.length - 1, level));
  return DENSITY_ANSI[idx];
}

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Renders a single grid cell for an explicit density level (0..4). Colored
// cells carry their OWN open/reset pair (never a single trailing reset per
// line — 03.1-RESEARCH.md Pitfall 3).
function cellForLevel(level, useColor) {
  if (useColor) {
    return `\x1b[48;5;${densityAnsi(level)}m  \x1b[0m`;
  }
  return densityGlyph(level) + ' ';
}

// Renders a single grid cell from a raw count, deriving its density level
// relative to the caller's own maxCount (per D-01 / bucketFor).
function cell(count, maxCount, useColor) {
  return cellForLevel(bucketFor(count, maxCount), useColor);
}

// Returns the 4-character day-of-week label prefix for a grid row index
// (0=Sunday..6=Saturday, matching Date#getDay()). Only Mon/Wed/Fri carry
// text, matching the reference screenshot convention; other rows are blank.
function weekdayLabel(rowIndex) {
  if (rowIndex === 1) return 'Mon ';
  if (rowIndex === 3) return 'Wed ';
  if (rowIndex === 5) return 'Fri ';
  return '    ';
}

// Builds the month-label header line by walking columns left to right,
// placing a 3-letter abbreviation at the column offset of the first column
// whose non-null dates include the 1st..7th of a month not yet labeled.
// Skips a label whose position would land within 3 columns of the
// previously placed label, avoiding overlapping text.
function renderMonthLabels(grid) {
  let line = ' '.repeat(LABEL_WIDTH);
  let lastLabelCol = -Infinity;
  let lastLabeledMonth = null;

  for (let col = 0; col < grid.length; col++) {
    const column = grid[col];
    for (const slot of column) {
      if (!slot.date) continue;
      const [, mStr, dStr] = slot.date.split('-');
      const monthIdx = parseInt(mStr, 10) - 1;
      const dayOfMonth = parseInt(dStr, 10);
      if (dayOfMonth >= 1 && dayOfMonth <= 7 && monthIdx !== lastLabeledMonth) {
        if (col - lastLabelCol > 3) {
          const targetLen = LABEL_WIDTH + col * CELL_WIDTH;
          line = line.padEnd(targetLen, ' ') + MONTH_ABBREVS[monthIdx];
          lastLabelCol = col;
        }
        lastLabeledMonth = monthIdx;
      }
      break; // one date-check per column is enough to detect month transitions
    }
  }

  return line;
}

// Assembles the full rendered grid: one month-label line, 7 weekday rows,
// and a legend line. Returns a string[] of exactly 9 lines regardless of
// grid width.
function renderGrid(grid, { maxCount, useColor }) {
  const lines = [renderMonthLabels(grid)];

  for (let row = 0; row < 7; row++) {
    let line = weekdayLabel(row);
    for (let col = 0; col < grid.length; col++) {
      const slot = grid[col][row];
      line += cell(slot.count, maxCount, useColor);
    }
    lines.push(line);
  }

  let legend = 'Less ';
  for (let level = 0; level <= 4; level++) {
    legend += cellForLevel(level, useColor);
  }
  legend += ' More';
  lines.push(legend);

  return lines;
}

// Renders the activity-only summary block (D-04) — totals, active days,
// busiest/first/last day, streaks and average, with no token/cost/model
// fields anywhere. Null day keys render as '—' rather than 'null'/'NaN'.
function renderSummary(stats) {
  const dayOrDash = value => value || '—';
  return [
    '',
    `Total turns: ${stats.totalTurns}`,
    `Active days: ${stats.activeDays}`,
    `Busiest day: ${dayOrDash(stats.busiestDay)}`,
    `First turn: ${dayOrDash(stats.firstDay)}`,
    `Last turn: ${dayOrDash(stats.lastDay)}`,
    `Longest streak: ${stats.longestStreak}`,
    `Current streak: ${stats.currentStreak}`,
    `Avg per active day: ${stats.avgPerActiveDay.toFixed(1)}`,
  ];
}

// `git turn heatmap` entry point. Enumerates turns cross-session
// (D-02, cache-first via listAllTurns), builds the bounded week-column grid
// (D-03), renders it plus the activity-only summary block (D-04), and
// discloses any turns that fall outside the rendered window rather than
// silently hiding them.
function run(args) {
  const noCache = args.includes('--no-cache');
  const turns = blameUtil.listAllTurns({ noCache });

  if (turns.length === 0) {
    console.log('No turns recorded yet — run some turns first, or check `git turn status`.');
    return;
  }

  const dayMap = groupByCalendarDay(turns);
  const endDate = dayKey(new Date().toISOString());
  const weeks = availableWeeks(process.stdout.columns);
  const grid = buildWeekColumns(dayMap, { endDate, weeks });
  const maxCount = gridMaxCount(grid);
  const useColor = shouldColor();

  for (const line of renderGrid(grid, { maxCount, useColor })) {
    console.log(line);
  }

  // Disclose turns older than the rendered window rather than silently
  // hiding them (D-03 honesty about the bounded window).
  const firstRenderedDate = grid
    .flat()
    .map(slot => slot.date)
    .find(date => date !== null);
  if (firstRenderedDate) {
    let earlierCount = 0;
    for (const [key, count] of dayMap) {
      if (key < firstRenderedDate) earlierCount += count;
    }
    if (earlierCount > 0) {
      console.log(`(${earlierCount} earlier turns outside the ${weeks}-week window)`);
    }
  }

  for (const line of renderSummary(computeSummaryStats(dayMap))) {
    console.log(line);
  }
}

module.exports = {
  dayKey,
  groupByCalendarDay,
  bucketFor,
  computeSummaryStats,
  availableWeeks,
  buildWeekColumns,
  gridMaxCount,
  LABEL_WIDTH,
  CELL_WIDTH,
  MAX_WEEKS,
  densityGlyph,
  densityAnsi,
  renderGrid,
  renderSummary,
  run,
};
