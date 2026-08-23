import {
  config,
  loadConfig,
  loadConfigAsync,
  getTheme,
  setTheme,
  applyTheme,
  getUnit,
  setUnit,
  applyUnit,
  getWidgets,
  addWidget,
  removeWidget,
  updateWidget,
  WIDGET_TYPES
} from './config.js';
import { WIDGET_CLASSES } from './widgets.js';

function showDialog({ title, bodyHtml, buttons }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('dialog-modal');
    const titleEl = document.getElementById('dialog-title');
    const bodyEl = document.getElementById('dialog-body');
    const footerEl = document.getElementById('dialog-footer');
    const closeBtn = document.getElementById('dialog-close');

    titleEl.textContent = title || 'Dialog';
    bodyEl.innerHTML = bodyHtml || '';
    footerEl.innerHTML = '';

    const defaultResult = buttons?.[0]?.value ?? null;

    buttons?.forEach((btn) => {
      const button = document.createElement('button');
      button.className = `btn ${btn.class || 'btn-secondary'}`;
      button.textContent = btn.label;
      button.addEventListener('click', () => {
        hideDialog();
        resolve(btn.value);
      });
      footerEl.appendChild(button);
    });

    closeBtn.onclick = () => {
      hideDialog();
      resolve(defaultResult);
    };

    modal.style.display = 'flex';
  });
}

function hideDialog() {
  const modal = document.getElementById('dialog-modal');
  if (modal) modal.style.display = 'none';
}

async function showAlert(title, message) {
  await showDialog({
    title,
    bodyHtml: `<p>${message}</p>`,
    buttons: [{ label: 'OK', value: true, class: 'btn-primary' }]
  });
}

async function showConfirm(title, message) {
  return await showDialog({
    title,
    bodyHtml: `<p>${message}</p>`,
    buttons: [
      { label: 'Cancel', value: false, class: 'btn-secondary' },
      { label: 'Confirm', value: true, class: 'btn-primary' }
    ]
  });
}

async function showPrompt(title, label, defaultValue = '') {
  const result = await showDialog({
    title,
    bodyHtml: `
      <div class="form-group">
        <label>${label}</label>
        <input type="text" id="dialog-input" value="${defaultValue.replace(/"/g, '&quot;')}">
      </div>
    `,
    buttons: [
      { label: 'Cancel', value: null, class: 'btn-secondary' },
      { label: 'OK', value: '__ok__', class: 'btn-primary' }
    ]
  });

  if (result === '__ok__') {
    const input = document.getElementById('dialog-input');
    return input?.value || '';
  }
  return null;
}

let activeWidgets = [];
let refreshTimers = {};
let editMode = false;

function init() {
  renderDateTime();
  setInterval(renderDateTime, 1000);
  renderWidgetTypes();
  renderDashboard();
  setupEventListeners();
}

function renderDateTime() {
  const dateEl = document.getElementById('datetime-date');
  const timeEl = document.getElementById('datetime-time');
  
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
  
  if (timeEl) {
    timeEl.textContent = new Date().toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}

function renderDashboard() {
  const grid = document.getElementById('widget-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const widgetConfigs = getWidgets();
  activeWidgets = [];

  const gridRect = grid.getBoundingClientRect();
  const gutter = 16;
  const colCount = 12;
  const colWidth = (gridRect.width - gutter * (colCount - 1)) / colCount;

  const dashboardRefreshInterval = config.refreshInterval;

  widgetConfigs.forEach((widgetConfig, index) => {
    const WidgetClass = WIDGET_CLASSES[widgetConfig.type];
    if (!WidgetClass) return;

    const widget = new WidgetClass(null, widgetConfig);
    const element = widget.render();
    grid.appendChild(element);
    activeWidgets.push({ config: widgetConfig, widget, element });

    let col = 1;
    let colSpan = 3;

    if (widgetConfig.gridCol !== undefined) col = widgetConfig.gridCol;
    else if (widgetConfig.x !== undefined) col = Math.max(1, Math.round((parseInt(widgetConfig.x) || 0) / (colWidth + gutter)) + 1);

    if (widgetConfig.gridColSpan !== undefined) colSpan = widgetConfig.gridColSpan;
    else if (widgetConfig.width) colSpan = Math.max(1, Math.round((parseInt(widgetConfig.width) || colWidth) / (colWidth + gutter)));

    element.style.gridColumn = `${col} / span ${colSpan}`;
    if (widgetConfig.gridRow !== undefined) {
      element.style.gridRow = `${widgetConfig.gridRow} / span ${widgetConfig.gridRowSpan || 1}`;
    }

    widget.load();

    if (refreshTimers[widgetConfig.id]) {
      clearInterval(refreshTimers[widgetConfig.id]);
    }

    const refreshMs = widgetConfig.refreshInterval ?? dashboardRefreshInterval;
    if (refreshMs && refreshMs > 0) {
      refreshTimers[widgetConfig.id] = setInterval(() => {
    const loadDelay = widgetConfig.type === 'pihole' ? 2000 : index * 200;
    setTimeout(() => widget.load(), loadDelay);
      }, refreshMs);
    }
  });

  applyEditModeUI();
}

function applyEditModeUI() {
  const editBanner = document.getElementById('edit-banner');
  const editBtn = document.getElementById('edit-mode-btn');
  
  document.querySelectorAll('.widget').forEach(w => {
    w.classList.toggle('editing', editMode);
  });
  
  if (editBanner) {
    editBanner.style.display = editMode ? 'flex' : 'none';
  }
  
  if (editBtn) {
    editBtn.textContent = editMode ? '✕ Done' : '✎ Edit';
  }
  
  if (editMode) {
    setupDragAndDrop();
    setupResizeHandles();
  }
}

function setupResizeHandles() {
  const grid = document.getElementById('widget-grid');
  if (!grid) return;

  const gutter = 16;

  document.querySelectorAll('.widget .resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const widgetEl = handle.closest('.widget');
      const widgetId = widgetEl.dataset.id;
      const startX = e.clientX;
      const startY = e.clientY;
      
      const gridRect = grid.getBoundingClientRect();
      const colWidth = (gridRect.width - gutter * 11) / 12;
      const estimatedRows = Math.max(1, Math.round(gridRect.height / 200));
      const rowHeight = (gridRect.height - gutter * (estimatedRows - 1)) / estimatedRows;
      
      const currentCol = widgetEl.style.gridColumn || '';
      const currentRow = widgetEl.style.gridRow || '';
      const startCol = parseInt(currentCol.split(' ')[0]) || 1;
      const startRow = parseInt(currentRow.split(' ')[0]) || 1;
      const startColSpan = parseInt(currentCol.split('span ')[1]) || 3;
      const startRowSpan = parseInt(currentRow.split('span ')[1]) || 1;
      
      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        
        const colDelta = Math.round(deltaX / (colWidth + gutter));
        const rowDelta = Math.round(deltaY / (rowHeight + gutter));
        
        const newColSpan = Math.max(1, Math.min(12 - startCol + 1, startColSpan + colDelta));
        const newRowSpan = Math.max(1, Math.min(6, startRowSpan + rowDelta));
        
        widgetEl.style.gridColumn = `${startCol} / span ${newColSpan}`;
        widgetEl.style.gridRow = `${startRow} / span ${newRowSpan}`;
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        const newColSpan = parseInt(widgetEl.style.gridColumn.split('span ')[1]) || startColSpan;
        const newRowSpan = parseInt(widgetEl.style.gridRow.split('span ')[1]) || startRowSpan;
        
        updateWidget(widgetId, {
          gridColSpan: newColSpan,
          gridRowSpan: newRowSpan
        });
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

function setupDragAndDrop() {
  const grid = document.getElementById('widget-grid');
  if (!grid) return;

  const gutter = 16;

  grid.querySelectorAll('.widget').forEach(widget => {
    widget.addEventListener('mousedown', (e) => {
      if (!editMode) return;
      if (e.target.closest('.resize-handle') || e.target.closest('.widget-action')) {
        return;
      }
      
      e.preventDefault();
      
      const widgetEl = widget;
      const widgetId = widgetEl.dataset.id;
      const startX = e.clientX;
      const startY = e.clientY;
      
      const startCol = parseInt(widgetEl.style.gridColumnStart) || parseInt(widgetEl.style.gridColumn?.split(' ')[0]) || 1;
      const startRow = parseInt(widgetEl.style.gridRowStart) || parseInt(widgetEl.style.gridRow?.split(' ')[0]) || 1;
      const startColSpan = parseInt(widgetEl.style.gridColumnSpan) || parseInt(widgetEl.style.gridColumn?.split('span ')[1]) || 3;
      const startRowSpan = parseInt(widgetEl.style.gridRowSpan) || parseInt(widgetEl.style.gridRow?.split('span ')[1]) || 1;
      
      widgetEl.style.zIndex = '1000';
      widgetEl.style.transition = 'none';
      
      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;
        
        const gridRect = grid.getBoundingClientRect();
        const colWidth = (gridRect.width - gutter * 11) / 12;
        const rowHeight = (gridRect.height - gutter * (Math.max(1, Math.round(gridRect.height / 200)) - 1)) / Math.max(1, Math.round(gridRect.height / 200));
        
        const colDelta = Math.round(deltaX / (colWidth + gutter));
        const rowDelta = Math.round(deltaY / (rowHeight + gutter));
        
        const newCol = Math.max(1, Math.min(13 - startColSpan, startCol + colDelta));
        const newRow = Math.max(1, startRow + rowDelta);
        
        widgetEl.style.gridColumn = `${newCol} / span ${startColSpan}`;
        widgetEl.style.gridRow = `${newRow} / span ${startRowSpan}`;
      };
      
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        widgetEl.style.zIndex = '';
        widgetEl.style.transition = '';
        
        const finalCol = parseInt(widgetEl.style.gridColumnStart) || startCol;
        const finalRow = parseInt(widgetEl.style.gridRowStart) || startRow;
        
        updateWidget(widgetId, {
          gridCol: finalCol,
          gridRow: finalRow
        });
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

function renderWidgetTypes() {
  const container = document.getElementById('widget-types');
  if (!container) return;

  container.innerHTML = Object.entries(WIDGET_TYPES).map(([type, info]) => `
    <div class="widget-type-option" data-type="${type}">
      <div class="widget-type-icon">${info.icon}</div>
      <div class="widget-type-info">
        <h4>${info.name}</h4>
        <p>${info.description}</p>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.widget-type-option').forEach(option => {
    option.addEventListener('click', async () => {
      const type = option.dataset.type;
      const typeConfig = WIDGET_TYPES[type];
      const overrides = {};
      
      if (type === 'links') {
        overrides.links = [];
      } else if (type === 'github') {
        overrides.user = await showPrompt('GitHub', 'Username', 'brgjr10');
        if (!overrides.user) return;
        const repo = await showPrompt('GitHub', 'Repository (leave blank for entire account)', '');
        if (repo) overrides.repo = repo;
      } else if (type === 'custom') {
        overrides.url = await showPrompt('Custom Widget', 'URL', 'http://192.168.4.90:3001/status/connection');
        if (!overrides.url) return;
      } else if (type === 'search') {
        const query = await showPrompt('Google Search', 'Search query', '');
        if (!query) return;
        overrides.query = query;
      } else if (type === 'uptime-kuma') {
        overrides.baseUrl = await showPrompt('Uptime Kuma', 'Base URL', 'http://192.168.4.90:3001');
        if (!overrides.baseUrl) return;
        overrides.slug = await showPrompt('Uptime Kuma', 'Status Page Slug', '');
        if (!overrides.slug) return;
        const apiKey = await showPrompt('Uptime Kuma', 'API Key (optional, for metrics mode)', '');
        if (apiKey) overrides.apiKey = apiKey;
        overrides.mode = apiKey ? 'metrics' : 'status';
      } else if (type === 'pihole') {
        overrides.baseUrl = await showPrompt('Pi-hole', 'Base URL', 'http://192.168.4.90');
        if (!overrides.baseUrl) return;
        const password = await showPrompt('Pi-hole', 'Web UI Password (optional)', '');
        if (password) overrides.password = password;
      }

      const widget = addWidget(type, overrides);
      closePanel();
      renderDashboard();
      
      if (widget.type === 'github' && widget.user) {
        setTimeout(() => {
          const w = activeWidgets.find(aw => aw.config.id === widget.id);
          if (w) w.widget.load();
        }, 100);
      }
    });
  });
}

function setupEventListeners() {
  const addBtn = document.getElementById('add-widget-btn');
  const closeBtn = document.getElementById('close-panel');
  const refreshBtn = document.getElementById('refresh-btn');
  const editBtn = document.getElementById('edit-mode-btn');
  const saveLayoutBtn = document.getElementById('save-layout');
  const panel = document.getElementById('add-widget-panel');
  const editBanner = document.getElementById('edit-banner');
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closePanel);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      activeWidgets.forEach(({ widget }) => widget.load());
    });
  }

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      editMode = !editMode;
      applyEditModeUI();
    });
  }

  if (settingsToggle && settingsPanel) {
    settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const refreshRateSelect = document.getElementById('refresh-rate-select');
      if (refreshRateSelect && config.refreshInterval) {
        refreshRateSelect.value = String(config.refreshInterval);
      }
      settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'flex' : 'none';
    });

    document.addEventListener('click', (e) => {
      if (!settingsPanel.contains(e.target) && e.target !== settingsToggle) {
        settingsPanel.style.display = 'none';
      }
    });
  }

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      setTheme(e.target.value);
    });
  }

  const unitToggle = document.getElementById('unit-toggle');
  if (unitToggle) {
    unitToggle.addEventListener('click', () => {
      const newUnit = getUnit() === 'C' ? 'F' : 'C';
      setUnit(newUnit);
      activeWidgets.forEach(({ widget }) => widget.load());
    });
  }

  const refreshRateSelect = document.getElementById('refresh-rate-select');
  if (refreshRateSelect) {
    refreshRateSelect.addEventListener('change', (e) => {
      const ms = parseInt(e.target.value, 10);
      if (!isNaN(ms)) {
        config.refreshInterval = ms;
        saveConfig();
        renderDashboard();
      }
    });
  }

  const resetBtn = document.getElementById('reset-layout-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const confirmed = await showConfirm('Reset Defaults', 'Clear all settings and layout? This cannot be undone.');
      if (!confirmed) return;
      localStorage.removeItem('dashboard-config');
      localStorage.removeItem('dashboard-theme');
      localStorage.removeItem('dashboard-unit');
      location.reload();
    });
  }

  if (saveLayoutBtn) {
    saveLayoutBtn.addEventListener('click', () => {
      editMode = false;
      applyEditModeUI();
    });
  }

  const exportBtn = document.getElementById('export-layout');
  const importInput = document.getElementById('import-layout');

  if (exportBtn) {
    exportBtn.addEventListener('click', exportLayout);
  }

  if (importInput) {
    importInput.addEventListener('change', importLayout);
  }

  document.getElementById('widget-grid')?.addEventListener('click', async (e) => {
    if (!editMode) return;
    
    const widgetEl = e.target.closest('.widget');
    if (!widgetEl) return;

    const actionBtn = e.target.closest('.widget-action');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const widgetId = widgetEl.dataset.id;
      
      if (action === 'remove') {
        if (await showConfirm('Remove Widget', 'Remove this widget?')) {
          removeWidget(widgetId);
          clearInterval(refreshTimers[widgetId]);
          renderDashboard();
        }
      } else if (action === 'configure') {
        configureWidget(widgetId);
      }
    }
  });

  document.getElementById('widget-grid')?.addEventListener('click', async (e) => {
    const dockerAction = e.target.closest('.docker-action');
    if (!dockerAction) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const action = dockerAction.dataset.action;
    const containerId = dockerAction.dataset.id;
    const widgetEl = dockerAction.closest('.widget');
    const widgetId = widgetEl?.dataset.id;
    
    if (!containerId || !widgetId) return;
    
    const widgetConfig = config.widgets.find(w => w.id === widgetId);
    if (!widgetConfig) return;
    
    const endpoint = `/api/docker/${containerId}/${action}`;
    
    dockerAction.disabled = true;
    dockerAction.textContent = '...';
    
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      
      const w = activeWidgets.find(aw => aw.config.id === widgetId);
      if (w) {
        await w.widget.load();
        dockerAction.disabled = false;
        dockerAction.textContent = action === 'start' ? '▶' : action === 'stop' ? '■' : '⟳';
      }
    } catch (err) {
      await showAlert('Docker Error', err.message);
      dockerAction.disabled = false;
      dockerAction.textContent = action === 'start' ? '▶' : action === 'stop' ? '■' : '⟳';
    }
  });
}

async function configureWidget(widgetId) {
  const widgetConfig = config.widgets.find(w => w.id === widgetId);
  if (!widgetConfig) return;

  if (widgetConfig.type === 'links') {
    openLinkEditor(widgetId);
  } else if (widgetConfig.type === 'github') {
    const user = await showPrompt('GitHub', 'Username', widgetConfig.user || 'brgjr10');
    if (!user) return;
    const repo = await showPrompt('GitHub', 'Repository (leave blank for entire account)', widgetConfig.repo || '');
    const updates = { user };
    if (repo) {
      updates.repo = repo;
    } else {
      updates.repo = undefined;
    }
    updateWidget(widgetId, updates);
    renderDashboard();
    setTimeout(() => {
      const w = activeWidgets.find(aw => aw.config.id === widgetId);
      if (w) w.widget.load();
    }, 100);
  } else if (widgetConfig.type === 'custom') {
    const url = await showPrompt('Custom Widget', 'URL', widgetConfig.url || 'http://192.168.4.90:3001/status/connection');
    if (!url) return;
    updateWidget(widgetId, { url });
    renderDashboard();
  } else if (widgetConfig.type === 'search') {
    const query = await showPrompt('Google Search', 'Search query', widgetConfig.query || '');
    if (query !== null) {
      updateWidget(widgetId, { query: query.trim() });
      renderDashboard();
    }
  } else if (widgetConfig.type === 'speedtest') {
    const interval = await showPrompt('Widget Settings', 'Refresh interval (ms, 0 = manual)', widgetConfig.refreshInterval || 30000);
    if (interval !== null) {
      updateWidget(widgetId, { refreshInterval: parseInt(interval) || 0 });
      renderDashboard();
    }
  } else if (widgetConfig.type === 'weather') {
    const city = await showPrompt('Weather', 'City', widgetConfig.city || 'Bend');
    const state = await showPrompt('Weather', 'State', widgetConfig.state || 'Oregon');
    if (city !== null && state !== null) {
      updateWidget(widgetId, { city: city.trim(), state: state.trim() });
      renderDashboard();
    }
  } else if (widgetConfig.type === 'uptime-kuma') {
    const baseUrl = await showPrompt('Uptime Kuma', 'Base URL', widgetConfig.baseUrl || 'http://192.168.4.90:3001');
    if (!baseUrl) return;
    const slug = await showPrompt('Uptime Kuma', 'Status Page Slug', widgetConfig.slug || '');
    if (!slug) return;
    const apiKey = await showPrompt('Uptime Kuma', 'API Key (optional)', widgetConfig.apiKey || '');
    const updates = { baseUrl, slug };
    if (apiKey) {
      updates.apiKey = apiKey;
      updates.mode = 'metrics';
    } else {
      updates.mode = 'status';
      updates.apiKey = undefined;
    }
    updateWidget(widgetId, updates);
    renderDashboard();
    setTimeout(() => {
      const w = activeWidgets.find(aw => aw.config.id === widgetId);
      if (w) w.widget.load();
    }, 100);
  } else if (widgetConfig.type === 'pihole') {
    const baseUrl = await showPrompt('Pi-hole', 'Base URL', widgetConfig.baseUrl || 'http://192.168.4.90');
    if (!baseUrl) return;
    const password = await showPrompt('Pi-hole', 'Web UI Password (optional)', widgetConfig.password || '');
    const updates = { baseUrl };
    if (password) {
      updates.password = password;
    } else {
      updates.password = undefined;
    }
    updateWidget(widgetId, updates);
    renderDashboard();
    setTimeout(() => {
      const w = activeWidgets.find(aw => aw.config.id === widgetId);
      if (w) w.widget.load();
    }, 100);
  }
}

function exportLayout() {
  const layout = {
    version: 1,
    exportedAt: new Date().toISOString(),
    widgets: getWidgets().map(w => ({
      id: w.id,
      type: w.type,
      title: w.title,
      gridCol: w.gridCol,
      gridRow: w.gridRow,
      gridColSpan: w.gridColSpan,
      gridRowSpan: w.gridRowSpan,
      enabled: w.enabled,
      order: w.order,
      refreshInterval: w.refreshInterval,
      ...(w.type === 'links' && { links: w.links }),
      ...(w.type === 'github' && { user: w.user, repo: w.repo }),
      ...(w.type === 'custom' && { url: w.url }),
      ...(w.type === 'search' && { query: w.query }),
      ...(w.type === 'speedtest' && { refreshInterval: w.refreshInterval }),
      ...(w.type === 'weather' && { city: w.city, state: w.state }),
      ...(w.type === 'uptime-kuma' && { baseUrl: w.baseUrl, slug: w.slug, apiKey: w.apiKey, mode: w.mode }),
      ...(w.type === 'pihole' && { baseUrl: w.baseUrl, password: w.password })
    }))
  };

  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard-layout-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importLayout(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const layout = JSON.parse(e.target.result);
      if (!layout.widgets || !Array.isArray(layout.widgets)) {
        await showAlert('Invalid Layout', 'Invalid layout file');
        return;
      }

      if (!await showConfirm('Import Layout', 'This will replace your current layout. Continue?')) return;

      config.widgets = layout.widgets.map(w => ({
        id: w.id || `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: w.type,
        title: w.title || 'Widget',
        enabled: w.enabled !== false,
        order: w.order || 0,
        gridCol: w.gridCol,
        gridRow: w.gridRow,
        gridColSpan: w.gridColSpan,
        gridRowSpan: w.gridRowSpan,
        refreshInterval: w.refreshInterval || 30000,
        ...(w.type === 'links' && { links: w.links || [] }),
        ...(w.type === 'github' && { user: w.user, repo: w.repo }),
        ...(w.type === 'custom' && { url: w.url }),
        ...(w.type === 'search' && { query: w.query || '' }),
        ...(w.type === 'speedtest' && { refreshInterval: w.refreshInterval || 30000 }),
        ...(w.type === 'weather' && { city: w.city || 'Bend', state: w.state || 'Oregon' }),
        ...(w.type === 'uptime-kuma' && { baseUrl: w.baseUrl, slug: w.slug, apiKey: w.apiKey, mode: w.mode }),
        ...(w.type === 'pihole' && { baseUrl: w.baseUrl, password: w.password })
      }));

      saveConfig();
      renderDashboard();
      await showAlert('Success', 'Layout imported successfully');
    } catch (err) {
      await showAlert('Import Failed', 'Failed to parse layout file: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function closePanel() {
  const panel = document.getElementById('add-widget-panel');
  if (panel) panel.style.display = 'none';
}

let currentLinksWidgetId = null;
let currentLinks = [];
let currentEmojiField = null;

const EMOJIS = ['🔗', '📊', '🐳', '🕳️', '📈', '🖥️', '📁', '🐙', '⚡', '🔥', '💡', '🎯', '🚀', '⚙️', '📱', '💻', '🖧️', '📡', '🔐', '🔧', '🏠', '🌐', '📦', '🧩', '📝', '🎮', '🎵', '📚', '🔍', '📌', '🗂️', '📎', '✂️', '📏', '🧮', '💾', '🖨️', '⌨️', '🖱️', '💿', '📀', '📹', '📷', '🔎', '🔦', '💡', '🔌', '🔋', '📡', '📶'];

const FONT_AWESOME_ICONS = [
  { class: 'fa-brands fa-docker', label: 'Docker' },
  { class: 'fa-brands fa-youtube', label: 'YouTube' },
  { class: 'fa-brands fa-github', label: 'GitHub' },
  { class: 'fa-brands fa-microsoft', label: 'Microsoft' },
  { class: 'fa-brands fa-google', label: 'Google' },
  { class: 'fa-brands fa-twitter', label: 'Twitter' },
  { class: 'fa-brands fa-facebook', label: 'Facebook' },
  { class: 'fa-brands fa-reddit', label: 'Reddit' },
  { class: 'fa-brands fa-discord', label: 'Discord' },
  { class: 'fa-brands fa-slack', label: 'Slack' },
  { class: 'fa-brands fa-gitlab', label: 'GitLab' },
  { class: 'fa-brands fa-bitbucket', label: 'Bitbucket' },
  { class: 'fa-brands fa-aws', label: 'AWS' },
  { class: 'fa-brands fa-linux', label: 'Linux' },
  { class: 'fa-brands fa-windows', label: 'Windows' },
  { class: 'fa-brands fa-apple', label: 'Apple' },
  { class: 'fa-brands fa-android', label: 'Android' },
  { class: 'fa-brands fa-chrome', label: 'Chrome' },
  { class: 'fa-brands fa-firefox', label: 'Firefox' },
  { class: 'fa-brands fa-safari', label: 'Safari' },
  { class: 'fa-solid fa-server', label: 'Server' },
  { class: 'fa-solid fa-house', label: 'Home' },
  { class: 'fa-solid fa-globe', label: 'Website' },
  { class: 'fa-solid fa-link', label: 'Link' },
  { class: 'fa-solid fa-ban', label: 'Block' },
  { class: 'fa-solid fa-rocket', label: 'Launch' },
  { class: 'fa-solid fa-camera', label: 'Camera' },
  { class: 'fa-solid fa-video', label: 'Video' },
  { class: 'fa-solid fa-radio', label: 'Radio' },
  { class: 'fa-solid fa-terminal', label: 'Terminal' },
  { class: 'fa-solid fa-code', label: 'Code' },
  { class: 'fa-solid fa-laptop-code', label: 'Laptop' },
  { class: 'fa-solid fa-diagram-project', label: 'Diagram' },
  { class: 'fa-solid fa-temperature-low', label: 'Temp' },
  { class: 'fa-solid fa-brain', label: 'Brain' },
  { class: 'fa-solid fa-bolt', label: 'Lightning' },
  { class: 'fa-solid fa-shield-halved', label: 'Shield' },
  { class: 'fa-solid fa-lock', label: 'Lock' },
  { class: 'fa-solid fa-wifi', label: 'WiFi' },
  { class: 'fa-solid fa-database', label: 'Database' },
  { class: 'fa-solid fa-chart-line', label: 'Chart' },
  { class: 'fa-solid fa-bell', label: 'Bell' },
  { class: 'fa-solid fa-gear', label: 'Settings' },
  { class: 'fa-solid fa-circle-info', label: 'Info' },
  { class: 'fa-solid fa-triangle-exclamation', label: 'Warning' },
  { class: 'fa-solid fa-heart', label: 'Heart' },
  { class: 'fa-solid fa-star', label: 'Star' },
  { class: 'fa-solid fa-bookmark', label: 'Bookmark' },
  { class: 'fa-solid fa-folder', label: 'Folder' },
  { class: 'fa-solid fa-file', label: 'File' }
];

const ICON_KEYWORDS = [
  { keywords: ['youtube'], class: 'fa-brands fa-youtube' },
  { keywords: ['docker'], class: 'fa-brands fa-docker' },
  { keywords: ['github', 'git'], class: 'fa-brands fa-github' },
  { keywords: ['microsoft', 'vscode', 'office'], class: 'fa-brands fa-microsoft' },
  { keywords: ['google', 'gmail', 'drive'], class: 'fa-brands fa-google' },
  { keywords: ['twitter', 'x.com'], class: 'fa-brands fa-twitter' },
  { keywords: ['facebook', 'fb.com'], class: 'fa-brands fa-facebook' },
  { keywords: ['reddit'], class: 'fa-brands fa-reddit' },
  { keywords: ['discord'], class: 'fa-brands fa-discord' },
  { keywords: ['slack'], class: 'fa-brands fa-slack' },
  { keywords: ['gitlab'], class: 'fa-brands fa-gitlab' },
  { keywords: ['bitbucket'], class: 'fa-brands fa-bitbucket' },
  { keywords: ['aws', 'amazon'], class: 'fa-brands fa-aws' },
  { keywords: ['linux'], class: 'fa-brands fa-linux' },
  { keywords: ['windows'], class: 'fa-brands fa-windows' },
  { keywords: ['apple', 'macos', 'ios'], class: 'fa-brands fa-apple' },
  { keywords: ['android'], class: 'fa-brands fa-android' },
  { keywords: ['chrome'], class: 'fa-brands fa-chrome' },
  { keywords: ['firefox'], class: 'fa-brands fa-firefox' },
  { keywords: ['safari'], class: 'fa-brands fa-safari' },
  { keywords: ['zimaos', 'zima'], class: 'fa-solid fa-server' },
  { keywords: ['home assistant', 'assistant'], class: 'fa-solid fa-house' },
  { keywords: ['portainer'], class: 'fa-brands fa-docker' },
  { keywords: ['pihole', 'dns', 'block'], class: 'fa-solid fa-ban' },
  { keywords: ['octopi', 'camera', 'printer'], class: 'fa-solid fa-camera' },
  { keywords: ['cooler', 'temperature', 'temp'], class: 'fa-solid fa-temperature-low' },
  { keywords: ['container flow', 'flow'], class: 'fa-solid fa-diagram-project' },
  { keywords: ['patrol', 'video'], class: 'fa-solid fa-video' },
  { keywords: ['radio', 'police'], class: 'fa-solid fa-radio' },
  { keywords: ['second brain', 'brain'], class: 'fa-solid fa-brain' },
  { keywords: ['terminal', 'ssh', 'shell'], class: 'fa-solid fa-terminal' },
  { keywords: ['vscode', 'code', 'editor'], class: 'fa-solid fa-laptop-code' },
  { keywords: ['uptime', 'kuma', 'monitor'], class: 'fa-solid fa-chart-line' },
  { keywords: ['weather', 'forecast'], class: 'fa-solid fa-cloud' },
  { keywords: ['speedtest', 'speed', 'internet'], class: 'fa-solid fa-gauge-high' },
  { keywords: ['storage', 'disk', 'drive'], class: 'fa-solid fa-database' },
  { keywords: ['grafana'], class: 'fa-solid fa-chart-area' },
  { keywords: ['wiki', 'confluence'], class: 'fa-solid fa-book' },
  { keywords: ['email', 'mail', 'outlook'], class: 'fa-solid fa-envelope' },
  { keywords: ['calendar'], class: 'fa-solid fa-calendar' },
  { keywords: ['files', 'filebrowser', 'file manager'], class: 'fa-solid fa-folder-open' },
  { keywords: ['backup'], class: 'fa-solid fa-cloud-arrow-up' },
  { keywords: ['security', 'camera', 'surveillance'], class: 'fa-solid fa-shield-halved' },
  { keywords: ['network', 'router', 'switch'], class: 'fa-solid fa-network-wired' },
  { keywords: ['power', 'ups'], class: 'fa-solid fa-bolt' },
  { keywords: ['music', 'spotify'], class: 'fa-solid fa-music' }
];

function suggestIconForLink(label, url) {
  const text = `${label} ${url}`.toLowerCase();
  for (const entry of ICON_KEYWORDS) {
    if (entry.keywords.some(kw => text.includes(kw))) {
      return entry.class;
    }
  }
  return null;
}

function openLinkEditor(widgetId) {
  const widgetConfig = config.widgets.find(w => w.id === widgetId);
  if (!widgetConfig) return;
  
  currentLinksWidgetId = widgetId;
  currentLinks = [...(widgetConfig.links || [])];
  
  renderLinkEditorList();
  renderEmojiPicker();
  renderIconPicker();
  
  const modal = document.getElementById('link-editor-modal');
  if (modal) modal.style.display = 'flex';
}

function closeLinkEditor() {
  const modal = document.getElementById('link-editor-modal');
  if (modal) modal.style.display = 'none';
  currentLinksWidgetId = null;
  currentLinks = [];
  hideEmojiPicker();
  hideIconPicker();
}

function renderEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  
  picker.innerHTML = EMOJIS.map(emoji => `
    <button class="emoji-option" type="button">${emoji}</button>
  `).join('');
}

function renderIconPicker() {
  const picker = document.getElementById('icon-picker');
  if (!picker) return;
  
  picker.innerHTML = FONT_AWESOME_ICONS.map(icon => `
    <button class="icon-option" type="button" data-icon-class="${icon.class}" title="${icon.label}">
      <i class="${icon.class}"></i>
    </button>
  `).join('');
}

function showEmojiPicker(button, field) {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  
  currentEmojiField = field;
  
  const rect = button.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.classList.add('active');
}

function showIconPicker(button, field) {
  const picker = document.getElementById('icon-picker');
  if (!picker) return;
  
  currentEmojiField = field;
  
  const rect = button.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top = (rect.bottom + 4) + 'px';
  picker.classList.add('active');
}

function hideEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.remove('active');
  currentEmojiField = null;
}

function hideIconPicker() {
  const picker = document.getElementById('icon-picker');
  if (picker) picker.classList.remove('active');
}

function renderLinkEditorList() {
  const list = document.getElementById('link-editor-list');
  if (!list) return;
  
  if (currentLinks.length === 0) {
    list.innerHTML = '<div class="empty-state">No links yet. Click "+ Add Link" to add one.</div>';
    return;
  }
  
  list.innerHTML = currentLinks.map((link, index) => {
    const icon = link.icon ? (link.icon.startsWith('fa-') ? `<i class="${link.icon}"></i>` : link.icon) : '🔗';
    return `
      <div class="link-editor-item" data-index="${index}">
        <button class="icon-picker-btn" type="button" data-index="${index}">${icon}</button>
        <input type="text" class="link-label-input" value="${link.label || ''}" placeholder="Label" data-field="label">
        <input type="text" class="link-url-input" value="${link.url || ''}" placeholder="https://..." data-field="url">
        <button class="link-delete-btn" data-action="delete" title="Delete">×</button>
      </div>
    `;
  }).join('');
}

function saveLinks() {
  if (!currentLinksWidgetId) return;
  
  const items = document.querySelectorAll('.link-editor-item');
  
  items.forEach((item, i) => {
    if (currentLinks[i]) {
      currentLinks[i].label = item.querySelector('[data-field="label"]')?.value || 'Link';
      currentLinks[i].url = item.querySelector('[data-field="url"]')?.value || '#';
      if (currentLinks[i].icon === 'fa-solid fa-link') {
        const suggested = suggestIconForLink(currentLinks[i].label, currentLinks[i].url);
        if (suggested) {
          currentLinks[i].icon = suggested;
        }
      }
    }
  });
  
  updateWidget(currentLinksWidgetId, { links: [...currentLinks] });
  closeLinkEditor();
  renderDashboard();
}

document.getElementById('link-editor-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'link-editor-modal') {
    closeLinkEditor();
  }
});

document.getElementById('close-link-editor')?.addEventListener('click', closeLinkEditor);

document.getElementById('add-link-btn')?.addEventListener('click', () => {
  currentLinks.push({ icon: 'fa-solid fa-link', label: '', url: '' });
  renderLinkEditorList();
});

document.getElementById('save-links-btn')?.addEventListener('click', saveLinks);

document.getElementById('link-editor-list')?.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('[data-action="delete"]');
  if (deleteBtn) {
    const item = deleteBtn.closest('.link-editor-item');
    if (!item) return;
    
    const index = parseInt(item.dataset.index);
    if (!isNaN(index)) {
      currentLinks.splice(index, 1);
      renderLinkEditorList();
    }
    return;
  }
  
  const iconBtn = e.target.closest('.icon-picker-btn');
  if (iconBtn) {
    const index = parseInt(iconBtn.dataset.index);
    if (!isNaN(index) && currentLinks[index]) {
      showIconPicker(iconBtn, index);
    }
  }
});

document.getElementById('link-editor-list')?.addEventListener('input', (e) => {
  const item = e.target.closest('.link-editor-item');
  if (!item) return;
  
  const index = parseInt(item.dataset.index);
  const field = e.target.dataset.field;
  
  if (!isNaN(index) && field && currentLinks[index] !== undefined) {
    currentLinks[index][field] = e.target.value;
    if ((field === 'label' || field === 'url') && currentLinks[index].icon === 'fa-solid fa-link') {
      const suggested = suggestIconForLink(currentLinks[index].label, currentLinks[index].url);
      if (suggested) {
        currentLinks[index].icon = suggested;
        renderLinkEditorList();
      }
    }
  }
});

document.getElementById('emoji-picker')?.addEventListener('click', (e) => {
  const emojiOption = e.target.closest('.emoji-option');
  if (!emojiOption) return;
  
  const emoji = emojiOption.textContent || '';
  if (emoji && currentEmojiField !== null && currentLinks[currentEmojiField]) {
    currentLinks[currentEmojiField].icon = emoji;
    renderLinkEditorList();
    hideEmojiPicker();
  }
});

document.getElementById('icon-picker')?.addEventListener('click', (e) => {
  const iconOption = e.target.closest('.icon-option');
  if (!iconOption) return;
  
  const iconClass = iconOption.dataset.iconClass || '';
  if (iconClass && currentEmojiField !== null && currentLinks[currentEmojiField]) {
    currentLinks[currentEmojiField].icon = iconClass;
    renderLinkEditorList();
    hideIconPicker();
  }
});

document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  const iconPicker = document.getElementById('icon-picker');
  const iconBtn = e.target.closest('.icon-picker-btn');
  
  if ((!picker && !iconPicker) || iconBtn) {
    return;
  }
  
  hideEmojiPicker();
  hideIconPicker();
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-search-form]');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('[data-search-input]');
  const query = input?.value?.trim();
  if (!query) return;
  const widgetEl = form.closest('.widget');
  const widgetId = widgetEl?.dataset?.id;
  if (widgetId) {
    updateWidget(widgetId, { query });
  }
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfigAsync();
  applyTheme(getTheme());
  applyUnit(getUnit());
  init();
});
