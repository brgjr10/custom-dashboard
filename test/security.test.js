'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, runToExit, basicHeader } = require('./helpers');

const PORT = 18100;

test('server refuses to start when AUTH_USER/AUTH_PASS are unset (fail closed)', async () => {
  const { code, stderr } = await runToExit({ AUTH_USER: '', AUTH_PASS: '', ALLOW_ANONYMOUS: 'false' }, PORT + 90);
  assert.strictEqual(code, 1, `expected exit 1, got ${code}. stderr=${stderr}`);
  assert.match(stderr, /AUTH_USER and AUTH_PASS/);
  assert.match(stderr, /ALLOW_ANONYMOUS=true/);
});

test('ALLOW_ANONYMOUS=true is the explicit opt-in for open mode', async () => {
  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, PORT + 91);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT + 91}/api/network`);
    assert.strictEqual(res.status, 200);
  } finally {
    await server.stop();
  }
});

test('auth covers the API and the static assets, and accepts a password containing ":"', async () => {
  const server = await startServer({ AUTH_USER: 'qauser', AUTH_PASS: 'qapass:123' }, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  try {
    assert.strictEqual((await fetch(`${base}/api/health`)).status, 200, '/api/health is the documented health-probe exception');
    assert.strictEqual((await fetch(`${base}/api/network`)).status, 401);

    // The static mount used to run before auth, so every asset was public.
    const index = await fetch(`${base}/`);
    assert.strictEqual(index.status, 401);
    const configJs = await fetch(`${base}/js/config.js`);
    assert.strictEqual(configJs.status, 401);
    const css = await fetch(`${base}/css/dashboard.css`);
    assert.strictEqual(css.status, 401);

    const auth = { Authorization: basicHeader('qauser', 'qapass:123') };
    assert.strictEqual((await fetch(`${base}/api/network`, { headers: auth })).status, 200);
    assert.strictEqual((await fetch(`${base}/`, { headers: auth })).status, 200);

    const wrong = { Authorization: basicHeader('qauser', 'qapass') };
    assert.strictEqual((await fetch(`${base}/api/network`, { headers: wrong })).status, 401);
  } finally {
    await server.stop();
  }
});

test('security headers are present (CUSTOMDASH-011)', async () => {
  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, PORT + 92);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT + 92}/`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  } finally {
    await server.stop();
  }
});

function listener(port) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => {
    srv.listen(port, '127.0.0.1', () => resolve({ srv, hits }));
  });
}

test('SSRF: a caller-supplied upstream host outside the allow-list is refused', async () => {
  const evidence = await listener(PORT + 80);
  const server = await startServer({ ALLOW_ANONYMOUS: 'true', UPTIME_KUMA_ALLOWED_HOSTS: '' }, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  try {
    for (const route of ['uptime-kuma', 'pihole']) {
      const res = await fetch(`${base}/api/${route}?baseUrl=${encodeURIComponent(`http://127.0.0.1:${PORT + 80}`)}`);
      assert.strictEqual(res.status, 400, `${route} should refuse a non-allow-listed host`);
      const body = await res.json();
      assert.match(body.error, /not allowed/);
    }
    assert.deepStrictEqual(evidence.hits, [], 'the evidence listener must not be contacted at all');
  } finally {
    await server.stop();
    evidence.srv.close();
  }
});

test('SSRF: non-http schemes and the cloud metadata address are refused', async () => {
  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, PORT + 93);
  const base = `http://127.0.0.1:${PORT + 93}`;
  try {
    const payloads = [
      'file:///etc/passwd',
      'gopher://127.0.0.1:11211/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]:9000/',
      'not a url'
    ];
    for (const target of payloads) {
      const res = await fetch(`${base}/api/pihole?baseUrl=${encodeURIComponent(target)}`);
      assert.strictEqual(res.status, 400, `expected refusal for ${target}`);
    }
  } finally {
    await server.stop();
  }
});