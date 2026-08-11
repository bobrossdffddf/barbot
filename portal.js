const cfg = require('./config');
const categories = require('./documents');

const DEFAULTS = {
  DOCS_HEADER_IMAGE: 'https://i.postimg.cc/YCr6SqzZ/0ccv5GF8Pmc.png',
  DOCS_FOOTER_IMAGE: 'https://i.postimg.cc/8zpRCPbD/pu-YSe51XWEw.png',
  DOCS_EMOJI: '<:unknown:1533574438665195560>'
};
const opt = (k) => cfg[k] || DEFAULTS[k];

const img = (url) => ({ type: 12, items: [{ media: { url } }] });

function findDoc(code) {
  for (const cat of categories) {
    const item = cat.items.find((i) => i.code === code);
    if (item) return { cat, item };
  }
  return null;
}

function safeName(file) {
  return file.replace(/\s+/g, '_');
}

function buildPortal() {
  const container = {
    type: 17,
    components: [
      img(opt('DOCS_HEADER_IMAGE')),
      { type: 14, spacing: 2 },
      {
        type: 10,
        content: '# ' + opt('DOCS_EMOJI') + ' Documents & Forms\n>>> Welcome to the Florida State Government Documents & Form portal. ' +
          'Please find the appropriate document or form. All forms are in PDF format and are able to be edited after downloading. '
      }
    ]
  };

  for (const cat of categories) {
    container.components.push({ type: 14 });
    container.components.push({ type: 10, content: '### ' + cat.heading });
    container.components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: 'doc:' + cat.key,
        placeholder: cat.placeholder,
        min_values: 1,
        max_values: 1,
        options: cat.items.map((i) => {
          const o = { label: i.label, value: i.code };
          if (i.short) o.description = i.short.slice(0, 100);
          return o;
        })
      }]
    });
  }

  container.components.push({ type: 14, spacing: 2 });
  container.components.push(img(opt('DOCS_FOOTER_IMAGE')));

  return { flags: 32768, components: [container] };
}

function buildDocMessage(code) {
  const found = findDoc(code);
  if (!found) return null;
  const { item } = found;

  return {
    payload: {
      flags: 32768,
      components: [{
        type: 17,
        components: [
          img(opt('DOCS_HEADER_IMAGE')),
          { type: 14, spacing: 2 },
          { type: 10, content: '# ' + opt('DOCS_EMOJI') + ' ' + item.label + '\n' },
          { type: 10, content: item.desc },
          { type: 14, spacing: 2 },
          { type: 13, file: { url: 'attachment://' + safeName(item.file) } },
          { type: 14, spacing: 2 },
          img(opt('DOCS_FOOTER_IMAGE'))
        ]
      }]
    },
    file: item.file,
    folder: found.cat.folder,
    name: safeName(item.file)
  };
}

module.exports = { buildPortal, buildDocMessage, findDoc, safeName, categories };
