const { REST, Routes } = require('discord.js');
const cfg = require('./config');

(async () => {
  const rest = new REST({ version: '10' }).setToken(cfg.BOT_TOKEN);
  const wh = await rest.post(Routes.channelWebhooks(cfg.REVIEW_CHANNEL_ID), { body: { name: 'Bar Exam' } });
  console.log('WEBHOOK_ID    ' + wh.id);
  console.log('WEBHOOK_TOKEN ' + wh.token);
})().catch((e) => { console.error(e); process.exit(1); });
