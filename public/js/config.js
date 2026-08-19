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
      gridCol: 1,
      gridColSpan: 3,
      gridRow: 1,
      gridRowSpan: 4,
      enabled: true,
      order: 0,
      refreshInterval: 30000
    },
    {
      id: 'storage',
      type: 'storage',
      title: 'Storage',
      gridCol: 7,
      gridColSpan: 3,
      gridRow: 6,
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
      gridColSpan: 3,
      gridRow: 1,
      gridRowSpan: 6,
      enabled: true,
      order: 2,
      refreshInterval: 30000
    },
    {
      id: 'quick-links',
      type: 'links',
      title: 'Quick Links',
      gridCol: 7,
      gridColSpan: 3,
      gridRow: 1,
      gridRowSpan: 5,
      enabled: true,
      order: 3,
      refreshInterval: 30000,
      links: [
        { icon: '🚀', label: 'Uptime Kuma', url: 'http://192.168.4.90:3001/status/connection' },
        { icon: '🐳', label: 'Portainer', url: 'http://localhost:9000' },
        { icon: '📊', label: 'Pi-hole', url: 'http://192.168.4.90/admin/login' },
        { icon: '📦', label: 'ZimaOS', url: 'http://192.168.4.110/#/' },
        { icon: '🐙', label: 'OctoPi', url: 'http://192.168.4.34/' },
        { icon: '🖥️', label: 'Cooler Control', url: 'http://192.168.4.110:11987/' },
        { icon: '🏠', label: 'Home Assistant', url: 'http://192.168.4.110:8123/dashboard-main' },
        { icon: '📱', label: 'Container Flow', url: 'http://192.168.4.110:9470/' },
        { icon: '📹', label: 'PatrolTube', url: 'http://192.168.4.110:8001/' },
        { icon: '📷', label: 'ODOT Cameras', url: 'http://192.168.4.110:5173/' },
        { icon: '📌', label: 'Police Radio', url: 'http://192.168.4.110:5050/' },
        { icon: '📝', label: 'Second Brain', url: 'http://192.168.4.110:8088/' },
        { icon: '🌐', label: 'Terminal', url: 'http://192.168.4.110:7681/' },
        { icon: '⌨️', label: 'VSCode', url: 'https://vscode.dev/' },
        { icon: '📁', label: 'GitHub', url: 'https://github.com/brgjr10' }
      ]
    },
    {
      id: 'github-activity',
      type: 'github',
      title: 'GitHub Activity',
      gridCol: 1,
      gridColSpan: 6,
      gridRow: 5,
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
      gridCol: 4,
      gridColSpan: 3,
      gridRow: 1,
      gridRowSpan: 4,
      enabled: true,
      order: 5,
      refreshInterval: 30000
    },
    {
      id: 'weather',
      type: 'weather',
      title: 'Weather',
      gridCol: 1,
      gridColSpan: 6,
      gridRow: 7,
      gridRowSpan: 2,
      enabled: true,
      order: 6,
      refreshInterval: 30000,
      city: 'Bend',
      state: 'Oregon'
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
    const saved = localStorage.getItem('dashboard-config');
    if (saved) {
      config = JSON.parse(saved);
      migrateLayoutToGrid();
      if (!config.theme) {
        config.theme = 'dark';
        saveConfig();
      }
      if (!config.unit) {
        config.unit = 'C';
        saveConfig();
      }
      if (!config.refreshInterval) {
        config.refreshInterval = 30000;
        saveConfig();
      }
      return;
    }
  } catch (e) {
    // Ignore
  }
  try {
    const response = await fetch('data/widgets.json');
    if (response.ok) {
      const fileConfig = await response.json();
      config = JSON.parse(JSON.stringify(fileConfig));
      migrateLayoutToGrid();
      if (!config.theme) {
        config.theme = 'dark';
      }
      if (!config.unit) {
        config.unit = 'C';
      }
      if (!config.refreshInterval) {
        config.refreshInterval = 30000;
      }
      saveConfig();
      return;
    }
  } catch (e) {
    // Ignore
  }
  loadConfig();
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
      
      delete widget.x;
      delete widget.y;
      delete widget.width;
      delete widget.height;
    }
    
    if (!hasGridPositions && !hasOldPositions) {
      needsMigration = true;
      widget.gridCol = ((index % 3) * 4) + 1;
      widget.gridColSpan = 4;
      widget.gridRow = Math.floor(index / 3) + 1;
      widget.gridRowSpan = 3;
    }
    
    if (widget.gridCol !== undefined && widget.gridRow === undefined) {
      needsMigration = true;
      widget.gridRow = Math.floor(index / 3) + 1;
      widget.gridRowSpan = widget.gridRowSpan || 3;
    }
  });
  
  if (needsMigration) {
    saveConfig();
  }
}

export function saveConfig() {
  try {
    localStorage.setItem('dashboard-config', JSON.stringify(config));
  } catch (e) {
    console.warn('Could not save config to localStorage');
  }
}

export function getTheme() {
  return config?.theme || 'dark';
}

export function setTheme(theme) {
  if (!config) return;
  config.theme = theme;
  saveConfig();
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dashboard-theme', theme);
  const select = document.getElementById('theme-select');
  if (select) select.value = theme;
}

export function getUnit() {
  return config?.unit || 'C';
}

export function setUnit(unit) {
  if (!config) return;
  config.unit = unit === 'F' ? 'F' : 'C';
  saveConfig();
  applyUnit(unit);
}

export function applyUnit(unit) {
  document.documentElement.setAttribute('data-unit', unit);
  localStorage.setItem('dashboard-unit', unit);
  const btn = document.getElementById('unit-toggle');
  if (btn) btn.textContent = unit === 'F' ? '°F' : '°C';
}

export function getWidgets() {
  return config.widgets.filter(w => w.enabled).sort((a, b) => a.order - b.order);
}

export function addWidget(type, overrides = {}) {
  const typeConfig = WIDGET_TYPES[type] || WIDGET_TYPES.custom;
  const newWidget = {
    id: `${type}-${Date.now()}`,
    type,
    title: typeConfig.name,
    gridCol: 1,
    gridRow: 1,
    gridColSpan: 3,
    gridRowSpan: 3,
    enabled: true,
    order: config.widgets.length,
    ...overrides
  };
  config.widgets.push(newWidget);
  saveConfig();
  return newWidget;
}

export function removeWidget(id) {
  config.widgets = config.widgets.filter(w => w.id !== id);
  saveConfig();
}

export function updateWidget(id, updates) {
  const widget = config.widgets.find(w => w.id === id);
  if (widget) {
    Object.assign(widget, updates);
    saveConfig();
  }
  return widget;
}
