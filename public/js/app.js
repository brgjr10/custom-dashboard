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

let activeWidgets = [];
let refreshTimers = {};
let editMode = false;

function init() {
  loadConfig();
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
        widget.load();
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
    option.addEventListener('click', () => {
      const type = option.dataset.type;
      const typeConfig = WIDGET_TYPES[type];
      const overrides = {};
      
      if (type === 'links') {
        overrides.links = [];
      } else if (type === 'github') {
        overrides.user = prompt('GitHub username:', 'brgjr10');
        if (!overrides.user) return;
        const repo = prompt('GitHub repo (leave blank for entire account):', '');
        if (repo) overrides.repo = repo;
      } else if (type === 'custom') {
        overrides.url = prompt('Enter URL:', 'http://192.168.4.90:3001/status/connection');
        if (!overrides.url) return;
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

  document.getElementById('widget-grid')?.addEventListener('click', (e) => {
    if (!editMode) return;
    
    const widgetEl = e.target.closest('.widget');
    if (!widgetEl) return;

    const actionBtn = e.target.closest('.widget-action');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const widgetId = widgetEl.dataset.id;
      
      if (action === 'remove') {
        if (confirm('Remove this widget?')) {
          removeWidget(widgetId);
          clearInterval(refreshTimers[widgetId]);
          renderDashboard();
        }
      } else if (action === 'configure') {
        configureWidget(widgetId);
      }
    }
  });

  document.getElementById('widget-grid')?.addEventListener('click', (e) => {
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
    
    fetch(endpoint, { method: 'POST' })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Action failed');
        
        const w = activeWidgets.find(aw => aw.config.id === widgetId);
        if (w) {
          w.widget.load().then(() => {
            dockerAction.disabled = false;
            dockerAction.textContent = action === 'start' ? '▶' : action === 'stop' ? '■' : '⟳';
          });
        }
      })
      .catch(err => {
        alert(err.message);
        dockerAction.disabled = false;
        dockerAction.textContent = action === 'start' ? '▶' : action === 'stop' ? '■' : '⟳';
      });
  });
}

function configureWidget(widgetId) {
  const widgetConfig = config.widgets.find(w => w.id === widgetId);
  if (!widgetConfig) return;

  if (widgetConfig.type === 'links') {
    openLinkEditor(widgetId);
  } else if (widgetConfig.type === 'github') {
    const user = prompt('GitHub username:', widgetConfig.user || '');
    if (!user) return;
    const repo = prompt('GitHub repo (leave blank to track entire account):', widgetConfig.repo || '');
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
    const url = prompt('Enter URL:', widgetConfig.url || 'http://192.168.4.90:3001/status/connection');
    if (!url) return;
    updateWidget(widgetId, { url });
    renderDashboard();
  } else if (widgetConfig.type === 'speedtest') {
    const interval = prompt('Refresh interval (ms, 0 = manual):', widgetConfig.refreshInterval || 30000);
    if (interval !== null) {
      updateWidget(widgetId, { refreshInterval: parseInt(interval) || 0 });
      renderDashboard();
    }
  } else if (widgetConfig.type === 'weather') {
    const city = prompt('City:', widgetConfig.city || 'Bend');
    const state = prompt('State:', widgetConfig.state || 'Oregon');
    if (city !== null && state !== null) {
      updateWidget(widgetId, { city: city.trim(), state: state.trim() });
      renderDashboard();
    }
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
      ...(w.type === 'speedtest' && { refreshInterval: w.refreshInterval }),
      ...(w.type === 'weather' && { city: w.city, state: w.state })
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

function importLayout(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const layout = JSON.parse(e.target.result);
      if (!layout.widgets || !Array.isArray(layout.widgets)) {
        alert('Invalid layout file');
        return;
      }

      if (!confirm('This will replace your current layout. Continue?')) return;

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
        ...(w.type === 'speedtest' && { refreshInterval: w.refreshInterval || 30000 }),
        ...(w.type === 'weather' && { city: w.city || 'Bend', state: w.state || 'Oregon' })
      }));

      saveConfig();
      renderDashboard();
      alert('Layout imported successfully');
    } catch (err) {
      alert('Failed to parse layout file: ' + err.message);
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

function openLinkEditor(widgetId) {
  const widgetConfig = config.widgets.find(w => w.id === widgetId);
  if (!widgetConfig) return;
  
  currentLinksWidgetId = widgetId;
  currentLinks = [...(widgetConfig.links || [])];
  
  renderLinkEditorList();
  renderEmojiPicker();
  
  const modal = document.getElementById('link-editor-modal');
  if (modal) modal.style.display = 'flex';
}

function closeLinkEditor() {
  const modal = document.getElementById('link-editor-modal');
  if (modal) modal.style.display = 'none';
  currentLinksWidgetId = null;
  currentLinks = [];
  hideEmojiPicker();
}

function renderEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  
  picker.innerHTML = EMOJIS.map(emoji => `
    <button class="emoji-option" type="button">${emoji}</button>
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

function hideEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.classList.remove('active');
  currentEmojiField = null;
}

function renderLinkEditorList() {
  const list = document.getElementById('link-editor-list');
  if (!list) return;
  
  if (currentLinks.length === 0) {
    list.innerHTML = '<div class="empty-state">No links yet. Click "+ Add Link" to add one.</div>';
    return;
  }
  
  list.innerHTML = currentLinks.map((link, index) => `
    <div class="link-editor-item" data-index="${index}">
      <button class="emoji-picker-btn" type="button" data-index="${index}">${link.icon || '🔗'}</button>
      <input type="text" class="link-label-input" value="${link.label || ''}" placeholder="Label" data-field="label">
      <input type="text" class="link-url-input" value="${link.url || ''}" placeholder="https://..." data-field="url">
      <button class="link-delete-btn" data-action="delete" title="Delete">×</button>
    </div>
  `).join('');
}

function saveLinks() {
  if (!currentLinksWidgetId) return;
  
  const items = document.querySelectorAll('.link-editor-item');
  
  items.forEach((item, i) => {
    if (currentLinks[i]) {
      currentLinks[i].label = item.querySelector('[data-field="label"]')?.value || 'Link';
      currentLinks[i].url = item.querySelector('[data-field="url"]')?.value || '#';
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
  currentLinks.push({ icon: '🔗', label: '', url: '' });
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
  
  const emojiBtn = e.target.closest('.emoji-picker-btn');
  if (emojiBtn) {
    const index = parseInt(emojiBtn.dataset.index);
    if (!isNaN(index) && currentLinks[index]) {
      showEmojiPicker(emojiBtn, index);
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

document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  const emojiBtn = e.target.closest('.emoji-picker-btn');
  
  if (!picker || !emojiBtn) {
    hideEmojiPicker();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfigAsync();
  applyTheme(getTheme());
  applyUnit(getUnit());
  init();
});
