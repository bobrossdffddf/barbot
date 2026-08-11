const {
  Client, GatewayIntentBits, Events, Routes,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { buildCards } = require('./card');
const { buildPortal, buildDocMessage } = require('./portal');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

const esc = (s) => String(s == null ? '' : s).replace(/`/g, 'ʼ');
const img = (url) => ({ type: 12, items: [{ media: { url } }] });

const STORE = path.join(__dirname, cfg.BAR_NUMBER_FILE);

function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { return {}; }
}

function saveStore(data) {
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function barNumberFor(userId) {
  const store = loadStore();
  if (store[userId]) return store[userId];
  const taken = new Set(Object.values(store));
  let n;
  do {
    n = String(Math.floor(1000000 + Math.random() * 9000000));
  } while (taken.has(n));
  store[userId] = n;
  saveStore(store);
  return n;
}

function applicantNumber() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function longDate() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function monthName() {
  return new Date().toLocaleDateString('en-US', { month: 'long' });
}

client.once(Events.ClientReady, (c) => {
  console.log('Logged in as ' + c.user.tag);
  checkConfig();
  poll();
  setInterval(poll, cfg.POLL_INTERVAL_MS);
});

function checkConfig() {
  const bad = [];
  if (String(cfg.GUILD_ID).indexOf('PASTE') === 0) bad.push('GUILD_ID');
  if (String(cfg.WEBHOOK_ID).indexOf('PASTE') === 0) bad.push('WEBHOOK_ID');
  if (String(cfg.WEBHOOK_TOKEN).indexOf('PASTE') === 0) bad.push('WEBHOOK_TOKEN');
  cfg.APPS_SCRIPT_URLS.forEach((u, i) => {
    if (String(u).indexOf('PASTE') === 0) bad.push('APPS_SCRIPT_URLS[' + i + ']');
    else if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(u)) {
      console.warn('WARNING: APPS_SCRIPT_URLS[' + i + '] does not look like a Web App /exec URL: ' + u);
    }
  });
  if (bad.length) console.error('CONFIG NOT FILLED IN: ' + bad.join(', '));
  console.log('Polling ' + cfg.APPS_SCRIPT_URLS.length + ' URL(s) every ' + (cfg.POLL_INTERVAL_MS / 1000) + 's');
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) return onButton(interaction);
    if (interaction.isModalSubmit()) return onModal(interaction);
    if (interaction.isStringSelectMenu()) return onSelect(interaction);
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'Something went wrong.', ...EPHEMERAL }).catch(() => {});
    }
  }
});

async function poll() {
  for (const url of cfg.APPS_SCRIPT_URLS) await drain(url);
}

async function drain(url) {
  let body;
  try {
    const res = await fetch(url + '?secret=' + encodeURIComponent(cfg.POLL_SECRET), { redirect: 'follow' });
    const text = await res.text();
    if (!res.ok) {
      console.error('POLL HTTP ' + res.status + ' from ' + url);
      console.error('  body starts: ' + text.slice(0, 200));
      return;
    }
    if (text.trim().startsWith('<')) {
      console.error('POLL got HTML instead of JSON. The Web App is probably not deployed with');
      console.error('  access = "Anyone", or the URL is wrong. URL: ' + url);
      return;
    }
    body = JSON.parse(text);
  } catch (e) {
    console.error('POLL FAILED for ' + url + ': ' + (e && e.message));
    return;
  }
  if (body.error) {
    console.error('POLL rejected: ' + body.error + ' (POLL_SECRET mismatch between config.js and the Apps Script?)');
    return;
  }
  if (body.items && body.items.length) {
    console.log('Found ' + body.items.length + ' new submission(s).');
  }
  for (const item of (body.items || [])) {
    try {
      await postCard(item.data);
      await fetch(url + '?secret=' + encodeURIComponent(cfg.POLL_SECRET) + '&ack=' + encodeURIComponent(item.id));
      console.log('Posted card for ' + (item.data.username || item.data.applicantId || 'applicant'));
    } catch (e) {
      console.error('post failed, retrying next cycle:', e && e.message);
    }
  }
}

async function postCard(data) {
  const url = 'https://discord.com/api/v10/webhooks/' + cfg.WEBHOOK_ID + '/' + cfg.WEBHOOK_TOKEN + '?with_components=true&wait=true';
  const pages = buildCards(data);
  for (let i = 0; i < pages.length; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pages[i])
    });
    if (!res.ok) throw new Error('webhook ' + res.status + ' ' + (await res.text()));
    if (pages.length > 1) console.log('  posted part ' + (i + 1) + '/' + pages.length);
  }
}

function reviewerAllowed(interaction) {
  if (!cfg.REVIEWER_ROLE_IDS.length) return true;
  const roles = interaction.member && interaction.member.roles;
  if (!roles) return false;
  const ids = roles.cache ? [...roles.cache.keys()] : roles;
  return cfg.REVIEWER_ROLE_IDS.some((r) => ids.includes(r));
}

async function onButton(interaction) {
  const [action, applicantId, username] = interaction.customId.split('|');
  if (action !== 'acc' && action !== 'den') return;
  if (!reviewerAllowed(interaction)) {
    return interaction.reply({ content: "You can't review applications.", ...EPHEMERAL });
  }
  const modal = new ModalBuilder()
    .setCustomId('m' + action + '|' + applicantId + '|' + (username || '') + '|' + interaction.message.id)
    .setTitle(action === 'acc' ? 'Pass Applicant' : 'Fail Applicant');
  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel(action === 'acc' ? 'Notes / reason for passing' : 'Reason for failing')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);
  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  await interaction.showModal(modal);
}

async function onModal(interaction) {
  const [tag, applicantId, usernameRaw, messageId] = interaction.customId.split('|');
  const action = tag.slice(1);
  if (action !== 'acc' && action !== 'den') return;

  await interaction.deferReply(EPHEMERAL);

  const rest = client.rest;
  const modId = interaction.user.id;
  const reason = (interaction.fields.getTextInputValue('reason') || '').trim() || 'No reason provided';
  const validId = /^\d{17,20}$/.test(applicantId);
  let username = '';
  try { username = decodeURIComponent(usernameRaw || ''); } catch (e) { username = usernameRaw || ''; }
  if (!username) username = validId ? '<@' + applicantId + '>' : 'Applicant';

  let original;
  try {
    original = await rest.get(Routes.webhookMessage(cfg.WEBHOOK_ID, cfg.WEBHOOK_TOKEN, messageId));
  } catch (e) {
    return interaction.editReply('Could not load the original message (deleted?).');
  }

  const row = original.components.find((c) => c.type === 1);
  if (row && row.components[0] && row.components[0].disabled) {
    return interaction.editReply('This one was already handled.');
  }

  const accent = action === 'acc' ? cfg.ACCENT_ACCEPT : cfg.ACCENT_DENY;
  const footer = action === 'acc'
    ? '-# Passed by: <@' + modId + '>\n## `' + esc(reason) + '`'
    : '-# Failed by: <@' + modId + '>\n## `' + esc(reason) + '`';
  await editMessage(rest, messageId, accent, footer);

  const notes = [];
  let barNumber = null;

  if (action === 'acc' && validId) {
    barNumber = barNumberFor(applicantId);
    try {
      await rest.put(Routes.guildMemberRole(cfg.GUILD_ID, applicantId, cfg.ROLE_ON_PASS), {
        reason: 'Passed bar exam, approved by ' + interaction.user.tag
      });
      notes.push('Gave the role to <@' + applicantId + '>.');
    } catch (e) {
      notes.push('Could not add the role (permission / hierarchy).');
    }
    notes.push('Bar Number: ' + barNumber);
  } else if (action === 'acc') {
    notes.push('No valid Discord ID, no role or bar number issued.');
  }

  if (validId) {
    const dm = action === 'acc' ? passDM(username, barNumber) : failDM(username, reason);
    const ok = await dmUser(rest, applicantId, dm);
    notes.push(ok ? 'DMed them.' : 'Could not DM them (DMs closed?).');
  } else {
    notes.push('No valid Discord ID, not DMed.');
  }

  await interaction.editReply((action === 'acc' ? 'Passed.' : 'Failed.') + '\n' + notes.join('\n'));
}

function stripIds(components) {
  for (const c of components) {
    delete c.id;
    if (Array.isArray(c.components)) stripIds(c.components);
  }
}

async function editMessage(rest, messageId, accent, footerLine) {
  const route = Routes.webhookMessage(cfg.WEBHOOK_ID, cfg.WEBHOOK_TOKEN, messageId);
  const msg = await rest.get(route);
  const container = msg.components.find((c) => c.type === 17);
  const row = msg.components.find((c) => c.type === 1);
  if (container) {
    container.accent_color = accent;
    container.components.push({ type: 14, spacing: 2 });
    container.components.push({ type: 10, content: footerLine });
  }
  if (row) for (const b of row.components) { b.disabled = true; b.style = 2; }
  const out = [container, row].filter(Boolean);
  stripIds(out);
  await rest.patch(route, {
    body: { flags: 32768, components: out },
    query: new URLSearchParams({ with_components: 'true' })
  });
}

async function dmUser(rest, userId, components) {
  try {
    const dm = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
    await rest.post(Routes.channelMessages(dm.id), { body: { flags: 32768, components } });
    return true;
  } catch (e) {
    console.error('DM failed:', e && e.message);
    return false;
  }
}

function passDM(username, barNumber) {
  const body = '## ' + cfg.BOARD_NAME + '\n\n' +
    '-# Date: ' + longDate() + '\n' +
    '-# Applicant Number: #' + applicantNumber() + '\n\n' +
    '**Result: PASSED**\n\n' +
    '**CONFIDENTIAL DETERMINATION OF BAR EXAMINATION RESULTS**\n' +
    '>>> Dear ' + username + '\n' +
    'We are pleased to inform you that you have successfully passed the ' + monthName() + ' ' + cfg.EXAM_YEAR +
    ' General Bar Examination for this jurisdiction. Your total scaled score met or exceeded the minimum passing score threshold required by this Board. ' +
    'Pursuant to Board policy, individual sub-scores for essays and performance tests are not released to successful applicants. \n\n' +
    'Congratulations on achieving this monumental milestone in your professional career! \n\n' +
    'Your assigned Bar Number (BN) is: `' + barNumber + '`\n\n' +
    'Sincerely, \nExecutive Director ' + cfg.BOARD_NAME;

  return [{
    type: 17,
    components: [
      img(cfg.HEADER_IMAGE),
      { type: 10, content: '# Bar Exam Results\n' },
      { type: 14 },
      { type: 10, content: body },
      { type: 14 },
      img(cfg.FOOTER_IMAGE)
    ]
  }];
}

function failDM(username, reason) {
  const body = '## ' + cfg.BOARD_NAME + '\n\n' +
    '>>> -# Date: ' + longDate() + '\n' +
    '-# Applicant Number: #' + applicantNumber() + '\n\n' +
    '**Result: FAILED**\n\n' +
    'Dear ' + username + ',\n' +
    'We regret to inform you that you did not achieve the minimum passing score required on the ' +
    monthName() + ' ' + cfg.EXAM_YEAR + ' General Bar Examination.\n\n' +
    'REASON: `' + esc(reason) + '`\n\n' +
    'Please feel free to reapply at any time. \n\n' +
    'Sincerely,\n' + cfg.BOARD_NAME;

  return [{
    type: 17,
    components: [
      img(cfg.HEADER_IMAGE),
      { type: 10, content: '# Bar Exam Results\n' },
      { type: 14 },
      { type: 10, content: body },
      { type: 14 },
      img(cfg.FOOTER_IMAGE)
    ]
  }];
}


client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== cfg.DOCS_COMMAND.toLowerCase()) return;
  if (message.author.id !== cfg.OWNER_ID) return;
  try {
    await message.channel.send(buildPortal());
    if (message.deletable) await message.delete().catch(() => {});
  } catch (err) {
    console.error('portal send failed:', err && err.message);
  }
});

async function onSelect(interaction) {
  if (!interaction.customId.startsWith('doc:')) return;
  const code = interaction.values[0];
  const doc = buildDocMessage(code);
  if (!doc) {
    return interaction.reply({ content: 'That document is not available.', ...EPHEMERAL });
  }

  const filePath = path.join(cfg.DOCS_ROOT, doc.folder, doc.file);
  if (!fs.existsSync(filePath)) {
    console.error('missing file: ' + filePath);
    return interaction.reply({ content: 'That file is missing on the server.', ...EPHEMERAL });
  }

  const body = { ...doc.payload, files: [new AttachmentBuilder(filePath, { name: doc.name })] };
  if (cfg.DOCS_EPHEMERAL) body.flags = doc.payload.flags | MessageFlags.Ephemeral;

  try {
    await interaction.reply(body);
  } catch (err) {
    console.error('doc reply failed:', err && err.message);
    if (!interaction.replied) interaction.reply({ content: 'Could not send that document.', ...EPHEMERAL }).catch(() => {});
  }
}

client.login(cfg.BOT_TOKEN);
