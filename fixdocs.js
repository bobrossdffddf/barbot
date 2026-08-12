#!/usr/bin/env node
'use strict';
/**
 * fixdocs.js - audit and repair the document folders.
 *
 *   node fixdocs.js            audit only, changes nothing
 *   node fixdocs.js --write    also (re)write _extracted.json
 *   node fixdocs.js --rename   rename any leftover "... - Copy" folders
 *
 * Safe to run repeatedly.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DO_WRITE = args.includes('--write');
const DO_RENAME = args.includes('--rename');

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function detectRoot() {
  if (process.env.DOCS_ROOT) return path.resolve(process.env.DOCS_ROOT);
  try {
    const cfg = require(path.join(__dirname, 'config.js'));
    if (cfg && cfg.DOCS_ROOT) {
      const r = String(cfg.DOCS_ROOT);
      return path.resolve(path.isAbsolute(r) ? r : path.join(__dirname, r));
    }
  } catch (_) {}
  return __dirname;
}

const ROOT = detectRoot();
console.log(C.b('\nDocument audit'));
console.log('  root          ', ROOT);
console.log('  cwd           ', process.cwd());
console.log('  script dir    ', __dirname);
if (ROOT !== __dirname) {
  console.log(C.y('  note: DOCS_ROOT is not the folder this script lives in'));
}
console.log('');

if (!fs.existsSync(ROOT)) {
  console.log(C.r('FATAL: root does not exist. Set DOCS_ROOT to an absolute path.'));
  process.exit(1);
}

// ---------------------------------------------------------------- folders
const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
  .map((d) => d.name)
  .sort();

const copyDirs = dirs.filter((d) => / - Copy$/i.test(d));

console.log(C.b('Folders found'));
if (!dirs.length) console.log(C.r('  none - the form folders are not in this directory'));
for (const d of dirs) {
  const files = fs.readdirSync(path.join(ROOT, d)).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const flag = / - Copy$/i.test(d) ? C.y('  <- has a " - Copy" suffix') : '';
  console.log(`  ${d.padEnd(42)} ${String(files.length).padStart(3)} pdf${flag}`);
}
console.log('');

// ---------------------------------------------------------------- rename
if (DO_RENAME && copyDirs.length) {
  console.log(C.b('Renaming " - Copy" folders'));
  for (const d of copyDirs) {
    const from = path.join(ROOT, d);
    const to = path.join(ROOT, d.replace(/ - Copy$/i, ''));
    if (fs.existsSync(to)) {
      console.log(C.y(`  skip  ${d}  (target already exists)`));
      continue;
    }
    fs.renameSync(from, to);
    console.log(C.g(`  ok    ${d}  ->  ${path.basename(to)}`));
  }
  console.log('');
}

// ---------------------------------------------------------------- manifest
const manifest = {};
let total = 0;
for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue;
  const files = fs.readdirSync(path.join(ROOT, d.name))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  if (!files.length) continue;
  manifest[d.name] = files;
  total += files.length;
}

console.log(C.b('Totals'));
console.log(`  ${Object.keys(manifest).length} folder(s), ${total} pdf(s)`);
console.log('');

// ---------------------------------------------------------------- duplicates
const seen = new Map();
const dupes = [];
for (const [folder, files] of Object.entries(manifest)) {
  for (const f of files) {
    const k = f.toLowerCase();
    if (seen.has(k)) dupes.push([k, seen.get(k), folder]);
    else seen.set(k, folder);
  }
}
if (dupes.length) {
  console.log(C.y('Duplicate filenames (the name-based fallback picks the first):'));
  for (const [f, a, b] of dupes) console.log(`  ${f}  in  ${a}  and  ${b}`);
  console.log('');
}

// ---------------------------------------------------------------- resolver test
console.log(C.b('Resolver check'));
let pathfix;
try {
  pathfix = require(path.join(__dirname, 'pathfix.js'));
  pathfix(ROOT, { quiet: true });
} catch (e) {
  console.log(C.r('  pathfix.js not loadable: ' + e.message));
}

if (pathfix) {
  const firstFolder = Object.keys(manifest)[0];
  if (firstFolder) {
    const firstFile = manifest[firstFolder][0];
    const cases = [
      `${firstFolder} - Copy/${firstFile}`,               // the exact failure in the log
      path.join(ROOT, `${firstFolder} - Copy`, firstFile),
      `${firstFolder}/${firstFile}`,
      firstFile,
    ];
    for (const c of cases) {
      const out = pathfix.resolveDoc(c);
      const ok = fs.existsSync(out);
      console.log(`  ${ok ? C.g('PASS') : C.r('FAIL')}  ${C.d(c)}`);
      if (!ok) console.log(`         -> ${out}`);
    }
  }
}
console.log('');

// ---------------------------------------------------------------- write
const outPath = path.join(ROOT, '_extracted.json');
if (DO_WRITE) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    fs.copyFileSync(outPath, outPath + '.bak');
    console.log(C.d(`  backed up existing manifest to ${path.basename(outPath)}.bak`));
  }
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(C.g(`  wrote ${outPath}`));
} else {
  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : -1;
  if (size <= 0) {
    console.log(C.y(`  _extracted.json is ${size < 0 ? 'missing' : 'empty'} - run with --write to build it`));
  } else {
    console.log(C.d(`  _extracted.json is ${size} bytes (run with --write to rebuild)`));
  }
}

console.log('');
console.log(C.b('Next steps'));
console.log('  1. add   require(\'./pathfix\')();   as the first line of index.js');
console.log('  2. pm2 restart barexam --update-env');
console.log('  3. delete the old $documents portal message and post a fresh one');
console.log('');
