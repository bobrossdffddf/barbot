#!/usr/bin/env bash
# Installs pathfix into index.js. Safe to run more than once.
set -euo pipefail

DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$DIR"

echo "installing into: $DIR"

for f in pathfix.js fixdocs.js; do
  [ -f "$f" ] || { echo "ERROR: $f is not in $DIR"; exit 1; }
done
[ -f index.js ] || { echo "ERROR: index.js not found in $DIR"; exit 1; }

if grep -q "require('./pathfix')" index.js || grep -q 'require("./pathfix")' index.js; then
  echo "  index.js already loads pathfix - nothing to change"
else
  cp index.js index.js.bak
  echo "  backed up index.js -> index.js.bak"
  # Insert after a shebang and/or a 'use strict' directive, never before them.
  node - "$PWD/index.js" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
let at = 0;
if (lines[at] && lines[at].startsWith('#!')) at++;
if (lines[at] && /^\s*['"]use strict['"]\s*;?\s*$/.test(lines[at])) at++;
lines.splice(at, 0, "require('./pathfix')();   // heals stale document paths");
fs.writeFileSync(file, lines.join('\n'));
console.log('  added require to index.js at line ' + (at + 1));
NODE
fi

echo ""
node fixdocs.js --write

echo ""
echo "now run:  pm2 restart barexam --update-env && pm2 logs barexam --lines 20"
