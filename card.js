const cfg = require('./config');

const MAX_COMPONENTS = 40;
const MAX_TOTAL_TEXT = 4000;
// The last message gets "Accepted/Denied by + reason" appended when reviewed,
// so every page leaves room for it rather than risking an oversized edit.
const PAGE_TEXT_BUDGET = 2700;
const MAX_ANSWER_CHARS = 1500;

const esc = (s) => String(s == null ? '' : s).replace(/`/g, 'ʼ');
const img = (url) => ({ type: 12, items: [{ media: { url } }] });

function plainAnswer(value) {
  if (Array.isArray(value)) value = value.map((v) => (Array.isArray(v) ? v.join(' / ') : v)).join(', ');
  if (value === null || value === undefined || value === '') return 'No answer';
  return String(value);
}

function wrapAnswer(text) {
  if (text.indexOf('\n') !== -1) return '```\n' + text.replace(/```/g, 'ʼʼʼ') + '\n```';
  return '`' + text.replace(/`/g, 'ʼ') + '`';
}

function countAll(components) {
  let n = 0;
  (function walk(a) { for (const c of a) { n++; if (c.components) walk(c.components); } })(components);
  return n;
}

function totalText(components) {
  let n = 0;
  (function walk(a) {
    for (const c of a) {
      if (typeof c.content === 'string') n += c.content.length;
      if (c.components) walk(c.components);
    }
  })(components);
  return n;
}

function buildLines(answers) {
  return (answers || []).map((qa, i) => {
    let a = plainAnswer(qa.a);
    if (a.length > MAX_ANSWER_CHARS) a = a.slice(0, MAX_ANSWER_CHARS - 3) + '...';
    return '### Q' + (i + 1) + ': ' + esc(qa.q) + '\n' + wrapAnswer(a);
  });
}

function paginate(lines, firstBudget) {
  const pages = [];
  let cur = [];
  let len = 0;
  let budget = firstBudget;

  const push = () => { if (cur.length) { pages.push(cur); cur = []; len = 0; budget = PAGE_TEXT_BUDGET; } };

  for (let line of lines) {
    while (line.length > budget) {
      push();
      if (line.length > PAGE_TEXT_BUDGET) {
        pages.push([line.slice(0, PAGE_TEXT_BUDGET - 4) + '...']);
        line = '...' + line.slice(PAGE_TEXT_BUDGET - 4);
      }
    }
    if (len + line.length > budget || cur.length * 2 >= MAX_COMPONENTS - 12) push();
    cur.push(line);
    len += line.length;
  }
  push();
  return pages.length ? pages : [[]];
}

function buildCards(data) {
  const hasPing = !!(cfg.PING_ROLE_IDS && cfg.PING_ROLE_IDS.length);
  const pingText = hasPing ? cfg.PING_ROLE_IDS.map((id) => '<@&' + id + '>').join(' ') : '';
  const titleText = '# Bar Exam Application\nA new bar exam application has been submitted.';
  const formText = '## Form: `' + esc(data.formName) + '`';

  const firstBudget = PAGE_TEXT_BUDGET - titleText.length - formText.length - pingText.length;
  const pages = paginate(buildLines(data.answers), Math.max(400, firstBudget));

  const ctx = (data.applicantId || '0') + '|' + encodeURIComponent(data.username || '');

  return pages.map((lines, idx) => {
    const first = idx === 0;
    const last = idx === pages.length - 1;

    const container = { type: 17, components: [] };
    if (first) {
      container.components.push(img(cfg.HEADER_IMAGE));
      container.components.push({ type: 10, content: titleText });
      container.components.push({ type: 14, spacing: 2 });
      container.components.push({ type: 10, content: formText });
    } else {
      container.components.push({ type: 10, content: '-# continued (' + (idx + 1) + '/' + pages.length + ')' });
    }

    const useSeparators = lines.length * 2 + container.components.length + 6 <= MAX_COMPONENTS;
    if (useSeparators) {
      for (const line of lines) {
        container.components.push({ type: 14, spacing: 2 });
        container.components.push({ type: 10, content: line });
      }
    } else {
      container.components.push({ type: 14, spacing: 2 });
      container.components.push({ type: 10, content: lines.join('\n\n') });
    }

    if (last) {
      container.components.push({ type: 14, spacing: 2 });
      container.components.push(img(cfg.FOOTER_IMAGE));
    }

    const components = [];
    if (first && hasPing) components.push({ type: 10, content: pingText });
    components.push(container);
    if (last) {
      components.push({
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Pass', custom_id: 'acc|' + ctx },
          { type: 2, style: 4, label: 'Fail', custom_id: 'den|' + ctx }
        ]
      });
    }

    return {
      flags: 32768,
      components,
      allowed_mentions: { parse: [], roles: first ? (cfg.PING_ROLE_IDS || []) : [] }
    };
  });
}

module.exports = { buildCards, countAll, totalText, esc, img };
