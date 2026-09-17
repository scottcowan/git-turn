---
created: 2026-09-17T15:56:48.506Z
title: Explore mindwalk integration for turn boundary visualization
area: integration
files: []
---

## Problem

[mindwalk](https://github.com/cosmtrek/mindwalk) is a visualization tool that replays coding-agent sessions on a 3D map of the codebase — it draws the repo as a "night map" and plays a session's tool-call activity (search/read/edit) back as light moving through it, from the raw session JSONL log.

This is complementary to git-turn, not redundant: mindwalk visualizes *where the agent looked* during a session (from tool-call telemetry), while git-turn tracks *what actually changed on disk, per turn, with real diffs* (from git snapshots). Mindwalk has no concept of turn boundaries or file-level diff data on its own.

## Solution

Likely doesn't require forking mindwalk. If mindwalk's input is a session JSONL file, the integration point is a small preprocessing script: read git-turn's turn refs (`session_id`, `turn_n`, `head`, `created` timestamp via `parseSnapshotMessage()`) and inject turn-boundary marker events into the JSONL stream at matching timestamps before handing it to mindwalk — no mindwalk code changes needed, as long as it tolerates unknown event types.

Not yet verified against mindwalk's actual source (only the README description has been reviewed so far). Before attempting: skim mindwalk's ingestion code to confirm (a) the exact JSONL schema it expects, and (b) whether it exposes any plugin/annotation API that would be a cleaner integration point than raw event injection. Ties conceptually to the `refs/git-turn/format` discovery-blob protocol already designed for warren — mindwalk could use the same protocol to read turn data directly instead of via a preprocessed log.
