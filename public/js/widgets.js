import { getUnit } from './config.js';

class Widget {
  constructor(container, widgetConfig) {
    this.container = container;
    this.config = widgetConfig;
    this.element = null;
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = `widget ${this.config.size || 'medium'}`;
    this.element.dataset.id = this.config.id;
    this.element.innerHTML = `
      <div class="widget-header">
        <span class="widget-title">${this.config.title}</span>
        <div class="widget-actions">
          <button class="widget-action" data-action="configure" title="Configure">⚙</button>
          <button class="widget-action" data-action="remove" title="Remove">×</button>
        </div>
      </div>
      <div class="widget-content">
        <div class="loading">Loading...</div>
      </div>
      <div class="widget-footer"></div>
      <div class="resize-handle"></div>
    `;
    this.contentEl = this.element.querySelector('.widget-content');
    this.footerEl = this.element.querySelector('.widget-footer');
    return this.element;
  }

  async load() {
    const hasExistingContent = this.contentEl.innerHTML && !this.contentEl.innerHTML.includes('Loading...');
    console.log(`[${this.config.type} widget ${this.config.id}] load() hasExistingContent=${hasExistingContent}`);
    if (!hasExistingContent) {
      this.contentEl.innerHTML = '<div class="loading">Loading...</div>';
    }
    try {
      const data = await this.fetchData();
      console.log(`[${this.config.type} widget ${this.config.id}] fetchData done: error=${!!data.error}`);
      if (data.error && hasExistingContent) {
        console.log(`[${this.config.type} widget ${this.config.id}] Keeping existing content (error on refresh)`);
        return;
      }
      if (!data.error) {
        this.contentEl.innerHTML = this.format(data);
        if (data.updated) {
          this.footerEl.textContent = `Updated: ${new Date(data.updated).toLocaleTimeString()}`;
        }
        console.log(`[${this.config.type} widget ${this.config.id}] Content updated`);
      }
    } catch (err) {
      console.error(`[${this.config.type} widget ${this.config.id}] load() threw:`, err.message);
      if (!hasExistingContent) {
        this.contentEl.innerHTML = '<div class="loading">Loading...</div>';
      }
    }
  }

  async fetchData() {
    throw new Error('fetchData must be implemented');
  }

  format(data) {
    return JSON.stringify(data);
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

function parseDiskSize(value) {
  if (typeof value !== 'string') return NaN;
  const match = value.trim().match(/^([\d.]+)\s*([KMGT]?B?)?$/i);
  if (!match) return NaN;
  const num = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase().replace('B', '');
  const multipliers = { '': 1, 'K': 1024, 'M': 1048576, 'G': 1073741824, 'T': 1099511627776 };
  const multiplier = multipliers[unit] || 1;
  return num * multiplier / 1073741824;
}

function convertTemp(celsius) {
  const unit = (typeof getUnit === 'function' ? getUnit() : 'C');
  if (unit === 'F') {
    return Math.round(celsius * 9 / 5 + 32);
  }
  return Math.round(celsius);
}

function convertWindSpeed(kmh) {
  const unit = (typeof getUnit === 'function' ? getUnit() : 'C');
  if (unit === 'F') {
    return (kmh * 0.621371).toFixed(1);
  }
  return kmh;
}

class LinksWidget extends Widget {
  async fetchData() {
    return { links: this.config.links || [] };
  }

  format(data) {
    if (!data.links || data.links.length === 0) {
      return '<div class="empty-state">No links configured</div>';
    }
    const linksHtml = data.links.map(link => {
      const icon = link.icon ? (link.icon.startsWith('fa-') ? `<i class="${link.icon}"></i>` : link.icon) : '<i class="fa-solid fa-link"></i>';
      return `
        <a href="${link.url}" target="_blank" rel="noopener noreferrer" class="link-item">
          <span class="link-icon">${icon}</span>
          <span class="link-label">${link.label}</span>
        </a>
      `;
    }).join('');
    return `<div class="links-grid">${linksHtml}</div>`;
  }
}

class SystemWidget extends Widget {
  async fetchData() {
    const response = await fetch('/api/system');
    if (!response.ok) throw new Error('Failed to fetch system stats');
    const data = await response.json();
    data.updated = Date.now();
    return data;
  }

  format(data) {
    let html = '';
    const unit = getUnit();
    
    if (data.temp) {
      const displayTemp = convertTemp(data.temp);
      const tempClass = data.temp < 60 ? 'normal' : data.temp < 75 ? 'warm' : 'hot';
      html += `
        <div class="temp-display ${tempClass}">${displayTemp}°${unit}</div>
      `;
    }

    html += `
      <div class="stat-row">
        <span class="stat-label">CPU Usage</span>
        <span class="stat-value">${data.cpu.usage}%</span>
      </div>
      <div class="stat-bar">
        <div class="stat-bar-fill ${data.cpu.usage > 80 ? 'high' : data.cpu.usage > 50 ? 'medium' : 'low'}" style="width: ${data.cpu.usage}%"></div>
      </div>
    `;

    html += `
      <div class="stat-row">
        <span class="stat-label">Memory</span>
        <span class="stat-value">${data.memory.used} / ${data.memory.total} GB (${data.memory.percent}%)</span>
      </div>
      <div class="stat-bar">
        <div class="stat-bar-fill ${data.memory.percent > 80 ? 'high' : data.memory.percent > 50 ? 'medium' : 'low'}" style="width: ${data.memory.percent}%"></div>
      </div>
    `;

    const uptimeHours = Math.floor(data.uptime / 3600);
    const uptimeDays = Math.floor(uptimeHours / 24);
    html += `
      <div class="stat-row">
        <span class="stat-label">Uptime</span>
        <span class="stat-value">${uptimeDays > 0 ? uptimeDays + 'd ' : ''}${uptimeHours % 24}h</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Load Avg</span>
        <span class="stat-value">${data.cpu.load}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Hostname</span>
        <span class="stat-value">${data.hostname}</span>
      </div>
    `;

    return html;
  }
}

class StorageWidget extends Widget {
  async fetchData() {
    const response = await fetch('/api/system');
    if (!response.ok) throw new Error('Failed to fetch storage info');
    const data = await response.json();
    data.updated = Date.now();
    return data;
  }

  format(data) {
    if (!data.disks || data.disks.length === 0) {
      return '<div class="empty-state">No disk info available</div>';
    }

    const mainDisk = data.disks.find(d => d.mount === '/hostfs/DATA') 
                  || data.disks.find(d => d.device && d.device.includes('nvme0n1p8'))
                  || data.disks.find(d => d.mount === '/hostfs/var/lib/casaos_data')
                  || data.disks[0];

    const totalSize = parseDiskSize(mainDisk.size);
    const totalUsed = parseDiskSize(mainDisk.used);
    const totalAvail = parseDiskSize(mainDisk.avail);

    const percent = totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0;
    const percentClass = percent > 80 ? 'high' : percent > 50 ? 'medium' : 'low';

    const displaySize = totalSize > 0 ? totalSize.toFixed(1) : '0.0';
    const displayUsed = totalUsed > 0 ? totalUsed.toFixed(1) : '0.0';
    const displayAvail = totalAvail > 0 ? totalAvail.toFixed(1) : '0.0';

    return `
      <div class="disk-item">
        <div class="disk-header">
          <span class="disk-name"><i class="fa-solid fa-hard-drive"></i> Total Storage</span>
          <span class="disk-percent">${percent}%</span>
        </div>
        <div class="stat-bar">
          <div class="stat-bar-fill ${percentClass}" style="width: ${percent}%"></div>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
          ${displayUsed}G used / ${displaySize}G total (${displayAvail}G free)
        </div>
      </div>
    `;
  }
}

class DockerWidget extends Widget {
  async fetchData() {
    const response = await fetch('/api/docker');
    if (!response.ok) throw new Error('Failed to fetch Docker status');
    const data = await response.json();
    
    if (data.containers && data.containers.length > 0) {
      const statsPromises = data.containers
        .filter(c => (c.State || {}).Status === 'running' || c.State === 'running')
        .map(c => fetch(`/api/docker/${c.Id}/stats`).then(r => r.json()).catch(() => null));
      const statsResults = await Promise.all(statsPromises);
      const statsMap = {};
      let statsIndex = 0;
      data.containers.forEach(c => {
        const state = c.State || {};
        const isRunning = state.Status === 'running' || state === 'running';
        if (isRunning && statsResults[statsIndex]) {
          statsMap[c.Id] = statsResults[statsIndex];
          statsIndex++;
        }
      });
      data.stats = statsMap;
    }
    
    data.updated = Date.now();
    return data;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}</div>`;
    }
    if (!data.containers || data.containers.length === 0) {
      return '<div class="empty-state">No containers found</div>';
    }
    const containersHtml = data.containers.map(container => {
      const state = container.State || {};
      const statusText = typeof state === 'string' ? state : (state.Status || container.Status || 'unknown');
      const statusClass = statusText === 'running' ? 'running' : 
                         statusText === 'paused' ? 'paused' : 'stopped';
      const name = container.Names?.[0]?.replace(/^\//, '') || container.Id?.slice(0, 12) || 'unnamed';
      const containerId = container.Id || container.Id?.slice(0, 12) || '';
      const stats = data.stats?.[containerId];
      
      let resourceHtml = '';
      if (stats && !stats.error) {
        const memUsage = stats.memory_stats?.usage || 0;
        const memLimit = stats.memory_stats?.limit || 0;
        const memPercent = memLimit > 0 ? Math.round((memUsage / memLimit) * 100) : 0;
        const memMb = (memUsage / 1024 / 1024).toFixed(0);
        const memLimitMb = (memLimit / 1024 / 1024).toFixed(0);
        
        let cpuPercent = 0;
        if (stats.cpu_stats) {
          const cpuDelta = stats.cpu_stats.cpu_usage?.total_usage || 0;
          const systemDelta = stats.cpu_stats.system_cpu_usage || 0;
          const cpuCount = stats.cpu_stats.online_cpus || 1;
          if (systemDelta > 0) {
            cpuPercent = Math.round((cpuDelta / systemDelta) * cpuCount * 100);
          }
        }
        
        const netRx = stats.networks ? Object.values(stats.networks).reduce((sum, n) => sum + (n.rx_bytes || 0), 0) : 0;
        const netTx = stats.networks ? Object.values(stats.networks).reduce((sum, n) => sum + (n.tx_bytes || 0), 0) : 0;
        
        resourceHtml = `
          <div class="container-resources">
            <div class="resource-item">
              <span class="resource-label">CPU</span>
              <span class="resource-value">${cpuPercent}%</span>
            </div>
            <div class="resource-item">
              <span class="resource-label">MEM</span>
              <span class="resource-value">${memMb}/${memLimitMb} MB</span>
            </div>
            <div class="resource-item">
              <span class="resource-label">NET</span>
              <span class="resource-value">${formatBytes(netRx)}↓ ${formatBytes(netTx)}↑</span>
            </div>
          </div>
        `;
      }
      
      return `
        <div class="docker-container">
          <div class="container-status">
            <span class="status-dot ${statusClass}"></span>
            <span>${name}</span>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${statusText}</span>
          ${resourceHtml}
          <div class="docker-actions">
            <button class="docker-action" data-action="start" data-id="${containerId}" title="Start"><i class="fa-solid fa-play"></i></button>
            <button class="docker-action" data-action="stop" data-id="${containerId}" title="Stop"><i class="fa-solid fa-stop"></i></button>
            <button class="docker-action" data-action="restart" data-id="${containerId}" title="Restart"><i class="fa-solid fa-rotate"></i></button>
          </div>
        </div>
      `;
    }).join('');
    return `<div class="docker-list">${containersHtml}</div>`;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0B';
  const k = 1024;
  const sizes = ['B', 'K', 'M', 'G'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

class GitHubWidget extends Widget {
  async fetchData() {
    const contributionsUrl = `/api/github/contributions?user=${this.config.user}`;
    const activityUrl = `/api/github/activity?user=${this.config.user}${this.config.repo ? `&repo=${this.config.repo}` : ''}`;
    
    const [contributionsRes, activityRes] = await Promise.all([
      fetch(contributionsUrl),
      fetch(activityUrl)
    ]);
    
    if (!contributionsRes.ok) throw new Error('Failed to fetch GitHub contributions');
    
    const contributionsData = await contributionsRes.json();
    let activityData = { events: [] };
    if (activityRes.ok) {
      try {
        activityData = await activityRes.json();
      } catch (e) {
        activityData = { events: [] };
      }
    }
    
    contributionsData.updated = Date.now();
    contributionsData.events = activityData.events || [];
    
    return contributionsData;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}<br><small style="color: var(--text-muted);">Set GITHUB_TOKEN env var to fix rate limits</small></div>`;
    }
    if (!data.weeks || data.weeks.length === 0) {
      return '<div class="empty-state">No contribution data</div>';
    }

    const profile = data.user || {};
    const days = [];
    data.weeks.forEach(week => {
      week.contributionDays.forEach(day => {
        days.push({
          date: day.date,
          count: day.contributionCount
        });
      });
    });

    const maxCount = Math.max(...days.map(d => d.count), 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const weeks = [];
    let currentWeek = [];
    days.forEach((day, index) => {
      const dayDate = new Date(day.date);
      dayDate.setHours(0, 0, 0, 0);
      const dayOfWeek = dayDate.getDay();
      
      if (index === 0) {
        for (let i = 0; i < dayOfWeek; i++) {
          currentWeek.push(null);
        }
      }
      
      currentWeek.push(day);
      
      if (currentWeek.length === 7 || index === days.length - 1) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    });

    const getLevel = (count) => {
      if (count === 0) return 0;
      if (count <= maxCount * 0.25) return 1;
      if (count <= maxCount * 0.5) return 2;
      if (count <= maxCount * 0.75) return 3;
      return 4;
    };

    const todayContributions = days.find(d => d.date === todayStr);
    const todayCount = todayContributions ? todayContributions.count : 0;
    const todayLevel = getLevel(todayCount);

    const levelColors = [
      '#161b22',
      '#0e4429',
      '#006d32',
      '#26a641',
      '#39d353'
    ];

    let html = '<div class="github-profile">';
    
    if (profile.avatarUrl) {
      html += `<img src="${profile.avatarUrl}" alt="${profile.name || profile.login || 'GitHub'}" class="github-avatar">`;
    }
    
    html += '<div class="github-info">';
    
    if (profile.name) {
      html += `<div class="github-name"><i class="fa-brands fa-github"></i> ${profile.name}</div>`;
    }
    
    if (profile.bio) {
      html += `<div class="github-bio">${profile.bio}</div>`;
    }
    
    html += '<div class="github-meta">';
    
    if (profile.company) {
      html += `<span class="github-meta-item">🏢 ${profile.company}</span>`;
    }
    
    if (profile.location) {
      html += `<span class="github-meta-item">📍 ${profile.location}</span>`;
    }
    
    html += `<span class="github-meta-item">👥 ${profile.followersCount || 0} followers · ${profile.followingCount || 0} following</span>`;
    html += `<span class="github-meta-item">📁 ${profile.publicReposCount || 0} repos</span>`;
    
    html += '</div>';
    html += '</div>';
    html += '</div>';
    
    html += '<div class="contribution-chart">';
    html += '<div class="contribution-grid">';

    weeks.forEach((week, weekIndex) => {
      html += '<div class="contribution-week">';
      week.forEach(day => {
        if (!day) {
          html += '<div class="contribution-day empty"></div>';
        } else {
          const level = getLevel(day.count);
          const isToday = day.date === todayStr;
          const color = levelColors[level];
          html += `<div class="contribution-day" style="background-color: ${color};" title="${day.date}: ${day.count} contributions"></div>`;
        }
      });
      html += '</div>';
    });

    html += '</div>';
    html += '</div>';

    html += '<div class="contribution-legend">';
    html += '<span>Less</span>';
    for (let i = 0; i <= 4; i++) {
      html += `<div class="contribution-day" style="background-color: ${levelColors[i]}; width: 12px; height: 12px;"></div>`;
    }
    html += '<span>More</span>';
    html += '</div>';

    const totalContributions = days.reduce((sum, day) => sum + day.count, 0);
    html += `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: center;">${totalContributions} contributions in the last year</div>`;

    if (data.events && data.events.length > 0) {
      html += '<div class="github-events">';
      html += '<div class="github-events-title">Recent Activity</div>';
      
      data.events.slice(0, 5).forEach(event => {
        const eventType = event.type || 'Event';
        const repoName = event.repo?.name || 'unknown';
        const eventDate = new Date(event.created_at).toLocaleDateString();
        
        html += `
          <div class="github-event-item">
            <span class="github-event-type">${eventType}</span>
            <span class="github-event-repo">${repoName}</span>
            <span class="github-event-date">${eventDate}</span>
          </div>
        `;
      });
      
      html += '</div>';
    }

    return html;
  }
}

class SpeedtestWidget extends Widget {
  async fetchData() {
    const response = await fetch('/api/speedtest');
    if (!response.ok) throw new Error('Failed to run speed test');
    return await response.json();
  }

  format(data) {
    if (data.error) {
      return `
        <div class="speed-value">
          <div class="empty-state">${data.error}</div>
        </div>
      `;
    }
    const download = data.download ? `${data.download} Mbps` : 'N/A';
    const upload = data.upload ? `${data.upload} Mbps` : 'N/A';
    return `
      <div class="speed-value">
        <div class="speed-grid">
          <div class="speed-item">
            <div class="speed-label"><i class="fa-solid fa-download"></i> Download</div>
            <div class="speed-number">${data.download || 'N/A'}</div>
            <div class="speed-unit">Mbps</div>
          </div>
          <div class="speed-item">
            <div class="speed-label"><i class="fa-solid fa-upload"></i> Upload</div>
            <div class="speed-number">${data.upload || 'N/A'}</div>
            <div class="speed-unit">Mbps</div>
          </div>
        </div>
      </div>
      <div style="text-align: center; font-size: 0.75rem; color: var(--text-muted); margin-top: 8px;">
        Test completed in ${data.duration ? data.duration + 's' : 'N/A'}
      </div>
    `;
  }
}

class CustomWidget extends Widget {
  async fetchData() {
    return { url: this.config.url, html: this.config.html, updated: Date.now() };
  }

  format(data) {
    if (this.config.html) {
      return this.config.html;
    }
    if (this.config.url) {
      return `<iframe class="grafana-iframe" src="${this.config.url}" frameborder="0"></iframe>`;
    }
    return '<div class="empty-state">Configure this widget</div>';
  }
}

class SearchWidget extends Widget {
  async fetchData() {
    return { query: this.config.query || '' };
  }

  format(data) {
    const query = (data && data.query) ? data.query : (this.config.query || '');
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return `
      <div class="search-widget">
        <form class="search-form" data-search-form>
          <input
            type="text"
            class="search-input"
            placeholder="Google Search..."
            value="${query.replace(/"/g, '&quot;')}"
            data-search-input
          />
          <button type="submit" class="search-btn">
            <i class="fa-solid fa-magnifying-glass"></i>
          </button>
        </form>
        <a class="search-open" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Open in Google</a>
      </div>
    `;
  }
}

class NetworkWidget extends Widget {
  async fetchData() {
    const response = await fetch('/api/network');
    if (!response.ok) throw new Error('Failed to fetch network info');
    const data = await response.json();
    data.updated = Date.now();
    return data;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}</div>`;
    }
    const interfaces = data.interfaces || [];
    const html = interfaces.map(iface => {
      const ips = iface.addresses.map(a => a.address).join(', ');
      if (!ips) return '';
      return `
        <div class="network-interface">
          <div class="network-name"><i class="fa-solid fa-network-wired"></i> ${iface.name}</div>
          <div class="network-ips">${ips}</div>
        </div>
      `;
    }).join('');
    return `<div class="network-list">${html || '<div class="empty-state">No IPv4 interfaces found</div>'}</div>`;
  }
}

class WeatherWidget extends Widget {
  async fetchData() {
    const city = this.config.city || '';
    const state = this.config.state || '';
    const response = await fetch(`/api/weather?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`);
    if (!response.ok) throw new Error('Failed to fetch weather');
    const data = await response.json();
    data.updated = Date.now();
    return data;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}</div>`;
    }
    const weatherIcons = {
      0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
      45: '🌫️', 48: '🌫️',
      51: '🌦️', 53: '🌦️', 55: '🌧️',
      61: '🌧️', 63: '🌧️', 65: '🌧️',
      71: '❄️', 73: '❄️', 75: '❄️',
      80: '🌦️', 81: '🌧️', 82: '⛈️',
      95: '⛈️', 96: '⛈️', 99: '⛈️'
    };
    const icon = weatherIcons[data.weathercode] || '🌡️';
    const temp = convertTemp(data.temperature);
    const unit = getUnit();
    return `
      <div class="weather-display">
        <div class="weather-icon">${icon}</div>
        <div class="weather-temp">${temp}°${unit}</div>
        <div class="weather-wind"><i class="fa-solid fa-wind"></i> ${convertWindSpeed(data.windspeed)} ${unit === 'F' ? 'mph' : 'km/h'}</div>
      </div>
    `;
  }
}

class UptimeKumaWidget extends Widget {
  async fetchData() {
    const baseUrl = this.config.baseUrl || 'http://192.168.4.90:3001';
    const slug = this.config.slug || '';
    const apiKey = this.config.apiKey || '';
    const mode = this.config.mode || 'status';

    const params = new URLSearchParams();
    params.set('baseUrl', baseUrl);
    params.set('slug', slug);
    params.set('apiKey', apiKey);
    params.set('mode', mode);

    const response = await fetch(`/api/uptime-kuma?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch Uptime Kuma data');
    const data = await response.json();
    data.updated = Date.now();
    return data;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}</div>`;
    }
    const monitors = data.monitors || [];
    if (monitors.length === 0) {
      return '<div class="empty-state">No monitors found</div>';
    }

    const statusIcons = {
      up: '🟢',
      down: '🔴',
      pending: '🟡',
      maintenance: '🔵',
      paused: '⚪',
      unknown: '❓'
    };

    const statusColors = {
      up: 'var(--accent-green)',
      down: 'var(--accent-red)',
      pending: 'var(--accent-yellow)',
      maintenance: 'var(--accent-blue)',
      paused: 'var(--text-muted)',
      unknown: 'var(--text-secondary)'
    };

    const upCount = monitors.filter(m => m.status === 'up').length;
    const downCount = monitors.filter(m => m.status === 'down').length;
    const pendingCount = monitors.filter(m => m.status === 'pending').length;

    let summaryHtml = '';
    if (downCount > 0) {
      summaryHtml = `<div class="kuma-summary down"><span class="kuma-summary-icon">🔴</span> ${downCount} Down</div>`;
    } else if (pendingCount > 0) {
      summaryHtml = `<div class="kuma-summary pending"><span class="kuma-summary-icon">🟡</span> ${pendingCount} Pending</div>`;
    } else {
      summaryHtml = `<div class="kuma-summary up"><span class="kuma-summary-icon">✅</span> All ${upCount} Up</div>`;
    }

    const monitorsHtml = monitors.map(mon => {
      const icon = statusIcons[mon.status] || '❓';
      const color = statusColors[mon.status] || 'var(--text-secondary)';
      const responseTime = mon.responseTime ? `${mon.responseTime}ms` : '';
      return `
        <div class="kuma-monitor">
          <span class="kuma-monitor-icon">${icon}</span>
          <span class="kuma-monitor-name">${mon.name}</span>
          <span class="kuma-monitor-type">${mon.type}</span>
          ${responseTime ? `<span class="kuma-monitor-time">${responseTime}</span>` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="kuma-widget">
        ${summaryHtml}
        <div class="kuma-monitors">${monitorsHtml}</div>
      </div>
    `;
  }
}

class PiHoleWidget extends Widget {
  async fetchData() {
    const baseUrl = this.config.baseUrl || 'http://192.168.4.90';
    const password = this.config.password || '';
    const url = `/api/pihole?${new URLSearchParams({ baseUrl, ...(password ? { password } : {}) }).toString()}`;
    console.log(`[Pi-hole widget] Loading: ${url}`);
    const t0 = performance.now();
    const response = await fetch(url);
    const elapsed = (performance.now() - t0).toFixed(0);
    console.log(`[Pi-hole widget] Response: status=${response.status}, ${elapsed}ms`);
    if (!response.ok) {
      console.error(`[Pi-hole widget] HTTP error: ${response.status} ${response.statusText}`);
      throw new Error(`Pi-hole request failed: ${response.status}`);
    }
    const data = await response.json();
    if (!data.error) {
      data.updated = Date.now();
    }
    if (data.error) {
      console.error(`[Pi-hole widget] API error:`, data.error, data.retryAfter ? `(retry in ${data.retryAfter / 1000}s)` : '');
    } else {
      console.log(`[Pi-hole widget] Data received:`, { queries: data.queries, blocked: data.blocked, percent: data.percent });
    }
    return data;
  }

  format(data) {
    if (data.error) {
      return `<div class="empty-state">${data.error}</div>`;
    }

    return `
      <div class="pihole-widget">
        <div class="pihole-stats">
          <div class="pihole-stat">
            <div class="pihole-stat-value">${data.queries || '0'}</div>
            <div class="pihole-stat-label">Queries Today</div>
          </div>
          <div class="pihole-stat">
            <div class="pihole-stat-value blocked">${data.blocked || '0'}</div>
            <div class="pihole-stat-label">Blocked</div>
          </div>
          <div class="pihole-stat">
            <div class="pihole-stat-value">${data.percent || '0'}%</div>
            <div class="pihole-stat-label">Block Rate</div>
          </div>
          <div class="pihole-stat">
            <div class="pihole-stat-value">${data.clients || '0'}</div>
            <div class="pihole-stat-label">Clients</div>
          </div>
        </div>
        <div class="pihole-footer">
          <span>Forwarded: ${data.forwarded || '0'}</span>
        </div>
      </div>
    `;
  }
}

export const WIDGET_CLASSES = {
  links: LinksWidget,
  system: SystemWidget,
  storage: StorageWidget,
  docker: DockerWidget,
  github: GitHubWidget,
  speedtest: SpeedtestWidget,
  network: NetworkWidget,
  weather: WeatherWidget,
  custom: CustomWidget,
  search: SearchWidget,
  'uptime-kuma': UptimeKumaWidget,
  pihole: PiHoleWidget
};
