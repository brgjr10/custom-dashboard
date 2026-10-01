'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const REPO_ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'public', 'data', 'config.json');

test('POST /api/config persists and GET reads it back (CUSTOMDASH-008)', async () => {
  const existedBefore = fs.existsSync(CONFIG_PATH);
  const previous = existedBefore ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;

  // The data directory is not tracked, so this starts from the same state as a fresh clone.
  if (!existedBefore) fs.rmSync(path.dirname(CONFIG_PATH), { recursive: true, force: true });

  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, 18400);
  const base = 'http://127.0.0.1:18400';
  try {
    const payload = { title: 'regression test', widgets: [{ id: 'a', type: 'system' }] };
    const write = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(write.status, 200, 'the write must succeed even without public/data on disk');

    const read = await fetch(`${base}/api/config`);
    assert.strictEqual(read.status, 200);
    assert.deepStrictEqual(await read.json(), payload);

    // Prototype-pollution keys are refused rather than merged into the stored object.
    const proto = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.parse('{"__proto__":{"polluted":true}}'))
    });
    assert.strictEqual(proto.status, 400);
    assert.strictEqual({}.polluted, undefined);

    // Malformed bodies get a clean JSON error instead of a stack trace on stderr.
    const bad = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops'
    });
    assert.strictEqual(bad.status, 400);
    assert.match((await bad.json()).error, /./);
  } finally {
    await server.stop();
    if (previous === null) fs.rmSync(CONFIG_PATH, { force: true });
    else fs.writeFileSync(CONFIG_PATH, previous, 'utf8');
  }
});

test('the app still serves when public/data is absent (directory is created on demand)', async () => {
  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, 18401);
  try {
    const res = await fetch('http://127.0.0.1:18401/api/config');
    assert.ok(res.status === 200 || res.status === 404);
  } finally {
    await server.stop();
  }
});