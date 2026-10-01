'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, basicHeader } = require('./helpers');

const REPO_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// The values themselves are never asserted or printed; only their presence matters.
function readDotenvSecrets() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return [];
  const secrets = [];
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!/(TOKEN|KEY|PASS|SECRET)/.test(key)) continue;
    if (value.length < 8) continue;
    secrets.push({ key, value });
  }
  return secrets;
}

test('no credential from .env appears in any file served from public/ (CUSTOMDASH-001)', () => {
  const secrets = readDotenvSecrets();
  const files = walk(PUBLIC_DIR);
  assert.ok(files.length > 0, 'expected files under public/');

  const offenders = [];
  for (const file of files) {
    const contents = fs.readFileSync(file, 'utf8');
    for (const secret of secrets) {
      if (contents.includes(secret.value)) {
        offenders.push(`${path.relative(REPO_ROOT, file)} contains the value of ${secret.key}`);
      }
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('; '));
});

test('the frontend no longer carries or transmits Uptime Kuma / Pi-hole credentials', () => {
  const files = ['js/config.js', 'js/widgets.js', 'js/app.js'];
  for (const rel of files) {
    const contents = fs.readFileSync(path.join(PUBLIC_DIR, rel), 'utf8');
    assert.ok(!/apiKey\s*:\s*['"][^'"]+['"]/.test(contents), `${rel} hardcodes an apiKey`);
    assert.ok(!/password\s*:\s*['"][^'"]+['"]/.test(contents), `${rel} hardcodes a password`);
    assert.ok(!/password=/.test(contents), `${rel} puts a password in a URL`);
  }
});

test('no secret is served over HTTP from public/', async () => {
  const secrets = readDotenvSecrets();
  const server = await startServer({ AUTH_USER: 'u', AUTH_PASS: 'p' }, 18300);
  const headers = { Authorization: basicHeader('u', 'p') };
  try {
    for (const rel of ['/js/config.js', '/js/widgets.js', '/js/app.js', '/']) {
      const body = await (await fetch(`http://127.0.0.1:18300${rel}`, { headers })).text();
      for (const secret of secrets) {
        assert.ok(!body.includes(secret.value), `${rel} served the value of ${secret.key}`);
      }
    }
  } finally {
    await server.stop();
  }
});

test('every served asset requires authentication', async () => {
  const server = await startServer({ AUTH_USER: 'u', AUTH_PASS: 'p' }, 18301);
  try {
    for (const rel of ['/', '/index.html', '/js/config.js', '/js/app.js', '/js/widgets.js', '/css/dashboard.css']) {
      const res = await fetch(`http://127.0.0.1:18301${rel}`);
      assert.strictEqual(res.status, 401, `${rel} must not be public`);
    }
  } finally {
    await server.stop();
  }
});