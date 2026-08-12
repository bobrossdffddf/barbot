# barbot document fix

Fixes: `missing file: 01 - Criminal Forms - Copy/CR-01 - ....pdf`

## The cause

Your folders on disk are named `01 - Criminal Forms`. The bot is asking for
`01 - Criminal Forms - Copy/...`. That ` - Copy` is the Windows "duplicate folder"
suffix, baked into the **file paths stored inside old Discord dropdown menus**.

Those messages live in Discord forever. Restarting the bot, fixing `DOCS_ROOT`, or
renaming folders does nothing — every click on an old menu still sends the old path.

Your `DOCS_ROOT` and cwd were both already correct, so that was never the problem.

## Install

Copy `pathfix.js`, `fixdocs.js` and `install.sh` into `/root/barbot`, then:

```bash
cd /root/barbot
bash install.sh
pm2 restart barexam --update-env
pm2 logs barexam --lines 20
```

That's it. `install.sh` backs up `index.js`, inserts one `require` line at the top
(after any shebang / `'use strict'`), and builds `_extracted.json`.

To do it by hand instead, put this as the first line of `index.js`:

```js
require('./pathfix')();
```

## What pathfix.js does

It wraps Node's `fs` calls. When a document path doesn't exist, it retries with:

1. `" - Copy"` stripped out
2. the path resolved against `DOCS_ROOT` (fixes relative-path bugs too)
3. a lookup of the file **by name** anywhere under `DOCS_ROOT`

If none of those find it, the original error happens as normal — it never hides a
genuinely missing file. It only ever touches paths ending in a document extension,
so the rest of the bot is unaffected.

Healed paths are logged once each:

```
[pathfix] healed  01 - Criminal Forms/CR-01 - Arrest Affidavit and Probable Cause Statement.pdf
```

You do **not** need to touch `documents.js` or `portal.js`.

## fixdocs.js

```bash
node fixdocs.js            # audit only, changes nothing
node fixdocs.js --write    # also rebuild _extracted.json (backs up the old one)
node fixdocs.js --rename   # rename any leftover "... - Copy" folders on disk
```

The audit prints your root, cwd, every folder with its PDF count, duplicate
filenames, and a PASS/FAIL resolver test using the exact path from your error log.

## Verified

Tested against a copy of your six folders (45 PDFs):

| Input | Result |
|---|---|
| `01 - Criminal Forms - Copy/CR-01 - ....pdf` | healed, 241,845 bytes sent |
| `/root/barbot/06 - Judicial Rulings and Appeals - Copy/AP-01 - ....pdf` | healed |
| relative path with a wrong cwd | healed |
| correct current path | untouched |
| a file that truly doesn't exist | still fails, cleanly |
| `fs.readFile`, `fs.promises.readFile`, `createReadStream` | all healed |

Re-running `install.sh` twice is safe.

## Two other things in your logs

**1. Apps Script is 404ing on every poll**, every 20 seconds — the response body is
a Google error page. That deployment URL is dead, so bar exam submissions are not
coming through. Redeploy the Apps Script as a new web app (Execute as: me,
Access: anyone with the link) and put the new `/exec` URL in `APPS_SCRIPT_URLS`.

**2. Rotate the credentials you pasted earlier** — the webhook token and
`POLL_SECRET`. Delete and re-create the webhook in the channel's
Settings → Integrations → Webhooks, and change `POLL_SECRET` on both sides while
you're redeploying the script anyway. Then move both into a `.env` and leave the
`process.env.X ||` fallbacks empty.

## Optional cleanup

Once everything works, delete the old `$documents` portal messages and post a fresh
one. New menus will carry correct paths, and pathfix becomes a safety net rather
than a crutch.
