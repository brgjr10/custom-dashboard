'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

// config.js is a browser ES module; copy it to a .mjs so Node can import it directly
// under the repo's CommonJS package.json.
async function loadConfigModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-test-'));
  const target = path.join(dir, 'config.mjs');
  fs.writeFileSync(target, fs.readFileSync(path.join(PUBLIC_JS, 'config.js'), 'utf8'), 'utf8');
  const mod = await import(`file://${target.replace(/\\/g, '/')}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return mod;
}

test('escapeHtml neutralises the payloads that broke out of the link editor (CUSTOMDASH-006)', async () => {
  const { escapeHtml } = await loadConfigModule();
  const payloads = [
    '"><img src=x onerror="window.__pwnedReal=1">',
    "'><svg/onload=alert(1)>",
    '"><a onmouseover="window.__xss4=1">click</a>',
    '</span><script>alert(1)</script>'
  ];
  for (const payload of payloads) {
    const escaped = escapeHtml(payload);
    assert.ok(!escaped.includes('<'), `< left unescaped in: ${escaped}`);
    assert.ok(!escaped.includes('>'), `> left unescaped in: ${escaped}`);
    assert.ok(!escaped.includes('"'), `" left unescaped in: ${escaped}`);
    assert.ok(!escaped.includes("'"), `' left unescaped in: ${escaped}`);
  }
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

test('sanitizeUrl rejects javascript: and data: but keeps real links', async () => {
  const { sanitizeUrl } = await loadConfigModule();
  assert.strictEqual(sanitizeUrl('javascript:alert(1)'), '#');
  assert.strictEqual(sanitizeUrl('JavaScript:alert(1)'), '#');
  assert.strictEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '#');
  assert.strictEqual(sanitizeUrl('vbscript:msgbox(1)'), '#');
  assert.strictEqual(sanitizeUrl('https://example.com/x'), 'https://example.com/x');
  assert.strictEqual(sanitizeUrl('http://192.168.4.90:3001'), 'http://192.168.4.90:3001');
  assert.strictEqual(sanitizeUrl('example.com'), 'http://example.com');
  assert.strictEqual(sanitizeUrl(''), '#');
});

test('the widget sources no longer interpolate untrusted values into innerHTML unescaped', () => {
  const widgets = fs.readFileSync(path.join(PUBLIC_JS, 'widgets.js'), 'utf8');
  const app = fs.readFileSync(path.join(PUBLIC_JS, 'app.js'), 'utf8');

  // LinksWidget: href and label must both go through the helpers.
  assert.match(widgets, /href="\$\{escapeHtml\(sanitizeUrl\(link\.url\)\)\}"/);
  assert.match(widgets, /class="link-label">\$\{escapeHtml\(link\.label\)\}/);

  // Link editor inputs are attribute contexts.
  assert.match(app, /class="link-label-input" value="\$\{escapeHtml\(link\.label\)\}"/);
  assert.match(app, /class="link-url-input" value="\$\{escapeHtml\(link\.url\)\}"/);

  // No bare interpolation of a link field remains.
  assert.ok(!/value="\$\{link\.(label|url)/.test(app), 'app.js still interpolates link fields raw');
  assert.ok(!/href="\$\{link\.url\}"/.test(widgets), 'widgets.js still interpolates link.url raw');
});

test('addWidget(type, overrides) returns a well-formed widget (CUSTOMDASH-009)', async () => {
  const { addWidget, getWidgets, DEFAULT_CONFIG } = await loadConfigModule();
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  // Seed the module's config through the exported mutable binding's default.
  global.document = { documentElement: { setAttribute: () => {} }, getElementById: () => null };
  assert.ok(Array.isArray(DEFAULT_CONFIG.widgets));

  const widget = addWidget('weather', { city: 'Bend' });
  assert.strictEqual(typeof widget, 'object', 'addWidget must return the created widget');
  assert.strictEqual(widget.type, 'weather');
  assert.strictEqual(widget.city, 'Bend');
  assert.match(widget.id, /^weather-\d+$/);
  assert.strictEqual(widget.enabled, true);
  assert.ok(typeof widget.order === 'number');
  assert.strictEqual(widget.title, 'Weather');

  // The bare string that used to be persisted must no longer be accepted by getWidgets.
  const raw = JSON.parse(store['dashboard-config']);
  raw.widgets.push('weather', 'links');
  store['dashboard-config'] = JSON.stringify(raw);
  const widgets = getWidgets();
  assert.ok(widgets.every(w => w && typeof w === 'object'), 'getWidgets must skip junk entries');
});

test('loadConfig preserves an unreadable stored layout instead of wiping it (CUSTOMDASH-029)', async () => {
  const { loadConfig, saveConfig, DEFAULT_CONFIG } = await loadConfigModule();
  const store = { 'dashboard-config': '{' };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  loadConfig();
  const backupKey = Object.keys(store).find(k => k.startsWith('dashboard-config.corrupt.'));
  assert.ok(backupKey, 'the corrupt value should be kept under a dated key');
  assert.strictEqual(store[backupKey], '{');
  assert.deepStrictEqual(JSON.parse(store['dashboard-config']).widgets, DEFAULT_CONFIG.widgets);
  assert.ok(saveConfig);
});