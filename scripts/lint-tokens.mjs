#!/usr/bin/env node
// lint-tokens.mjs — detects hardcoded values bypassing existing CSS tokens.
// Native ESM, no deps. Regex-based (not a CSS AST parser) — see limitations below.
//
// Token value units: all --space-* tokens in src/design/primitives.css are
// already expressed in raw px (e.g. "8px", not rem), so no unit conversion is
// needed here — the px-value set below is read directly from the declared
// values.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TOKEN_FILES = [
  path.join(ROOT, 'src', 'design', 'primitives.css'),
  path.join(ROOT, 'src', 'design', 'semantic.css'),
  path.join(ROOT, 'src', 'design', 'components.css'),
].map((p) => path.resolve(p));

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'target']);
// src-tauri\target special-cased via path check (also caught by 'target' name,
// but keep an explicit substring check too in case of a differently-named dir).
// .claude/worktrees holds full duplicate checkouts of this same repo (git
// worktrees) — scanning them would double/triple-count every real finding,
// so they're excluded as non-source noise, not actual project code.
const EXCLUDE_PATH_SUBSTR = [
  path.join('src-tauri', 'target'),
  path.join('.claude', 'worktrees'),
];

const SCAN_EXTS = new Set(['.css', '.ts', '.tsx']);
// Test files aren't shipping UI code — no token-bypass risk, and they legitimately
// reference literal color values in assertions (e.g. "expect css not to contain
// #oldcolor"). Excluded to fix a codex-crosscheck HAUTE finding (2026-07-19): without
// this the linter flagged its own test fixtures as violations, making the guardrail
// impossible to pass on a clean repo.
const EXCLUDE_PATH_SUBSTR_ANYWHERE = [path.sep + 'test' + path.sep, '.test.'];
function isTestPath(fullPath) {
  return EXCLUDE_PATH_SUBSTR_ANYWHERE.some((s) => fullPath.includes(s));
}

// Strips // and /* */ comments (best-effort, not string-literal-aware — a "//" or
// "/*" inside a real string could mis-trigger, acceptable for a first-pass lint).
// Fixes the other half of the same HAUTE finding: a hex color mentioned in a
// documentation comment (not actual CSS) was flagged as a hardcoded value.
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (m) => m.replace(/./g, ' '));
}

// ---------- Step 1: extract token declarations ----------
// Matches lines like:  --name: value;
const DECL_RE = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;

/** @type {Map<string,string>} token name -> raw value */
const tokens = new Map();

for (const file of TOKEN_FILES) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`Could not read token file ${file}: ${err.message}`);
    process.exit(1);
  }
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(content))) {
    const name = m[1].trim();
    const value = m[2].trim();
    tokens.set(name, value);
  }
}

// px-value set drawn from --space-* tokens (padding/margin/width/height/gap
// spacing checks below). Values are already raw px in primitives.css.
const spacingPxToToken = new Map(); // px number -> token name
for (const [name, value] of tokens) {
  if (!name.startsWith('space-')) continue;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (m) {
    spacingPxToToken.set(Number(m[1]), `--${name}`);
  } else if (value.trim() === '0') {
    spacingPxToToken.set(0, `--${name}`);
  }
}
const spacingPxValues = [...spacingPxToToken.keys()].sort((a, b) => a - b);

function nearestSpacingToken(px) {
  if (spacingPxValues.length === 0) return null;
  let best = spacingPxValues[0];
  for (const v of spacingPxValues) {
    if (Math.abs(v - px) < Math.abs(best - px)) best = v;
  }
  return { px: best, name: spacingPxToToken.get(best) };
}

// ---------- Step 2: walk the repo ----------
function isExcludedDir(name, fullPath) {
  if (EXCLUDE_DIRS.has(name)) return true;
  return EXCLUDE_PATH_SUBSTR.some((sub) => fullPath.includes(sub));
}

/** @type {string[]} */
const files = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name, full)) continue;
      walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCAN_EXTS.has(ext)) continue;
      if (isTestPath(full)) continue;
      const resolved = path.resolve(full);
      if (TOKEN_FILES.includes(resolved)) continue;
      files.push(full);
    }
  }
}

walk(ROOT);

// ---------- Step 3: detection regexes ----------
// Colors: #hex, rgb(, rgba(, oklch(
const COLOR_RE = /(#(?:[0-9a-fA-F]{3,4}){1,2}\b)|(\b(?:rgba?|oklch)\s*\()/g;

// z-index literal numeric values (not var()), excluding 0, 1, -1.
const ZINDEX_RE = /\bz-index\s*:\s*(-?\d+(?:\.\d+)?)\s*[;}]/g;

// px values on padding/margin/width/height/gap (and their longhand variants
// like padding-left, margin-top, etc.), literal numbers only (not var()/calc()).
const SPACING_PROP_RE =
  /\b((?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|width|height|(?:min|max)-(?:width|height)|gap|row-gap|column-gap)\s*:\s*([^;{}]+);/g;
const PX_TOKEN_RE = /(-?\d+(?:\.\d+)?)px/g;

/**
 * @typedef {{ line: number, category: 'color'|'z-index'|'px-spacing', value: string, suggestion: string }} Finding
 */

/** @type {Map<string, Finding[]>} */
const findingsByFile = new Map();

function addFinding(file, finding) {
  if (!findingsByFile.has(file)) findingsByFile.set(file, []);
  findingsByFile.get(file).push(finding);
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

for (const file of files) {
  let content;
  try {
    content = stripComments(readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  const rel = path.relative(ROOT, file);

  // --- colors ---
  COLOR_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_RE.exec(content))) {
    const value = m[0];
    const line = lineNumberAt(content, m.index);
    addFinding(rel, {
      line,
      category: 'color',
      value,
      suggestion: 'no matching token — new value (check semantic.css for an existing color role)',
    });
  }

  // --- z-index ---
  ZINDEX_RE.lastIndex = 0;
  while ((m = ZINDEX_RE.exec(content))) {
    const num = Number(m[1]);
    if (num === 0 || num === 1 || num === -1) continue;
    const line = lineNumberAt(content, m.index);
    // suggest nearest --z-* token
    let suggestion = 'no matching token — new value';
    let best = null;
    for (const [name, value] of tokens) {
      if (!name.startsWith('z-')) continue;
      const v = Number(value.trim());
      if (Number.isNaN(v)) continue;
      if (best === null || Math.abs(v - num) < Math.abs(best.v - num)) {
        best = { name: `--${name}`, v };
      }
    }
    if (best) {
      suggestion =
        best.v === num
          ? `use token ${best.name} (exact match)`
          : `nearest token ${best.name} (${best.v}) — verify intent`;
    }
    addFinding(rel, { line, category: 'z-index', value: String(num), suggestion });
  }

  // --- px spacing ---
  SPACING_PROP_RE.lastIndex = 0;
  while ((m = SPACING_PROP_RE.exec(content))) {
    const decl = m[2];
    if (decl.includes('var(') || decl.includes('calc(')) continue;
    PX_TOKEN_RE.lastIndex = 0;
    let pm;
    while ((pm = PX_TOKEN_RE.exec(decl))) {
      const px = Number(pm[1]);
      if (spacingPxToToken.has(px)) continue; // matches an existing token exactly
      const line = lineNumberAt(content, m.index);
      const nearest = nearestSpacingToken(px);
      const suggestion = nearest
        ? `nearest token ${nearest.name} (${nearest.px}px) — verify intent`
        : 'no matching token — new value';
      addFinding(rel, { line, category: 'px-spacing', value: `${px}px`, suggestion });
    }
  }
}

// ---------- Step 4: report ----------
const CATEGORY_LABEL = {
  color: 'Color',
  'z-index': 'z-index',
  'px-spacing': 'px spacing',
};

let total = 0;
const counts = { color: 0, 'z-index': 0, 'px-spacing': 0 };

const sortedFiles = [...findingsByFile.keys()].sort();
for (const file of sortedFiles) {
  const findings = findingsByFile.get(file).sort((a, b) => a.line - b.line);
  console.log(`\n${file}`);
  for (const f of findings) {
    console.log(
      `  ${file}:${f.line}  [${CATEGORY_LABEL[f.category]}]  ${f.value}  -> ${f.suggestion}`,
    );
    counts[f.category]++;
    total++;
  }
}

console.log('\n' + '-'.repeat(60));
console.log(
  `Findings: ${total}  (colors: ${counts.color}, z-index: ${counts['z-index']}, px-spacing: ${counts['px-spacing']})`,
);
console.log(`Files scanned: ${files.length}`);

if (total > 0) {
  console.log('\nRun `npm run lint:tokens` after fixing to confirm clean.');
  process.exit(1);
} else {
  console.log('No hardcoded token-bypassing values found.');
  process.exit(0);
}
