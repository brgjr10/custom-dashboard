'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, basicHeader } = require('./helpers');

const PORT = 18200;

function listener(port) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization || null, body: '' });
    let body = '';
    req.on('data', (c) => { body += c.toString(); });
    req.on('end', () => {
      hits[hits.length - 1].body = body;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    srv.listen(port, '127.0.0.1', () => resolve({ srv, hits }));
  });
}

test('SSRF: an explicitly allow-listed private host IS reachable (allow-list is not a blanket block)', async () => {
  const evidence = await listener(PORT + 80);
  const server = await startServer({
    ALLOW_ANONYMOUS: 'true',
    UPTIME_KUMA_ALLOWED_HOSTS: '127.0.0.1',
    PIHOLE_ALLOWED_HOSTS: '127.0.0.1',
    ALLOW_PRIVATE_UPSTREAM: 'true',
    UPTIME_KUMA_API_KEY: 'server-side-key',
    PIHOLE_PASSWORD: 'server-side-password'
  }, PORT);
  const base = `http://127.0.0.1:${PORT}`;
  try {
    const kuma = await fetch(`${base}/api/uptime-kuma?mode=metrics&slug=s`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${PORT + 80}` })
    });
    assert.strictEqual(kuma.status, 200);

    await fetch(`${base}/api/pihole`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${PORT + 80}` })
    });

    assert.ok(evidence.hits.length > 0, 'the allow-listed host should have been contacted');

    // The credential must be the server-side one, never a caller-supplied one.
    const metrics = evidence.hits.find((h) => h.url === '/metrics');
    assert.ok(metrics, 'metrics request expected');
    assert.strictEqual(
      metrics.auth,
      'Basic ' + Buffer.from(':server-side-key').toString('base64')
    );

    // The Pi-hole password is posted to the allow-listed host and never travels in the URL.
    const auth = evidence.hits.find((h) => h.url === '/api/auth');
    if (auth) assert.ok(!auth.url.includes('password'), 'secret must not appear in a URL');
  } finally {
    await server.stop();
    evidence.srv.close();
  }
});

test('a caller cannot override the server-side Uptime Kuma key or Pi-hole password', async () => {
  const evidence = await listener(PORT + 81);
  const server = await startServer({
    ALLOW_ANONYMOUS: 'true',
    UPTIME_KUMA_ALLOWED_HOSTS: '127.0.0.1',
    ALLOW_PRIVATE_UPSTREAM: 'true',
    UPTIME_KUMA_API_KEY: 'server-side-key'
  }, PORT + 1);
  const base = `http://127.0.0.1:${PORT + 1}`;
  try {
    await fetch(`${base}/api/uptime-kuma?mode=metrics&apiKey=ATTACKER`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${PORT + 81}`, apiKey: 'ATTACKER' })
    });
    const metrics = evidence.hits.find((h) => h.url === '/metrics');
    assert.ok(metrics, 'metrics request expected');
    assert.ok(!String(metrics.auth).includes('QVRUQUNNFUg'), 'the caller-supplied key must not be relayed');
    assert.strictEqual(
      metrics.auth,
      'Basic ' + Buffer.from(':server-side-key').toString('base64')
    );
  } finally {
    await server.stop();
    evidence.srv.close();
  }
});

test('static serving refuses repo files outside public/ (CUSTOMDASH-030 stays clean)', async () => {
  const server = await startServer({ AUTH_USER: 'u', AUTH_PASS: 'p' }, PORT + 2);
  const headers = { Authorization: basicHeader('u', 'p') };
  const base = `http://127.0.0.1:${PORT + 2}`;
  try {
    for (const target of ['/.git/config', '/package-lock.json', '/.env', '/../server.js', '/js/../server.js']) {
      const res = await fetch(`${base}${target}`, { headers });
      assert.strictEqual(res.status, 404, `${target} must not be served`);
      const body = await res.text();
      assert.ok(!body.includes('AUTH_PASS'), `${target} leaked content`);
    }
  } finally {
    await server.stop();
  }
});

test('POST /api/docker/:id rejects an unsanitised id before touching the socket', async () => {
  const server = await startServer({ ALLOW_ANONYMOUS: 'true' }, PORT + 3);
  const base = `http://127.0.0.1:${PORT + 3}`;
  try {
    // '.' and '..' segments are collapsed by URL normalisation before they reach the
    // router, so they are not listed here; everything below survives normalisation.
    const payloads = [
      '../../version',
      'a b',
      'abc\r\nHost: x',
      'abc\n',
      'abc%00',
      'abc?d=e',
      'abc/def',
      'container:name'
    ];
    for (const id of payloads) {
      const res = await fetch(`${base}/api/docker/${encodeURIComponent(id)}/start`, { method: 'POST' });
      assert.strictEqual(res.status, 400, `id "${id}" should be rejected with 400, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.error, 'Invalid container id');
    }
    const stats = await fetch(`${base}/api/docker/${encodeURIComponent('a b')}/stats`);
    assert.strictEqual(stats.status, 400);
  } finally {
    await server.stop();
  }
});

test('POST /api/docker/:id requires authentication', async () => {
  const server = await startServer({ AUTH_USER: 'u', AUTH_PASS: 'p' }, PORT + 4);
  const base = `http://127.0.0.1:${PORT + 4}`;
  try {
    const res = await fetch(`${base}/api/docker/abc123def456/start`, { method: 'POST' });
    assert.strictEqual(res.status, 401);
  } finally {
    await server.stop();
  }
});