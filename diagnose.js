const cfg = require('./config');

(async () => {
  console.log('--- config ---');
  console.log('GUILD_ID       ' + cfg.GUILD_ID);
  console.log('WEBHOOK_ID     ' + cfg.WEBHOOK_ID);
  console.log('POLL_SECRET    ' + (cfg.POLL_SECRET === 'change-this-to-a-long-random-string' ? 'STILL DEFAULT' : 'set (' + cfg.POLL_SECRET.length + ' chars)'));
  console.log('ROLE_ON_PASS   ' + cfg.ROLE_ON_PASS);

  for (const url of cfg.APPS_SCRIPT_URLS) {
    console.log('\n--- polling ' + url + ' ---');
    if (String(url).indexOf('PASTE') === 0) { console.log('NOT FILLED IN'); continue; }
    try {
      const res = await fetch(url + '?secret=' + encodeURIComponent(cfg.POLL_SECRET), { redirect: 'follow' });
      const text = await res.text();
      console.log('HTTP ' + res.status);
      console.log('body: ' + text.slice(0, 400));
      if (text.trim().startsWith('<')) {
        console.log('\n>> Got a login/HTML page. Re-deploy the Web App with access = "Anyone".');
      } else {
        const j = JSON.parse(text);
        if (j.error) console.log('\n>> ' + j.error + ': POLL_SECRET does not match the Apps Script.');
        else console.log('\n>> OK. Queued submissions waiting: ' + (j.items || []).length);
      }
    } catch (e) {
      console.log('FAILED: ' + e.message);
    }
  }

  console.log('\n--- images ---');
  for (const [name, url] of [['HEADER', cfg.HEADER_IMAGE], ['FOOTER', cfg.FOOTER_IMAGE]]) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      const ok = r.ok && ct.startsWith('image/');
      console.log(name + ' HTTP ' + r.status + ' type=' + ct + (ok ? '  OK' : '  <-- Discord cannot embed this'));
    } catch (e) {
      console.log(name + ' FAILED: ' + e.message);
    }
  }

  console.log('\n--- webhook ---');
  if (String(cfg.WEBHOOK_ID).indexOf('PASTE') === 0) { console.log('NOT FILLED IN'); return; }
  const wh = await fetch('https://discord.com/api/v10/webhooks/' + cfg.WEBHOOK_ID + '/' + cfg.WEBHOOK_TOKEN);
  console.log('HTTP ' + wh.status + (wh.ok ? ' - webhook is valid' : ' - webhook is bad/deleted'));
})().catch((e) => console.error(e));
