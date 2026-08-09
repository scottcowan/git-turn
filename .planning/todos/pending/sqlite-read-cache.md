---
id: sqlite-read-cache
title: SQLite read cache for fast log/blame/bisect
area: phase-2
priority: high
created: 2026-08-09
---

# SQLite read cache

## Problem

`git turn log` currently walks git objects (notes + refs) on every invocation. With hundreds of turns across many sessions this becomes slow. `git turn blame` and `git turn bisect` need fast indexed queries — scanning all refs per query doesn't scale.

## Solution

SQLite read cache in `.git/git-turn/cache.db`. Source of truth remains git notes + refs; SQLite is a rebuild-able index.

## Schema

```sql
CREATE TABLE turns (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT NOT NULL,
  turn_n      INTEGER NOT NULL,
  snapshot_sha TEXT NOT NULL,   -- dangling commit sha
  head_sha    TEXT,             -- HEAD at turn time
  branch      TEXT,
  ts          TEXT NOT NULL,
  files_changed INTEGER,
  insertions  INTEGER,
  deletions   INTEGER,
  prompt      TEXT,             -- from git note (null if not recorded)
  model       TEXT,
  latency_ms  INTEGER,
  UNIQUE(session_id, turn_n)
);

CREATE TABLE turn_files (
  turn_id     INTEGER REFERENCES turns(id),
  file_path   TEXT NOT NULL,
  change_type TEXT,             -- A/M/D
  insertions  INTEGER,
  deletions   INTEGER
);
```

## Rebuild procedure

```js
// On startup or `git turn gc`:
// 1. git notes --ref=refs/notes/git-turn list
// 2. For each (commit_sha, note_sha): parse note JSON, insert into turns
// 3. git diff --numstat prev_snapshot..this_snapshot → turn_files
```

## Acceptance criteria

- `git turn log` reads from SQLite, falls back to git objects if cache missing
- `git turn blame` queries `turn_files` JOIN `turns` — no git object reads
- `git turn bisect` uses `turns` table to enumerate candidates efficiently
- Cache rebuilds correctly from scratch via `git turn gc --rebuild`
- Cache is excluded from git tracking (add `.git/` prefix means it's already ignored)

## Implementation notes

- Use `better-sqlite3` (sync API fits the sync CLI pattern) or Node's built-in `sqlite` (Node 22+)
- Lazy rebuild: if cache.db missing, rebuild before first query
- Incremental update: post-commit hook inserts the new turn row after writing the ref
