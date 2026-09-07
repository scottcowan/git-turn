'use strict';

// Pure, git-free core of `git turn heatmap`. Day bucketing deliberately uses
// LOCAL date components, never UTC (03.1-RESEARCH.md Pitfall 1 — slicing the
// UTC prefix of an ISO timestamp assigns turns to the wrong day for anyone
// not in UTC). Density levels are deliberately data-relative — computed from
// the caller's own max-per-day, never fixed absolute thresholds
// (03.1-RESEARCH.md Pitfall 2 / Assumption A2) — so a low-activity repo and
// a high-activity repo both render the full 0..4 level range. A future
// reader should not "fix" either of these into UTC slicing or fixed
// thresholds; both are intentional.

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
// any positive count is clamped to at least level 1, and the top of the
// caller's own data range always reaches level 4 regardless of scale.
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

module.exports = {
  dayKey,
  groupByCalendarDay,
  bucketFor,
  computeSummaryStats,
  availableWeeks,
  buildWeekColumns,
  LABEL_WIDTH,
  CELL_WIDTH,
  MAX_WEEKS,
};
