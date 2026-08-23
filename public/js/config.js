export const DEFAULT_CONFIG = {
  title: 'Home Dashboard',
  refreshInterval: 30000,
  theme: 'dark',
  unit: 'C',
  widgets: [
    {
      id: 'system-stats',
      type: 'system',
      title: 'System Stats',
      gridCol: 7,
      gridRow: 1,
      gridColSpan: 3,
      gridRowSpan: 2,
      enabled: true,
      order: 0,
      refreshInterval: 30000
    },
    {
      id: 'storage',
      type: 'storage',
      title: 'Storage',
      gridCol: 7,
      gridRow: 6,
      gridColSpan: 3,
      gridRowSpan: 1,
      enabled: true,
      order: 1,
      refreshInterval: 30000
    },
    {
      id: 'docker-health',
      type: 'docker',
      title: 'Docker Containers',
      gridCol: 10,
      gridRow: 1,
      gridColSpan: 3,
      gridRowSpan: 5,
      enabled: true,
      order: 2,
      refreshInterval: 30000
    },
    {
      id: 'quick-links',
      type: 'links',
      title: 'Quick Links',
      gridCol: 1,
      gridRow: 1,
      gridColSpan: 3,
      gridRowSpan: 3,
      enabled: true,
      order: 3,
      refreshInterval: 30000,
      links: [
        {
          icon: 'fa-brands fa-docker',
          label: 'Portainer',
          url: 'http://192.168.4.110:9000'
        },
        {
          icon: 'fa-solid fa-server',
          label: 'ZimaOS',
          url: 'http://192.168.4.110/#/'
        },
        {
          icon: 'fa-solid fa-camera',
          label: 'OctoPi',
          url: 'http://192.168.4.34/'
        },
        {
          icon: 'fa-solid fa-house',
          label: 'Home Assistant',
          url: 'http://192.168.4.110:8123/dashboard-main'
        },
        {
          icon: 'fa-solid fa-diagram-project',
          label: 'Container Flow',
          url: 'http://192.168.4.110:9470/'
        },
        {
          icon: 'fa-solid fa-video',
          label: 'PatrolTube',
          url: 'http://192.168.4.110:8001/'
        },
        {
          icon: 'fa-solid fa-camera',
          label: 'ODOT Cameras',
          url: 'http://192.168.4.110:5173/'
        },
        {
          icon: 'fa-solid fa-radio',
          label: 'Police Radio',
          url: 'http://192.168.4.110:5050/'
        },
        {
          icon: 'fa-solid fa-brain',
          label: 'Second Brain',
          url: 'http://192.168.4.110:8088/'
        },
        {
          icon: 'fa-solid fa-terminal',
          label: 'Terminal',
          url: 'http://192.168.4.110:7681/'
        },
        {
          icon: 'fa-brands fa-microsoft',
          label: 'VSCode',
          url: 'https://vscode.dev/'
        },
        {
          icon: 'fa-brands fa-github',
          label: 'GitHub',
          url: 'https://github.com/brgjr10'
        },
        {
          icon: 'fa-brands fa-youtube',
          label: 'YouTube',
          url: 'https://youtube.com'
        },
        {
          icon: 'fa-brands fa-facebook',
          label: 'Facebook',
          url: 'https://www.facebook.com/'
        },
        {
          icon: 'fa-solid fa-bell',
          label: 'Water Later',
          url: 'https://watch-later-sigma.vercel.app/login'
        }
      ]
    },
    {
      id: 'github-activity',
      type: 'github',
      title: 'GitHub Activity',
      gridCol: 1,
      gridRow: 5,
      gridColSpan: 6,
      gridRowSpan: 2,
      enabled: true,
      order: 4,
      refreshInterval: 30000,
      user: 'brgjr10'
    },
    {
      id: 'speedtest',
      type: 'speedtest',
      title: 'Internet Speed',
      gridCol: 7,
      gridRow: 5,
      gridColSpan: 3,
      gridRowSpan: 1,
      enabled: true,
      order: 5,
      refreshInterval: 30000
    },
    {
      id: 'weather',
      type: 'weather',
      title: 'Weather',
      gridCol: 4,
      gridRow: 3,
      gridColSpan: 3,
      gridRowSpan: 1,
      enabled: true,
      order: 6,
      refreshInterval: 30000,
      city: 'Akron',
      state: 'Ohio'
    },
    {
      id: 'search',
      type: 'search',
      title: 'Search',
      gridCol: 7,
      gridRow: 3,
      gridColSpan: 3,
      gridRowSpan: 1,
      enabled: true,
      order: 10,
      refreshInterval: 0
    },
    {
      id: 'uptime-kuma-1787358686729',
      type: 'uptime-kuma',
      title: 'Uptime Kuma',
      gridCol: 4,
      gridRow: 1,
      gridColSpan: 3,
      gridRowSpan: 2,
      enabled: true,
      order: 10,
      baseUrl: 'http://192.168.4.90:3001',
      slug: 'connection',
      apiKey: 'uk3_CnaWzToZRDSGiY1gHL0LwhytI_grmbaEwy0GXVJd',
      mode: 'metrics'
    },
    {
      id: 'uptime',
      type: 'uptime',
      title: 'Uptime Kuma',
      gridCol: 5,
      gridRow: 9,
      gridColSpan: 6,
      gridRowSpan: 2,
      enabled: true,
      order: 12,
      refreshInterval: 30000
    },
    {
      id: 'pihole',
      type: 'pihole',
      title: 'Pi-hole / AdGuard',
      gridCol: 10,
      gridRow: 6,
      gridColSpan: 3,
      gridRowSpan: 1,
      enabled: true,
      order: 13,
      refreshInterval: 30000,
      baseUrl: 'http://192.168.4.90',
      password: 'da7ghuwmp8vs'
    }
  ]
};

export const WIDGET_TYPES = {
  links: {
    name: 'Quick Links',
    icon: '🔗',
    description: 'Easily addable shortcuts to your services',
    defaultSize: 'medium'
  },
  system: {
    name: 'System Stats',
    icon: '💻',
    description: 'CPU, memory, temperature, and uptime',
    defaultSize: 'medium'
  },
  storage: {
    name: 'Storage',
    icon: '💾',
    description: 'Disk usage and free space',
    defaultSize: 'medium'
  },
  docker: {
    name: 'Docker Health',
    icon: '🐳',
    description: 'Container status and health',
    defaultSize: 'medium'
  },
  github: {
    name: 'GitHub Activity',
    icon: '🐙',
    description: 'Recent commits and events',
    defaultSize: 'medium'
  },
  speedtest: {
    name: 'Internet Speed',
    icon: '🌐',
    description: 'Download speed test',
    defaultSize: 'small'
  },
  weather: {
    name: 'Weather',
    icon: '🌤️',
    description: 'Local weather from Open-Meteo',
    defaultSize: 'small'
  },
  custom: {
    name: 'Custom HTML',
    icon: '🧩',
    description: 'Embed custom content or iframe',
    defaultSize: 'medium'
  },
  search: {
    name: 'Google Search',
    icon: '🔍',
    description: 'Quick Google search box',
    defaultSize: 'small'
  },
  'uptime-kuma': {
    name: 'Uptime Kuma',
    icon: '📡',
    description: 'Monitor status from Uptime Kuma',
    defaultSize: 'medium'
  },
  pihole: {
    name: 'Pi-hole',
    icon: '🕳️',
    description: 'DNS blocking stats from Pi-hole',
    defaultSize: 'medium'
  }
};

export let config = null;

export function loadConfig() {
  try {
    const saved = localStorage.getItem('dashboard-config');
    if (saved) {
      config = JSON.parse(saved);
    } else {
      throw new Error('No local config');
    }
  } catch (e) {
    config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  if (!config.theme) {
    config.theme = 'dark';
  }
  if (!config.unit) {
    config.unit = 'C';
  }
  saveConfig();
}

export async function loadConfigAsync() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const serverConfig = await response.json();
      config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      Object.assign(config, serverConfig);
      migrateLayoutToGrid();
      ensureConfigDefaults();
      await applyWidgetDefaults();
      saveConfig();
      return;
    }
  } catch (e) {
    // Ignore
  }
  try {
    const saved = localStorage.getItem('dashboard-config');
    if (saved) {
      config = JSON.parse(saved);
      migrateLayoutToGrid();
      ensureConfigDefaults();
      await applyWidgetDefaults();
      saveConfig();
      return;
    }
  } catch (e) {
    // Ignore
  }
  try {
    const response = await fetch(`data/widgets.json?_=${Date.now()}`);
    if (response.ok) {
      const fileConfig = await response.json();
      config = JSON.parse(JSON.stringify(fileConfig));
      migrateLayoutToGrid();
      ensureConfigDefaults();
      saveConfig();
      return;
    }
  } catch (e) {
    // Ignore
  }
  loadConfig();
}

async function applyWidgetDefaults() {
  if (!config) return;
  try {
    const response = await fetch(`data/widgets.json?_=${Date.now()}`);
    if (!response.ok) return;
    const fileConfig = await response.json();
    const defaultsMap = new Map((fileConfig.widgets || []).map(w => [w.id, w]));
    (config.widgets || []).forEach(w => {
      const defaults = defaultsMap.get(w.id);
      if (!defaults) return;
      if (w.type === 'links' && Array.isArray(defaults.links) && Array.isArray(w.links)) {
        while (w.links.length < defaults.links.length) {
          w.links.push(defaults.links[w.links.length]);
        }
        const defaultsByLabel = new Map((defaults.links || []).map(l => [l.label, l]));
        (w.links || []).forEach(link => {
          const def = defaultsByLabel.get(link.label);
          if (def && def.icon && link.icon !== def.icon) {
            link.icon = def.icon;
          }
        });
        const ytLink = (w.links || []).find(l => l.label === 'YouTube');
        if (ytLink && ytLink.icon === 'fa-solid fa-link') {
          ytLink.icon = 'fa-brands fa-youtube';
        }
      }
    });
  } catch (e) {
    // Ignore
  }
}

function ensureConfigDefaults() {
  if (!config) return;
  if (!config.theme) {
    config.theme = 'dark';
  }
  if (!config.unit) {
    config.unit = 'C';
  }
  if (!config.refreshInterval) {
    config.refreshInterval = 30000;
  }
}

export function migrateLayoutToGrid() {
  if (!config || !config.widgets) return;

  const gutter = 16;
  const colCount = 12;
  const rowHeight = 80;

  let needsMigration = false;

  config.widgets.forEach((widget, index) => {
    const hasOldPositions = widget.x !== undefined || widget.y !== undefined || widget.width !== undefined || widget.height !== undefined;
    const hasGridPositions = widget.gridCol !== undefined || widget.gridRow !== undefined;

    if (hasOldPositions && !hasGridPositions) {
      needsMigration = true;

      const gridRect = document.getElementById('widget-grid')?.getBoundingClientRect();
      const colWidth = gridRect ? (gridRect.width - gutter * (colCount - 1)) / colCount : 100;

      if (widget.x !== undefined) {
        widget.gridCol = Math.max(1, Math.round((parseInt(widget.x) || 0) / (colWidth + gutter)) + 1);
      }
      if (widget.y !== undefined) {
        widget.gridRow = Math.max(1, Math.round((parseInt(widget.y) || 0) / (rowHeight + gutter)) + 1);
      }
      if (widget.width !== undefined) {
        widget.gridColSpan = Math.max(1, Math.round((parseInt(widget.width) || colWidth) / (colWidth + gutter)));
      }
      if (widget.height !== undefined) {
        widget.gridRowSpan = Math.max(1, Math.round((parseInt(widget.height) || rowHeight) / (rowHeight + gutter)));
      }
    }
  });

  if (needsMigration) {
    saveConfig();
  }
}

export function getWidgets() {
  if (!config || !config.widgets) return [];
  return config.widgets
    .filter(w => w.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function getTheme() {
  return config?.theme || 'dark';
}

export function getUnit() {
  return config?.unit || 'C';
}

export function saveConfig() {
  try {
    localStorage.setItem('dashboard-config', JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

export function updateWidget(id, updates) {
  const widget = config.widgets.find(w => w.id === id);
  if (widget) {
    Object.assign(widget, updates);
    saveConfig();
  }
  return widget;
}

export function removeWidget(id) {
  const index = config.widgets.findIndex(w => w.id === id);
  if (index !== -1) {
    config.widgets.splice(index, 1);
    saveConfig();
  }
}

export function addWidget(widgetConfig) {
  config.widgets.push(widgetConfig);
  saveConfig();
}
