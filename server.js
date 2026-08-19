const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const net = require('net');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static('public', { setHeaders: (res) => {
  if (res.req.url.match(/\.(css|js|html)$/)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}}));

const githubRequest = https.request;
const githubAgent = 'Custom-Dashboard';
const githubToken = process.env.GITHUB_TOKEN || '';

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'K', 'M', 'G', 'T'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

function getDisks() {
  const platform = os.platform();
  const disks = [];

  if (platform === 'win32') {
    try {
      const output = execSync('powershell -Command "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,Size,SizeRemaining,FileSystemType | ConvertTo-Json"', {
        encoding: 'utf8',
        timeout: 5000
      });
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
        dfOutput = execSync('nsenter -t 1 -m df -h -T', { encoding: 'utf8' });
      } catch (e) {
        dfOutput = '';
      }

      if (!dfOutput) {
        try {
          dfOutput = execSync('df -h -T', { encoding: 'utf8' });
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

app.get('/api/system', (req, res) => {
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
      disks: getDisks(),
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

app.get('/api/docker', (req, res) => {
  const platform = os.platform();
  if (platform === 'win32') {
    return res.json({
      containers: [],
      error: 'Docker socket not available on Windows. Deploy to ZimaOS (Linux) to use this widget.'
    });
  }

  const socketPath = '/var/run/docker.sock';
  if (!fs.existsSync(socketPath)) {
    return res.json({
      containers: [],
      error: 'Docker socket not found. Is Docker installed and running?'
    });
  }

  const socket = net.connect({ path: socketPath }, () => {
    const request = `GET /containers/json?all=true HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/json\r\n\r\n`;
    socket.write(request);
  });

  let headerBuffer = '';
  let bodyBuffer = '';
  let headersComplete = false;

  socket.on('data', chunk => {
    if (!headersComplete) {
      headerBuffer += chunk;
      const headerEnd = headerBuffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        headersComplete = true;
        const bodyPart = headerBuffer.substring(headerEnd + 4);
        headerBuffer = '';
        bodyBuffer = decodeChunked(bodyPart);
      }
    } else {
      bodyBuffer += decodeChunked(chunk);
    }
  });

  socket.on('end', () => {
    try {
      const trimmed = bodyBuffer.trim();
      if (!trimmed) {
        return res.json({ containers: [], error: 'Empty Docker response' });
      }
      const containers = JSON.parse(trimmed);
      res.json({ containers });
    } catch (e) {
      console.error('Docker raw response:', bodyBuffer);
      res.json({ containers: [], error: 'Failed to parse Docker response: ' + e.message });
    }
  });

  socket.on('error', () => {
    res.json({ containers: [], error: 'Cannot connect to Docker socket' });
  });
});

function dockerSocketRequest(path, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: '/var/run/docker.sock' }, () => {
      let request = `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/json\r\n`;
      if (body) {
        request += `Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n`;
      }
      request += `\r\n`;
      if (body) request += body;
      socket.write(request);
    });

    let headerBuffer = '';
    let bodyBuffer = '';
    let headersComplete = false;

    socket.on('data', chunk => {
      if (!headersComplete) {
        headerBuffer += chunk;
        const headerEnd = headerBuffer.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          headersComplete = true;
          const bodyPart = headerBuffer.substring(headerEnd + 4);
          headerBuffer = '';
          bodyBuffer = decodeChunked(bodyPart);
        }
      } else {
        bodyBuffer += decodeChunked(chunk);
      }
    });

    socket.on('end', () => {
      const trimmed = bodyBuffer.trim();
      if (!trimmed) return resolve(null);
      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        reject(new Error('Failed to parse Docker response: ' + e.message));
      }
    });

    socket.on('error', () => reject(new Error('Docker socket error')));
  });
}

app.post('/api/docker/:id/start', async (req, res) => {
  try {
    const result = await dockerSocketRequest(`/containers/${req.params.id}/start`, 'POST');
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/docker/:id/stop', async (req, res) => {
  try {
    const result = await dockerSocketRequest(`/containers/${req.params.id}/stop`, 'POST');
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/docker/:id/restart', async (req, res) => {
  try {
    const result = await dockerSocketRequest(`/containers/${req.params.id}/restart`, 'POST');
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function decodeChunked(data) {
  let result = '';
  let remaining = data;
  
  while (remaining.length > 0) {
    const crlfIndex = remaining.indexOf('\r\n');
    if (crlfIndex === -1) break;
    
    const chunkSizeLine = remaining.substring(0, crlfIndex);
    const chunkSize = parseInt(chunkSizeLine, 16);
    
    if (isNaN(chunkSize) || chunkSize === 0) {
      break;
    }
    
    const chunkStart = crlfIndex + 2;
    if (chunkStart + chunkSize > remaining.length) {
      break;
    }
    
    result += remaining.substring(chunkStart, chunkStart + chunkSize);
    remaining = remaining.substring(chunkStart + chunkSize);
    
    const nextCrlf = remaining.indexOf('\r\n');
    if (nextCrlf !== -1) {
      remaining = remaining.substring(nextCrlf + 2);
    }
  }
  
  return result;
}

app.get('/api/speedtest', async (req, res) => {
  const start = Date.now();
  const testUrls = [
    { url: 'https://speed.hetzner.de/100MB.bin', size: 100 },
    { url: 'https://speed.hetzner.de/10MB.bin', size: 10 },
    { url: 'https://proof.ovh.net/files/10Mb.dat', size: 10 },
    { url: 'https://cachefly.cachefly.net/10mb.test', size: 10 }
  ];

  for (const test of testUrls) {
    try {
      const speed = await runSpeedTest(test.url, test.size);
      if (speed) {
        return res.json({
          download: speed.mbps,
          duration: speed.duration.toFixed(2),
          url: test.url
        });
      }
    } catch (e) {
      continue;
    }
  }

  res.json({
    error: 'Speed test failed. Check network or try again.',
    fallback: true
  });
});

function runSpeedTest(url, expectedSizeMB) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      reject(new Error('Timeout'));
    }, 20000);

    https.get(url, { timeout: 15000, rejectUnauthorized: false }, (response) => {
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

app.get('/api/github/contributions', async (req, res) => {
  const user = req.query.user;
  if (!user) {
    return res.json({ error: 'Missing user parameter', weeks: [] });
  }

  try {
    const graphqlQuery = `query {
      user(login: "${user}") {
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

    const data = await makeGitHubGraphQLRequest(graphqlQuery);
    if (data.errors) {
      return res.json({ error: data.errors[0].message, weeks: [] });
    }

    const userData = data.data?.user || {};
    const weeks = userData.contributionsCollection?.contributionCalendar?.weeks || [];
    res.json({
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
    });
  } catch (e) {
    res.json({ error: 'Failed to fetch GitHub contributions', weeks: [] });
  }
});

function makeGitHubGraphQLRequest(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
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

app.get('/api/github/activity', async (req, res) => {
  const user = req.query.user;
  const repo = req.query.repo;
  if (!user) {
    return res.json({ error: 'Missing user parameter', events: [] });
  }

  try {
    let data;
    if (repo) {
      data = await makeGitHubRequest(`/repos/${user}/${repo}/events?per_page=10`);
      if (data.error) {
        return res.json({ error: data.error, events: [] });
      }
      res.json({ events: data, user, repo });
    } else {
      data = await makeGitHubRequest(`/users/${user}/events/public?per_page=30`);
      if (data.error) {
        return res.json({ error: data.error, events: [] });
      }
      res.json({ events: data, user });
    }
  } catch (e) {
    res.json({ error: 'Failed to fetch GitHub activity', events: [] });
  }
});

function makeGitHubRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': githubAgent,
        'Accept': 'application/vnd.github.v3+json'
      }
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

function makeHttpRequest(hostname, port, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: port || 80,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Custom-Dashboard',
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    console.log('UptimeKuma HTTP request:', hostname + ':' + (port || 80) + path);

    const req = http.request(options, (response) => {
      console.log('UptimeKuma HTTP status:', response.statusCode);
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        console.log('UptimeKuma response length:', data.length);
        if (response.statusCode === 404) {
          resolve({ error: 'Status page not found' });
        } else if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            console.error('UptimeKuma JSON parse error:', e.message, 'data preview:', data.substring(0, 200));
            resolve({ error: 'Failed to parse response' });
          }
        } else {
          resolve({ error: `HTTP ${response.statusCode}` });
        }
      });
    });

    req.on('error', (e) => {
      console.error('UptimeKuma request error:', e.message, 'to', hostname + ':' + (port || 80) + path);
      resolve({ error: 'Failed to connect to Uptime Kuma' });
    });
    
    req.on('timeout', () => {
      console.error('UptimeKuma request timeout:', hostname + ':' + (port || 80) + path);
      req.destroy();
      resolve({ error: 'Uptime Kuma request timed out' });
    });
    
    req.end();
  });
}

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
