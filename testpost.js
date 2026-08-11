const cfg = require('./config');
const { buildCards, countAll, totalText } = require('./card');

(async () => {
  const url = cfg.APPS_SCRIPT_URLS[0];
  const res = await fetch(url + '?secret=' + encodeURIComponent(cfg.POLL_SECRET), { redirect: 'follow' });
  const body = JSON.parse(await res.text());
  const items = body.items || [];
  console.log('queued items: ' + items.length);
  if (!items.length) return console.log('Nothing to post.');

  const data = items[0].data;
  console.log('questions: ' + (data.answers || []).length);
  const pages = buildCards(data);
  console.log('messages to send: ' + pages.length);
  pages.forEach((p, i) => console.log('  part ' + (i + 1) + ': ' + countAll(p.components) + ' components, ' + totalText(p.components) + ' chars'));

  const wh = 'https://discord.com/api/v10/webhooks/' + cfg.WEBHOOK_ID + '/' + cfg.WEBHOOK_TOKEN + '?with_components=true';
  for (let i = 0; i < pages.length; i++) {
    const post = await fetch(wh, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pages[i]) });
    console.log('part ' + (i + 1) + ' -> HTTP ' + post.status);
    if (!post.ok) return console.log('FAILED body: ' + (await post.text()));
  }
  console.log('SUCCESS - check the channel. (Not acked, the bot will post it again.)');
})().catch((e) => console.error(e));
