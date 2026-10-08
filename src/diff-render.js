'use strict';

// Pure unified-diff parser + rich renderer shared by diff.js/show.js (DIFF-01).
// String-in/string-out only — no console/process/child_process access, so
// this module is MCP-safe (Phase 8/9) and unit-testable without a git repo.

const { parseHunkHeader } = require('./blame-util');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const BG_ADDED = '\x1b[48;5;22m';
const BG_REMOVED = '\x1b[48;5;52m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Pad with spaces so a background ANSI code visually fills the row; never
// truncates — long lines simply don't get a padded tail.
function padRow(text, width) {
  return text.length < width ? text + ' '.repeat(width - text.length) : text;
}

// State-machine parse of a raw unified diff (git()'s trimmed output — no
// trailing newline). Classifies content lines inside a hunk by first
// character only, so raw '---'/'+++'-prefixed content lines are counted
// correctly instead of being mistaken for file-header noise (T-07-02).
function parseDiff(rawText) {
  if (!rawText) return { files: [], added: 0, removed: 0 };

  const files = [];
  let added = 0;
  let removed = 0;
  let currentFile = null;
  let currentHunk = null;
  let newLine = 0;

  for (const line of rawText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentFile = { header: line, meta: [], hunks: [] };
      currentHunk = null;
      files.push(currentFile);
      continue;
    }

    const hunk = parseHunkHeader(line);
    if (hunk) {
      currentHunk = { header: line, lines: [] };
      currentFile.hunks.push(currentHunk);
      newLine = hunk.newStart;
      continue;
    }

    if (!currentHunk) {
      // File-metadata line (between a file header and its first hunk).
      if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        continue;
      }
      currentFile.meta.push(line);
      continue;
    }

    const marker = line.charAt(0);
    if (marker === '+') {
      currentHunk.lines.push({ type: 'add', newLineNo: newLine, text: line.slice(1) });
      newLine++;
      added++;
    } else if (marker === '-') {
      currentHunk.lines.push({ type: 'del', newLineNo: null, text: line.slice(1) });
      removed++;
    } else if (marker === ' ') {
      currentHunk.lines.push({ type: 'ctx', newLineNo: newLine, text: line.slice(1) });
      newLine++;
    } else if (line === '') {
      currentHunk.lines.push({ type: 'ctx', newLineNo: newLine, text: '' });
      newLine++;
    }
    // Lines like '\ No newline at end of file' (marker === '\\') are
    // intentionally dropped — not counted, not rendered.
  }

  return { files, added, removed };
}

// Renders a rich, line-numbered, full-row-highlighted representation of a
// raw unified diff. color defaults to false, width defaults to 120 — both
// are supplied by the caller (diff.js/show.js via shouldColor()/columns);
// this module never reads process.* itself.
function renderRich(rawText, { color = false, width = 120 } = {}) {
  const { files, added, removed } = parseDiff(rawText);

  const out = [`Added ${added} / removed ${removed}`, ''];

  if (files.length === 0) {
    out.push('(no changes)');
    return out.join('\n');
  }

  const allLineNos = files.flatMap(f => f.hunks.flatMap(h => h.lines.map(l => l.newLineNo || 0)));
  const gutterWidth = String(Math.max(1, ...allLineNos)).length;

  files.forEach((file, fileIdx) => {
    if (fileIdx > 0) out.push('');

    out.push(color ? `${DIM}${file.header}${RESET}` : file.header);
    for (const metaLine of file.meta) {
      out.push(color ? `${DIM}${metaLine}${RESET}` : metaLine);
    }

    for (const hunkEntry of file.hunks) {
      out.push(color ? `${DIM}${hunkEntry.header}${RESET}` : hunkEntry.header);
      for (const contentLine of hunkEntry.lines) {
        const gutter = contentLine.newLineNo != null
          ? String(contentLine.newLineNo).padStart(gutterWidth)
          : ' '.repeat(gutterWidth);
        const marker = contentLine.type === 'add' ? '+' : contentLine.type === 'del' ? '-' : ' ';
        const plain = `${gutter} ${marker} ${contentLine.text}`;

        if (!color) {
          out.push(plain);
          continue;
        }

        if (contentLine.type === 'add') {
          out.push(`${BG_ADDED}${padRow(plain, width)}${RESET}`);
        } else if (contentLine.type === 'del') {
          out.push(`${BG_REMOVED}${padRow(plain, width)}${RESET}`);
        } else {
          out.push(`${DIM}${gutter}${RESET} ${marker} ${contentLine.text}`);
        }
      }
    }
  });

  return out.join('\n');
}

module.exports = { parseDiff, renderRich, EMPTY_TREE };
