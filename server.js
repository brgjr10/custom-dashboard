const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { exec } = require('child_process');

try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, env vars must be set externally
}

const app = express();
const PORT = process.env.PORT || 4000;

const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS === 'true';
const AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);

app.disable('x-powered-by');

// Hand-rolled rather than helmet: the repo has only dotenv + express and the brief forbids
// adding dependencies. CSP is the real mitigation behind the innerHTML sinks.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net 'unsafe-inline'",
    "font-src 'self' data: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-src 'self' http: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  next();
}

app.use(securityHeaders);

// Auth covers the whole app, not just /api, and it runs before the body parser and the
// static mount so no asset can be fetched without credentials.
app.use(basicAuth);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public', { setHeaders: (res) => {
  // Query strings defeated the previous `$`-anchored regex, so `?v=` bumps silently
  // escaped the rule; the extension is read from the path instead.
  const ext = path.extname(res.req.path || '');
  if (['.css', '.js', '.html'].includes(ext) || (res.req.path || '').endsWith('/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}}));

const githubRequest = https.request;
const githubAgent = 'Custom-Dashboard';
const githubToken = process.env.GITHUB_TOKEN || '';

const apiCache = new Map();
const API_CACHE_MAX = 500;

function cacheGet(key, ttlMs) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  // Keys embed request input, so the map is capped and evicted in insertion order
  // rather than growing for the lifetime of the process.
  if (apiCache.size >= API_CACHE_MAX) {
    const oldest = apiCache.keys().next();
    if (!oldest.done) apiCache.delete(oldest.value);
  }
  apiCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function cacheClearPrefix(prefix) {
  for (const key of apiCache.keys()) {
    if (key.startsWith(prefix)) apiCache.delete(key);
  }
}

const cacheSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of apiCache) {
    if (now > entry.expiresAt) apiCache.delete(key);
  }
}, 60 * 1000);
cacheSweepTimer.unref();

function basicAuth(req, res, next) {
  // The container HEALTHCHECK needs an unauthenticated liveness signal, and this route
  // returns nothing but status and uptime.
  if (req.method === 'GET' && req.path === '/api/health') return next();
  if (!AUTH_ENABLED) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  // A password may legitimately contain ':', so only split on the first one.
  const sep = decoded.indexOf(':');
  const user = sep === -1 ? decoded : decoded.slice(0, sep);
  const pass = sep === -1 ? '' : decoded.slice(sep + 1);
  const ok = safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS);
  if (ok) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
  res.status(401).send('Invalid credentials');
}

// timingSafeEqual throws on length mismatch, which would itself leak the secret's length.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Async so a slow shell-out cannot stall the event loop (a blocking execSync here cost
// every concurrent request ~2.6s). Resolves to '' on failure, matching the old catch.
function runCommand(command, timeout = 5000) {
  return new Promise((resolve) => {
    exec(command, { encoding: 'utf8', timeout, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : stdout || '');
    });
  });
}

let disksCache = null;
let disksCacheAt = 0;
const DISKS_TTL = 30000;

async function getDisks() {
  if (disksCache && Date.now() - disksCacheAt < DISKS_TTL) {
    return disksCache;
  }
  const disks = await collectDisks();
  disksCache = disks;
  disksCacheAt = Date.now();
  return disks;
}

async function collectDisks() {
  const platform = os.platform();
  const disks = [];

  if (platform === 'win32') {
    try {
      const output = await runCommand('powershell -Command "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,Size,SizeRemaining,FileSystemType | ConvertTo-Json"');
      const volumes = JSON.parse(output);
      volumes.forEach(vol => {
        const size = vol.Size / 1024 / 1024 / 1024;
        const free = vol.SizeRemaining / 1024 / 1024 / 1024;
        const used = size - free;
        const percent = Math.round((used / size) * 100);
        disks.push({
          mount: `${vol.DriveLetter}:\\`,
          size: `${size.toFixed(1)}G`,
          used: `${used.toFixed(1)}G`,
          avail: `${free.toFixed(1)}G`,
          percent: isNaN(percent) ? 0 : percent,
          fstype: vol.FileSystemType || 'NTFS'
        });
      });
    } catch (e) {
      disks.push({
        mount: 'C:',
        size: 'N/A',
        used: 'N/A',
        avail: 'N/A',
        percent: 0,
        fstype: 'Unknown'
      });
    }
  } else {
    try {
      let dfOutput = '';

      try {
        dfOutput = await runCommand('nsenter -t 1 -m df -h -T');
      } catch (e) {
        dfOutput = '';
      }

      if (!dfOutput) {
        try {
          dfOutput = await runCommand('df -h -T');
        } catch (e) {
          dfOutput = '';
        }
      }

      if (dfOutput) {
        const lines = dfOutput.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length >= 7 && parts[6].startsWith('/')) {
            const size = parts[2];
            const used = parts[3];
            const avail = parts[4];
            
            let totalSize = size;
            if ((!size || size === '-' || isNaN(parseFloat(size))) && used && avail) {
              const usedVal = parseFloat(used);
              const availVal = parseFloat(avail);
              if (!isNaN(usedVal) && !isNaN(availVal)) {
                totalSize = (usedVal + availVal) + 'G';
              }
            }
            
            disks.push({
              device: parts[0],
              mount: parts[6],
              size: totalSize,
              used: used,
              avail: avail,
              percent: parseInt(parts[5]) || 0,
              fstype: parts[1] || 'Unknown'
            });
          }
        }
      }

      if (disks.length === 0) {
        disks.push({
          device: 'unknown',
          mount: '/',
          size: 'N/A',
          used: 'N/A',
          avail: 'N/A',
          percent: 0,
          fstype: 'Unknown'
        });
      }
    } catch (e) {
      disks.push({
        mount: '/',
        size: 'N/A',
        used: 'N/A',
        avail: 'N/A',
        percent: 0,
        fstype: 'Unknown'
      });
    }
  }

  return disks;
}

app.get('/api/system', async (req, res) => {
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    let cpuTemp = null;
    if (os.platform() !== 'win32') {
      try {
        const zones = fs.readdirSync('/sys/class/thermal');
        let bestZone = null;
        let bestScore = -1;

        for (const zone of zones) {
          if (!zone.startsWith('thermal_zone')) continue;
          const typePath = `/sys/class/thermal/${zone}/type`;
          const tempPath = `/sys/class/thermal/${zone}/temp`;

          if (!fs.existsSync(typePath) || !fs.existsSync(tempPath)) continue;

          const type = fs.readFileSync(typePath, 'utf8').trim().toLowerCase();
          const temp = parseInt(fs.readFileSync(tempPath, 'utf8').trim());

          if (isNaN(temp)) continue;

          let score = 0;
          if (type.includes('cpu')) score += 100;
          else if (type.includes('coretemp')) score += 90;
          else if (type.includes('x86')) score += 80;
          else if (type.includes('pch')) score += 50;
          else if (type.includes('acpi')) score += 40;
          else score += 10;

          if (score > bestScore) {
            bestScore = score;
            bestZone = temp;
          }
        }

        if (bestZone !== null) {
          cpuTemp = Math.round(bestZone / 1000);
        }
      } catch (e) {
        cpuTemp = null;
      }
    }

    res.json({
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        load: loadAvg[0].toFixed(2),
        usage: cpuUsage(cpus)
      },
      memory: {
        total: Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100,
        used: Math.round((totalMem - freeMem) / 1024 / 1024 / 1024 * 100) / 100,
        free: Math.round(freeMem / 1024 / 1024 / 1024 * 100) / 100,
        percent: Math.round(((totalMem - freeMem) / totalMem) * 100)
      },
      temp: cpuTemp,
      disks: await getDisks(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function cpuUsage(cpus) {
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  if (totalTick === 0) return 0;
  return Math.round(((totalTick - totalIdle) / totalTick) * 100);
}

app.get('/api/docker', async (req, res) => {
  const platform = os.platform();
  if (platform === 'win32') {
    return res.json({
      containers: [],
      error: 'Docker socket not available on Windows. Deploy to ZimaOS (Linux) to use this widget.'
    });
  }

  const socketPath = DOCKER_SOCKET;
  if (!fs.existsSync(socketPath)) {
    return res.json({
      containers: [],
      error: 'Docker socket not found. Is Docker installed and running?'
    });
  }

  try {
    const containers = await dockerRequest('GET', '/containers/json?all=true');
    res.json({ containers: Array.isArray(containers) ? containers : [] });
  } catch (e) {
    res.json({ containers: [], error: e.message });
  }
});

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

// Container ids and names may only contain these characters. Without this the value was
// interpolated straight into a request line, which allowed path traversal and request
// splitting against the daemon.
const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

function isValidContainerId(id) {
  return typeof id === 'string' && CONTAINER_ID_RE.test(id);
}

// http.request over the unix socket does the HTTP framing for us; the previous hand-rolled
// client concatenated the path into the request line and decoded chunked bodies per TCP
// segment, losing data whenever a chunk straddled a boundary.
function dockerRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(body) : null;
    const headers = { Host: 'localhost', Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }

    const req = http.request({ socketPath: DOCKER_SOCKET, path: apiPath, method, headers }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        const trimmed = data.trim();
        if (!trimmed) return resolve(null);
        try {
          resolve(JSON.parse(trimmed));
        } catch (e) {
          reject(new Error(`Failed to parse Docker response: ${e.message}`));
        }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Docker socket request timed out'));
    });
    req.on('error', (e) => reject(new Error(e.message || 'Docker socket error')));
    if (payload) req.write(payload);
    req.end();
  });
}

function containerAction(res, id, action) {
  if (!isValidContainerId(id)) {
    return res.status(400).json({ error: 'Invalid container id' });
  }
  dockerRequest('POST', `/containers/${id}/${action}`)
    .then(result => res.json({ success: true, result }))
    .catch(e => res.status(500).json({ error: e.message }));
}

app.post('/api/docker/:id/start', (req, res) => containerAction(res, req.params.id, 'start'));

app.post('/api/docker/:id/stop', (req, res) => containerAction(res, req.params.id, 'stop'));

app.post('/api/docker/:id/restart', (req, res) => containerAction(res, req.params.id, 'restart'));

// Each run moves 100MB down plus 10MB up to a third-party mirror, so results are cached
// and concurrent callers share one in-flight run instead of multiplying the cost.
const SPEEDTEST_TTL = 10 * 60 * 1000;
let speedtestInFlight = null;

app.get('/api/speedtest', async (req, res) => {
  const cached = cacheGet('speedtest', SPEEDTEST_TTL);
  if (cached) return res.json(cached);

  if (!speedtestInFlight) {
    speedtestInFlight = runSpeedtest()
      .finally(() => { speedtestInFlight = null; });
  }
  const result = await speedtestInFlight;
  if (result.error) {
    return res.json(result);
  }
  cacheSet('speedtest', result, SPEEDTEST_TTL);
  res.json(result);
});

async function runSpeedtest() {
  const testUrls = [
    { url: 'https://speed.hetzner.de/100MB.bin', size: 100 },
    { url: 'https://speed.hetzner.de/10MB.bin', size: 10 },
    { url: 'https://proof.ovh.net/files/10Mb.dat', size: 10 },
    { url: 'https://cachefly.cachefly.net/10mb.test', size: 10 }
  ];

  let download = null;
  let upload = null;
  let duration = null;
  let usedUrl = null;

  for (const test of testUrls) {
    try {
      const speed = await runSpeedTest(test.url, test.size);
      download = speed.mbps;
      duration = speed.duration;
      usedUrl = test.url;
      break;
    } catch (e) {
      continue;
    }
  }

  if (usedUrl) {
    try {
      const upSpeed = await runUploadTest(usedUrl, 10);
      upload = upSpeed.mbps;
      if (!duration) duration = upSpeed.duration;
    } catch (e) {
      // Upload test failed, continue without it
    }
  }

  if (download) {
    return {
      download,
      upload,
      duration: duration ? duration.toFixed(2) : null,
      url: usedUrl
    };
  }

  return {
    error: 'Speed test failed. Check network or try again.',
    fallback: true
  };
}

function runSpeedTest(url, expectedSizeMB) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 20000);

    // Certificate verification stays on: disabling it let a network-position attacker
    // fabricate the throughput figures this widget reports.
    https.get(url, { timeout: 15000 }, (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timeout);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      let received = 0;
      response.on('data', chunk => received += chunk.length);
      response.on('end', () => {
        clearTimeout(timeout);
        const duration = (Date.now() - start) / 1000;
        if (duration < 0.3) {
          return reject(new Error('Too fast'));
        }
        const bytesReceived = received;
        const bits = bytesReceived * 8;
        const mbps = bits / duration / 1000000;
        resolve({
          mbps: mbps.toFixed(2),
          duration
        });
      });
      response.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function runUploadTest(url, sizeMB) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 20000);

    const data = Buffer.alloc(sizeMB * 1024 * 1024);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length
      }
    }, (response) => {
      clearTimeout(timeout);
      const duration = (Date.now() - start) / 1000;
      if (duration < 0.3) {
        return reject(new Error('Too fast'));
      }
      const bits = data.length * 8;
      const mbps = bits / duration / 1000000;
      resolve({
        mbps: mbps.toFixed(2),
        duration
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}

app.get('/api/github/contributions', async (req, res) => {
  const user = req.query.user;
  if (!user) {
    return res.json({ error: 'Missing user parameter', weeks: [] });
  }
  if (!GITHUB_LOGIN_RE.test(String(user))) {
    return res.status(400).json({ error: 'Invalid GitHub username', weeks: [] });
  }

  try {
    const cacheKey = `github:contributions:${user}`;
    if (!req.query._) {
      const cached = cacheGet(cacheKey, 10 * 60 * 1000);
      if (cached) return res.json(cached);
    }

    const graphqlQuery = `query ($login: String!) {
      user(login: $login) {
        avatarUrl
        name
        bio
        location
        company
        url
        followers(first: 0) {
          totalCount
        }
        following(first: 0) {
          totalCount
        }
        repositories(first: 0) {
          totalCount
        }
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }`;

    // Variables rather than string interpolation, so ?user can never append fields to
    // the document the dashboard issues with the operator's token.
    const data = await makeGitHubGraphQLRequest(graphqlQuery, { login: user });
    if (data.error) {
      return res.json({ error: data.error, weeks: [] });
    }
    if (data.errors) {
      return res.json({ error: data.errors[0].message, weeks: [] });
    }
    if (!data.data || !data.data.user) {
      return res.json({ error: `GitHub returned no data for user "${user}"`, weeks: [] });
    }

    const userData = data.data.user;
    const weeks = userData.contributionsCollection?.contributionCalendar?.weeks || [];
    const payload = {
      weeks,
      user: {
        login: user,
        avatarUrl: userData.avatarUrl || '',
        name: userData.name || user,
        bio: userData.bio || '',
        location: userData.location || '',
        company: userData.company || '',
        url: userData.url || '',
        followersCount: userData.followers?.totalCount || 0,
        followingCount: userData.following?.totalCount || 0,
        publicReposCount: userData.repositories?.totalCount || 0
      }
    };

    cacheSet(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.json({ error: 'Failed to fetch GitHub contributions', weeks: [] });
  }
});

function makeGitHubGraphQLRequest(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query, variables });
    const headers = {
      'User-Agent': githubAgent,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (githubToken) {
      headers['Authorization'] = `bearer ${githubToken}`;
    }
    const options = {
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers
    };

    const req = githubRequest(options, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        // GitHub reports a bad or revoked token as a 401 body with `message`/`status`
        // and no `errors` array, which used to fall through as a successful empty result.
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let message = `GitHub API error: ${response.statusCode}`;
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.message) message = `GitHub API error: ${response.statusCode} - ${parsed.message}`;
          } catch (e) {
            // Keep the status-only message.
          }
          return resolve({ error: message });
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'Failed to parse response' });
        }
      });
    });

    req.on('error', () => resolve({ error: 'Failed to connect to GitHub' }));
    req.write(postData);
    req.end();
  });
}

// GitHub logins and repo names are interpolated into REST paths, so they are constrained
// to the characters GitHub itself allows.
const GITHUB_LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]{1,100}$/;

app.get('/api/github/activity', async (req, res) => {
  const user = req.query.user;
  const repo = req.query.repo;
  if (!user) {
    return res.json({ error: 'Missing user parameter', events: [] });
  }
  if (!GITHUB_LOGIN_RE.test(String(user))) {
    return res.status(400).json({ error: 'Invalid GitHub username', events: [] });
  }
  if (repo && !GITHUB_REPO_RE.test(String(repo))) {
    return res.status(400).json({ error: 'Invalid GitHub repository', events: [] });
  }

  try {
    const cacheKey = `github:activity:${user}:${repo || 'all'}`;
    if (!req.query._) {
      const cached = cacheGet(cacheKey, 2 * 60 * 1000);
      if (cached) return res.json(cached);
    }

    let data;
    if (repo) {
      data = await makeGitHubRequest(`/repos/${user}/${repo}/events?per_page=10`);
      if (data.error) {
        return res.json({ error: data.error, events: [] });
      }
      const payload = { events: data, user, repo };
      cacheSet(cacheKey, payload, 2 * 60 * 1000);
      res.json(payload);
    } else {
      data = await makeGitHubRequest(`/users/${user}/events/public?per_page=30`);
      if (data.error) {
        return res.json({ error: data.error, events: [] });
      }
      const payload = { events: data, user };
      cacheSet(cacheKey, payload, 2 * 60 * 1000);
      res.json(payload);
    }
  } catch (e) {
    res.json({ error: 'Failed to fetch GitHub activity', events: [] });
  }
});

function makeGitHubRequest(path) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': githubAgent,
      'Accept': 'application/vnd.github.v3+json'
    };
    if (githubToken) {
      headers['Authorization'] = `bearer ${githubToken}`;
    }
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers
    };

    const req = githubRequest(options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, 'https://api.github.com');
        response.resume();
        makeGitHubRequest(redirectUrl.pathname + redirectUrl.search)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        if (response.statusCode === 404) {
          resolve({ error: 'Repository not found' });
        } else if (response.statusCode === 403) {
          resolve({ error: 'GitHub API rate limit exceeded' });
        } else if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ error: 'Failed to parse response' });
          }
        } else {
          resolve({ error: `GitHub API error: ${response.statusCode}` });
        }
      });
    });

    req.on('error', () => resolve({ error: 'Failed to connect to GitHub' }));
    req.end();
  });
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: os.uptime() });
});

app.get('/api/network', (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const formatted = Object.entries(interfaces).map(([name, addrs]) => ({
      name,
      addresses: addrs.filter(addr => addr.family === 'IPv4').map(addr => ({
        address: addr.address,
        netmask: addr.netmask,
        mac: addr.mac,
        internal: addr.internal
      }))
    }));
    res.json({ interfaces: formatted, updated: Date.now() });
  } catch (e) {
    res.json({ error: 'Failed to fetch network info' });
  }
});

app.get('/api/geocode', async (req, res) => {
  const city = (req.query.city || '').trim();
  const state = (req.query.state || '').trim();
  if (!city) {
    return res.json({ error: 'Missing city parameter' });
  }
  try {
    const cacheKey = `geocode:${city}:${state}`;
    if (!req.query._) {
      const cached = cacheGet(cacheKey, 60 * 60 * 1000);
      if (cached) return res.json(cached);
    }

    const query = state ? `${city}, ${state}` : city;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Geocoding API error');
    const data = await response.json();
    const result = data.results?.[0];
    if (!result) {
      return res.json({ error: 'Location not found' });
    }
    const payload = {
      latitude: result.latitude,
      longitude: result.longitude,
      name: result.name,
      country: result.country
    };
    cacheSet(cacheKey, payload, 60 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.json({ error: 'Failed to geocode location' });
  }
});

app.get('/api/weather', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const city = (req.query.city || '').trim();
  const state = (req.query.state || '').trim();

  try {
    let resolvedLat = lat;
    let resolvedLon = lon;
    let cacheKey = null;

    if ((!isNaN(resolvedLat) && !isNaN(resolvedLon)) || (!city)) {
      if (isNaN(resolvedLat) || isNaN(resolvedLon)) {
        resolvedLat = 44.06;
        resolvedLon = -121.31;
      }
      cacheKey = `weather:${resolvedLat}:${resolvedLon}`;
    } else if (city) {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city + (state ? ', ' + state : ''))}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) throw new Error('Geocoding API error');
      const geoData = await geoRes.json();
      const result = geoData.results?.[0];
      if (!result) {
        return res.json({ error: 'Location not found' });
      }
      resolvedLat = result.latitude;
      resolvedLon = result.longitude;
      cacheKey = `weather:${resolvedLat}:${resolvedLon}`;
    }

    if (cacheKey && !req.query._) {
      const cached = cacheGet(cacheKey, 10 * 60 * 1000);
      if (cached) return res.json(cached);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${resolvedLat}&longitude=${resolvedLon}&current_weather=true`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Weather API error');
    const data = await response.json();
    const payload = {
      temperature: data.current_weather?.temperature || 0,
      windspeed: data.current_weather?.windspeed || 0,
      weathercode: data.current_weather?.weathercode || 0,
      updated: Date.now()
    };

    if (cacheKey) cacheSet(cacheKey, payload, 10 * 60 * 1000);
    res.json(payload);
  } catch (e) {
    res.json({ error: 'Failed to fetch weather data' });
  }
});

app.get('/api/docker/:id/stats', async (req, res) => {
  if (!isValidContainerId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid container id' });
  }
  try {
    const data = await dockerRequest('GET', `/containers/${req.params.id}/stats?stream=0`);
    if (!data) {
      return res.json({ error: 'No stats available' });
    }
    res.json(data);
  } catch (e) {
    res.json({ error: 'Failed to fetch container stats' });
  }
});

const CONFIG_PATH = path.join(__dirname, 'public', 'data', 'config.json');
// public/data is gitignored and absent from a fresh clone, so every write used to fail
// with a generic 500 that hid the ENOENT underneath.
const CONFIG_DIR = path.dirname(CONFIG_PATH);

app.get('/api/config', (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return res.status(404).json({ error: 'No server config found' });
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    console.error(`[config] read failed (${e.code || e.message}): ${CONFIG_PATH} - fix by checking permissions on ${CONFIG_DIR}`);
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Invalid config payload' });
    }
    if (Object.prototype.hasOwnProperty.call(payload, '__proto__') ||
        Object.prototype.hasOwnProperty.call(payload, 'constructor')) {
      return res.status(400).json({ error: 'Invalid config payload' });
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write cannot truncate the stored layout.
    const tmpPath = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpPath, CONFIG_PATH);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error(`[config] write failed (${e.code || e.message}): ${CONFIG_PATH} - fix by ensuring ${CONFIG_DIR} exists and is writable`);
    res.status(500).json({ error: 'Failed to write config' });
  }
});

// Uptime Kuma and Pi-hole are reached by the server on the caller's behalf, so the
// destination is chosen here, never from the request. A host is acceptable only if it is
// in that integration's allow-list; a caller-supplied host is otherwise refused outright,
// which is what stops this being an SSRF proxy for the network the server sits on.
function buildUpstreamHosts(envName, allowEnvName, builtinDefault) {
  const hosts = new Set();
  const add = (value) => {
    if (!value) return;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        hosts.add(parsed.hostname.toLowerCase());
      }
    } catch (e) {
      console.error(`[upstream] ignoring unparseable ${envName}: ${e.message}`);
    }
  };
  add(process.env[envName]);
  add(builtinDefault);
  String(process.env[allowEnvName] || '').split(',').forEach(h => hosts.add(h.trim().toLowerCase()));
  hosts.delete('');
  return hosts;
}

function isPrivateHostname(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true;
  const type = net.isIP(host);
  if (type === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (type === 6) {
    return host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('::ffff:127.') || host.startsWith('::ffff:10.') || host.startsWith('::ffff:192.168.');
  }
  return false;
}

function resolveUpstreamUrl(rawUrl, allowedHosts, allowEnvName) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    throw new Error('Invalid upstream URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Upstream URL must use http or https');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) {
    throw new Error(`Upstream host "${hostname}" is not allowed. Add it to ${allowEnvName} to permit it.`);
  }
  if (isPrivateHostname(hostname) && process.env.ALLOW_PRIVATE_UPSTREAM !== 'true') {
    throw new Error(`Upstream host "${hostname}" is a private address. Set ALLOW_PRIVATE_UPSTREAM=true to permit it.`);
  }
  return `${parsed.origin}`;
}

const UPTIME_KUMA_DEFAULT = 'http://192.168.4.90:3001';
const PIHOLE_DEFAULT = 'http://192.168.4.90';
const UPTIME_KUMA_HOSTS = buildUpstreamHosts('UPTIME_KUMA_BASE_URL', 'UPTIME_KUMA_ALLOWED_HOSTS', UPTIME_KUMA_DEFAULT);
const PIHOLE_HOSTS = buildUpstreamHosts('PIHOLE_BASE_URL', 'PIHOLE_ALLOWED_HOSTS', PIHOLE_DEFAULT);

// Secrets are read from the server environment only. They are never accepted from the
// request and never sent back to the browser, which is what keeps them out of proxy logs.
const uptimeKumaApiKey = process.env.UPTIME_KUMA_API_KEY || '';
const piholeSecret = process.env.PIHOLE_PASSWORD || process.env.PIHOLE_TOKEN || '';

async function handleUptimeKuma(req, res) {
  const requested = (req.body && req.body.baseUrl) || req.query.baseUrl;
  const slug = (req.body && req.body.slug) || req.query.slug || process.env.UPTIME_KUMA_SLUG || '';
  const mode = (req.body && req.body.mode) || req.query.mode || 'status';

  let baseUrl;
  try {
    baseUrl = resolveUpstreamUrl(requested || process.env.UPTIME_KUMA_BASE_URL || UPTIME_KUMA_DEFAULT, UPTIME_KUMA_HOSTS, 'UPTIME_KUMA_ALLOWED_HOSTS');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    if (mode === 'metrics' && uptimeKumaApiKey) {
      const metricsUrl = `${baseUrl}/metrics`;
      const metricsRes = await fetch(metricsUrl, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(':' + uptimeKumaApiKey).toString('base64')
        }
      });
      if (!metricsRes.ok) {
        return res.json({ error: `Uptime Kuma metrics failed: ${metricsRes.status}` });
      }
      const text = await metricsRes.text();
      const monitors = [];
      const lines = text.split('\n');
      for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        const braceIdx = line.indexOf('{');
        if (braceIdx === -1) continue;
        const key = line.substring(0, braceIdx).trim();
        const closeIdx = line.indexOf('}');
        if (closeIdx === -1) continue;
        const labelsStr = line.substring(braceIdx + 1, closeIdx);
        const valueStr = line.substring(closeIdx + 1).trim();
        const labels = {};
        for (const part of labelsStr.split(',')) {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) continue;
          const k = part.substring(0, eqIdx).trim();
          let v = part.substring(eqIdx + 1).trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          labels[k] = v;
        }
        if (key === 'monitor_status' || key === 'monitor_response_time') {
          const name = labels.monitor_name || '';
          if (!name) continue;
          let monitor = monitors.find(m => m.name === name);
          if (!monitor) {
            monitor = {
              name,
              type: labels.monitor_type || '',
              status: 'paused',
              responseTime: null
            };
            monitors.push(monitor);
          }
          if (key === 'monitor_status') {
            const statusMap = { '0': 'down', '1': 'up', '2': 'pending', '3': 'maintenance', '4': 'paused' };
            monitor.status = statusMap[valueStr] || 'paused';
          } else if (key === 'monitor_response_time') {
            monitor.responseTime = parseInt(valueStr, 10) || null;
          }
        }
      }
      return res.json({ monitors, updated: Date.now() });
    }

    if (!slug) {
      return res.json({ error: 'Missing slug parameter for status mode' });
    }

    const pageUrl = `${baseUrl}/api/status-page/${encodeURIComponent(slug)}`;
    const pageRes = await fetch(pageUrl);
    if (!pageRes.ok) {
      return res.json({ error: `Uptime Kuma status page failed: ${pageRes.status}` });
    }
    const pageData = await pageRes.json();

    const hbUrl = `${baseUrl}/api/status-page/heartbeat/${encodeURIComponent(slug)}`;
    const hbRes = await fetch(hbUrl);
    let heartbeatData = {};
    if (hbRes.ok) {
      heartbeatData = await hbRes.json();
    }

    const monitors = [];
    const groups = pageData.publicGroupList || [];
    for (const group of groups) {
      for (const mon of group.monitorList || []) {
        const id = String(mon.id);
        const hbList = heartbeatData.heartbeatList?.[id];
        const last = hbList && hbList.length > 0 ? hbList[hbList.length - 1] : null;
        const statusMap = { '1': 'up', '0': 'down', '2': 'pending', '3': 'maintenance' };
        const status = last ? (statusMap[String(last.status)] || 'unknown') : 'unknown';
        monitors.push({
          id: mon.id,
          name: mon.name,
          type: mon.type || '',
          status,
          responseTime: last ? last.ping || null : null
        });
      }
    }

    res.json({ monitors, updated: Date.now() });
  } catch (e) {
    res.json({ error: 'Failed to connect to Uptime Kuma: ' + e.message });
  }
}

app.get('/api/uptime-kuma', handleUptimeKuma);
app.post('/api/uptime-kuma', handleUptimeKuma);

const piholeSessionCache = new Map();
const PIHOLE_CACHE_MAX = 50;
let piholeCooldownUntil = 0;

async function handlePiHole(req, res) {
  const requested = (req.body && req.body.baseUrl) || req.query.baseUrl;

  let baseUrl;
  try {
    baseUrl = resolveUpstreamUrl(requested || process.env.PIHOLE_BASE_URL || PIHOLE_DEFAULT, PIHOLE_HOSTS, 'PIHOLE_ALLOWED_HOSTS');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const secret = piholeSecret;
  const startTime = Date.now();
  // Hashed so the cache key never holds the password, and capped so it cannot grow forever.
  const cacheKey = `${baseUrl}:${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;

  if (Date.now() < piholeCooldownUntil) {
    const remaining = Math.ceil((piholeCooldownUntil - Date.now()) / 1000);
    return res.json({
      error: `Pi-hole API rate-limited (429). Retrying in ${remaining}s.`,
      retryAfter: piholeCooldownUntil - Date.now()
    });
  }

  try {
    const summaryUrl = `${baseUrl}/api/stats/summary`;
    const legacyUrl = `${baseUrl}/api.php`;
    const authUrl = `${baseUrl}/api/auth`;

    const httpRequest = (url, options = {}) => new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const lib = isHttps ? https : http;
      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      let settled = false;
      let data = '';

      const totalTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { request.destroy(); } catch (e) {}
          reject(new Error('Request timeout'));
        }
      }, 10000);

      let bodyTimer = null;
      const resetBodyTimer = () => {
        if (bodyTimer) clearTimeout(bodyTimer);
        bodyTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { request.destroy(); } catch (e) {}
            reject(new Error('Response body timeout'));
          }
        }, 5000);
      };

      const request = lib.request(requestOptions, (response) => {
        response.on('data', chunk => {
          data += chunk.toString();
          resetBodyTimer();
        });
        response.on('end', () => {
          if (!settled) {
            settled = true;
            clearTimeout(totalTimer);
            if (bodyTimer) clearTimeout(bodyTimer);
            resolve({ status: response.statusCode, headers: response.headers, body: data });
          }
        });
      });

      request.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(totalTimer);
          if (bodyTimer) clearTimeout(bodyTimer);
          reject(err);
        }
      });

      request.setTimeout(5000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) request.write(options.body);
      request.end();
    });

    const jsonRequest = async (url, options = {}) => {
      const response = await httpRequest(url, options);
      let parsed = null;
      try { parsed = JSON.parse(response.body); } catch (e) {}
      return { ...response, body: parsed };
    };

    let data = null;
    const session = piholeSessionCache.get(cacheKey);
    const sessionAge = session ? Date.now() - session.createdAt : Infinity;
    const SESSION_TTL = 25 * 60 * 1000;

    if (secret) {
      if (session && sessionAge < SESSION_TTL && session.valid !== false) {
        const headers = { 'Cookie': `sid=${session.jwt}` };
        if (session.csrf) headers['X-CSRF-TOKEN'] = session.csrf;
        const summaryResp = await jsonRequest(summaryUrl, { headers });
        if (summaryResp.status === 200) {
          data = summaryResp.body;
          session.lastUsed = Date.now();
          return sendSummary(res, data);
        }
        if (summaryResp.status === 429) {
          piholeCooldownUntil = Date.now() + 30000;
          return res.json({
            error: `Pi-hole API rate-limited (429). Will retry in 30s.`,
            retryAfter: 30000
          });
        }
        if (summaryResp.status === 401) {
          piholeSessionCache.delete(cacheKey);
        }
      }

      const backoff = session ? Math.min(30000, 5000 * Math.pow(1.5, session.consecutiveFailures || 0)) : 0;
      if (backoff > 0) {
        piholeCooldownUntil = Date.now() + backoff;
        session.consecutiveFailures = (session.consecutiveFailures || 0) + 1;
        return res.json({
          error: `Pi-hole backing off after failures`,
          retryAfter: backoff
        });
      }

      const authResp = await jsonRequest(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: secret })
      });
      if (authResp.status === 429) {
        piholeCooldownUntil = Date.now() + 30000;
        const newSession = {
          createdAt: Date.now(),
          lastUsed: Date.now(),
          consecutiveFailures: (session?.consecutiveFailures || 0) + 1,
          valid: false
        };
        if (piholeSessionCache.size >= PIHOLE_CACHE_MAX) {
          const oldest = piholeSessionCache.keys().next();
          if (!oldest.done) piholeSessionCache.delete(oldest.value);
        }
        piholeSessionCache.set(cacheKey, newSession);
        return res.json({
          error: `Pi-hole API rate-limited (429). Will retry in 30s.`,
          retryAfter: 30000
        });
      }
      if (authResp.status === 200) {
        const authData = authResp.body;
        const sid = authData?.session?.sid;
        const token = authData?.session?.token;
        const csrf = authData?.session?.csrf;
        
        const cookieFromBody = sid ? `sid=${sid}` : null;
        const jwt = sid || token || authData?.token || null;
        
        
        if (jwt) {
          const cookieValue = cookieFromBody;
          const newSession = {
            jwt,
            cookieHeader: cookieValue,
            csrf,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            consecutiveFailures: 0
          };
          if (piholeSessionCache.size >= PIHOLE_CACHE_MAX) {
            const oldest = piholeSessionCache.keys().next();
            if (!oldest.done) piholeSessionCache.delete(oldest.value);
          }
          piholeSessionCache.set(cacheKey, newSession);
          
          const attempts = [
            { name: 'cookie-only', headers: { 'Cookie': cookieValue } },
            { name: 'bearer+cookie+csrf', headers: { 'Authorization': `Bearer ${jwt}`, 'Cookie': cookieValue, ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}) } },
            { name: 'bearer-only', headers: { 'Authorization': `Bearer ${jwt}` } },
          ];
          
          for (const attempt of attempts) {
            const summaryResp = await jsonRequest(summaryUrl, { headers: attempt.headers });
            if (summaryResp.status === 200) {
              data = summaryResp.body;
              return sendSummary(res, data);
            }
            if (summaryResp.status === 429) {
              piholeCooldownUntil = Date.now() + 30000;
              return res.json({
                error: `Pi-hole API rate-limited (429). Will retry in 30s.`,
                retryAfter: 30000
              });
            }
          }
          
          try { await jsonRequest(`${baseUrl}/api/auth`, { method: 'DELETE' }); } catch (e) {}
          piholeSessionCache.delete(cacheKey);
        }
      }
    } else {
      const summaryResp = await jsonRequest(summaryUrl);
      if (summaryResp.status === 200) {
        data = summaryResp.body;
      }
    }

    return res.json({
      error: `Pi-hole API failed for all endpoints`,
      retryAfter: 30000
    });
  } catch (e) {
    console.error(`[Pi-hole] unhandled error after ${Date.now() - startTime}ms: ${e.message} - fix by checking Pi-hole reachability and PIHOLE_PASSWORD`);
    res.json({ error: 'Failed to connect to Pi-hole: ' + e.message });
  }
}

app.get('/api/pihole', handlePiHole);
app.post('/api/pihole', handlePiHole);

function sendSummary(res, data) {
  let queries, blocked, forwarded, clients, percent;
  if (data.queries) {
    queries = data.queries.total ?? 0;
    blocked = data.queries.blocked ?? 0;
    forwarded = data.queries.forwarded ?? 0;
    percent = data.queries.percent_blocked ?? 0;
    clients = data.clients?.total ?? data.clients_ever_seen ?? 0;
  } else {
    queries = data.dns_queries_today ?? 0;
    blocked = data.ads_blocked_today ?? 0;
    forwarded = data.queries_forwarded ?? 0;
    clients = data.clients_ever_seen ?? 0;
    percent = data.ads_percentage_today ?? 0;
  }

  res.json({
    queries: Number(queries).toLocaleString(),
    blocked: Number(blocked).toLocaleString(),
    forwarded: Number(forwarded).toLocaleString(),
    clients: Number(clients).toLocaleString(),
    percent: Number(percent).toFixed(2),
    updated: Date.now()
  });
}

// Malformed bodies arrive here from express.json(); log the shape once, never the stack,
// so a burst of bad requests cannot flood stderr with framework paths.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path} failed (${err.code || err.message}) - fix by checking the request body and server logs`);
  } else {
    console.warn(`[error] ${req.method} ${req.path} rejected with ${status}: ${err.type || err.message}`);
  }
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.message || 'Bad request') });
});

// Fail closed. Without this the app boots with no authentication at all, which previously
// exposed container control and the upstream-proxy routes to anything that could reach
// the port. An operator who really wants it open must opt in explicitly.
if (!AUTH_ENABLED && !ALLOW_ANONYMOUS) {
  console.error('Refusing to start: AUTH_USER and AUTH_PASS are not both set.');
  console.error('Fix: set AUTH_USER and AUTH_PASS (e.g. in .env), or set ALLOW_ANONYMOUS=true to serve the dashboard without authentication.');
  process.exit(1);
}

if (!ALLOW_ANONYMOUS && uptimeKumaApiKey) {
  console.log('Uptime Kuma API key loaded from the environment and will only be used server-side.');
}
if (!ALLOW_ANONYMOUS && piholeSecret) {
  console.log('Pi-hole credential loaded from the environment and will only be used server-side.');
}

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Authentication: ${AUTH_ENABLED ? `enabled for user "${AUTH_USER}"` : 'DISABLED (ALLOW_ANONYMOUS=true)'}`);
});

