'use strict';
/**
 * pathfix.js - self-healing document paths for the Clearwater bot.
 *
 * The problem: old Discord dropdown menus still carry paths captured when the
 * folders were named "01 - Criminal Forms - Copy". Those messages live forever,
 * so restarting the bot never fixes them, and every click logs "missing file".
 *
 * This patches Node's fs layer. Any time something tries to open a document
 * path that does not exist, it silently retries with:
 *      1. " - Copy" stripped out
 *      2. the path resolved against DOCS_ROOT (in case it was relative)
 *      3. a lookup of the file by name anywhere under DOCS_ROOT
 *
 * Nothing else in the bot has to change. Add this as the FIRST line of index.js:
 *
 *      require('./pathfix')();
 *
 * Optionally pass a root: require('./pathfix')('/root/barbot');
 */

const fs = require('fs');
const path = require('path');

// Keep untouched copies so the resolver never calls back into itself.
const orig = {
  existsSync: fs.existsSync.bind(fs),
  readdirSync: fs.readdirSync.bind(fs),
  statSync: fs.statSync.bind(fs),
};

const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|png|jpe?g|gif|zip)$/i;
const COPY_SUFFIX = / - Copy(?= *[\\/]|$)/gi;
const INDEX_TTL_MS = 30000;
const MAX_DEPTH = 4;

let ROOT = null;
let fileIndex = null;
let indexedAt = 0;
let installed = false;
let quiet = false;
const logged = new Set();          // so one click does not print the same line 3x

function log(...a) {
  if (!quiet) console.log('[pathfix]', ...a);
}

function once(msg) {
  if (logged.has(msg)) return;
  if (logged.size > 500) logged.clear();
  logged.add(msg);
  log(msg);
}

function detectRoot(explicit) {
  if (explicit) return path.resolve(explicit);

  if (process.env.DOCS_ROOT) return path.resolve(process.env.DOCS_ROOT);

  // Try the bot's own config, resolving "." against the config file's folder
  // rather than the process working directory.
  try {
    const cfg = require(path.join(__dirname, 'config.js'));
    if (cfg && cfg.DOCS_ROOT) {
      const r = String(cfg.DOCS_ROOT);
      return path.resolve(path.isAbsolute(r) ? r : path.join(__dirname, r));
    }
  } catch (_) { /* config not loadable - fall through */ }

  return __dirname;
}

function buildIndex() {
  fileIndex = new Map();
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = orig.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (DOC_EXT.test(e.name)) {
        const key = e.name.toLowerCase();
        if (!fileIndex.has(key)) fileIndex.set(key, full);
      }
    }
  };
  walk(ROOT, 0);
  indexedAt = Date.now();
  return fileIndex;
}

function indexOfFiles() {
  if (!fileIndex || Date.now() - indexedAt > INDEX_TTL_MS) buildIndex();
  return fileIndex;
}

/** Public: turn a possibly-stale document path into one that exists. */
function resolveDoc(p) {
  if (typeof p !== 'string' || !p) return p;
  if (!DOC_EXT.test(p)) return p;          // only ever touch document paths
  if (orig.existsSync(p)) return p;

  const stripped = p.replace(COPY_SUFFIX, '');
  const candidates = [stripped];

  if (!path.isAbsolute(p)) {
    candidates.push(path.join(ROOT, p));
    candidates.push(path.join(ROOT, stripped));
  }

  for (const c of candidates) {
    if (c !== p && orig.existsSync(c)) {
      once('healed  ' + (path.relative(ROOT, c) || c));
      return c;
    }
  }

  // Last resort: find it by filename anywhere under the root.
  const hit = indexOfFiles().get(path.basename(stripped).toLowerCase());
  if (hit) {
    once('healed by name  ' + path.relative(ROOT, hit));
    return hit;
  }

  return p;                                 // genuinely missing - let it fail normally
}

/** Wrap an fs function so its first argument is healed first. */
function wrapFirstArg(obj, name) {
  const fn = obj[name];
  if (typeof fn !== 'function') return;
  const patched = function (p, ...rest) {
    return fn.call(this, resolveDoc(p), ...rest);
  };
  Object.defineProperty(patched, 'name', { value: name });
  obj[name] = patched;
}

function install(root, options = {}) {
  if (installed) return { root: ROOT, resolveDoc };
  quiet = !!options.quiet;
  ROOT = detectRoot(root);

  if (!orig.existsSync(ROOT)) {
    console.warn('[pathfix] WARNING: DOCS_ROOT does not exist:', ROOT);
  }

  [
    'existsSync', 'readFileSync', 'statSync', 'accessSync', 'openSync',
    'createReadStream', 'readFile', 'stat', 'access', 'open', 'copyFile',
  ].forEach((n) => wrapFirstArg(fs, n));

  if (fs.promises) {
    ['readFile', 'stat', 'access', 'open', 'copyFile'].forEach((n) => wrapFirstArg(fs.promises, n));
  }

  installed = true;

  const count = indexOfFiles().size;
  log('active. root =', ROOT);
  log('indexed', count, 'document(s) across', countFolders(), 'folder(s)');
  return { root: ROOT, resolveDoc };
}

function countFolders() {
  try {
    return orig.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .length;
  } catch (_) {
    return 0;
  }
}

module.exports = install;
module.exports.install = install;
module.exports.resolveDoc = resolveDoc;
module.exports.rebuildIndex = buildIndex;
Object.defineProperty(module.exports, 'root', { get: () => ROOT });
