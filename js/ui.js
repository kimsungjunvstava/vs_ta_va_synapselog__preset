// ── 스토리지 시스템 ──────────────────────────────────────────────────

let _useLocalStorage = localStorage.getItem('snlog_use_local') === 'true';
let _storageScopes = (() => { try { return JSON.parse(localStorage.getItem('snlog_scopes') || '{}'); } catch(e) { return {}; } })();
['pages','slider','connect'].forEach(k => { if (_storageScopes[k] === undefined) _storageScopes[k] = true; });
let _exportSize = parseInt(localStorage.getItem('snlog_export_size') || '2048');

function getStorage(scope) {
  if (_useLocalStorage && _storageScopes[scope] !== false) return localStorage;
  return sessionStorage;
}
function snSet(key, value, scope) {
  const s = scope ? getStorage(scope) : sessionStorage;
  try { s.setItem(key, value); } catch(e) {}
}
function snGet(key, scope) {
  if (scope && _useLocalStorage && _storageScopes[scope] !== false) {
    const lv = localStorage.getItem(key);
    if (lv !== null) return lv;
  }
  return sessionStorage.getItem(key);
}
function snRemove(key, scope) {
  sessionStorage.removeItem(key);
  if (scope) localStorage.removeItem(key);
}

// ── DOM 레퍼런스 & 캔버스 초기화 ─────────────────────────────────────

canvas = document.getElementById('c');
ctx = canvas.getContext('2d');
W = window.innerWidth; H = window.innerHeight;
canvas.width = W; canvas.height = H;

const tooltip = document.getElementById('tooltip');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('search-input');
const clearBtn = document.getElementById('clear-btn');
const cfgRep = document.getElementById('cfg-rep');
const cfgGrav = document.getElementById('cfg-grav');
const vRep = document.getElementById('v-rep');
const vGrav = document.getElementById('v-grav');
const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailDate = document.getElementById('detail-date');
const detailContent = document.getElementById('detail-content');

// ── 그래프 설정 슬라이더 ──────────────────────────────────────────────

function updateConfig() {
  CONFIG.repulsion = parseFloat(cfgRep.value);
  CONFIG.gravity = parseFloat(cfgGrav.value);
  vRep.textContent = Math.round(parseFloat(cfgRep.value) / 100);
  vGrav.textContent = Math.round(parseFloat(cfgGrav.value) * 10000);
  isStable = false;
  nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
  snSet('snlog_slider', JSON.stringify({ rep: cfgRep.value, grav: cfgGrav.value }), 'slider');
}
cfgRep.addEventListener('input', updateConfig);
cfgGrav.addEventListener('input', updateConfig);

// ── 로딩 오버레이 ─────────────────────────────────────────────────────

function showLoading(text='불러오는 중...') {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (el) el.classList.add('visible');
  if (txt) txt.textContent = text;
}
function setLoadingText(text) { const txt = document.getElementById('loading-text'); if (txt) txt.textContent = text; }
function hideLoading() { const el = document.getElementById('loading-overlay'); if (el) el.classList.remove('visible'); }

// ── 제목 표시 토글 ────────────────────────────────────────────────────

function toggleLabels() { const cb = document.getElementById('label-toggle-input'); _showLabels = cb ? cb.checked : !_showLabels; }

// ── 포커스 모드 ────────────────────────────────────────────────────────

function applyFocusMode(nodeId) {
  if (!_focusMode) return;
  _focusNodeId = nodeId;
  const connectedIds = new Set([nodeId]);
  edges.forEach(e => {
    if (e.from === nodeId) connectedIds.add(e.to);
    if (e.to === nodeId) connectedIds.add(e.from);
  });
  edges.forEach(e => {
    if (!e.manualLink) return;
    if (connectedIds.has(e.from)) connectedIds.add(e.to);
    if (connectedIds.has(e.to)) connectedIds.add(e.from);
  });
  nodes.forEach(n => { n.dimmed = !connectedIds.has(n.id); });
  isStable = false;
}

function toggleFocusMode() {
  const cb = document.getElementById('focus-toggle-input');
  _focusMode = cb ? cb.checked : !_focusMode;
  if (!_focusMode) { _focusNodeId = null; nodes.forEach(n => { n.dimmed = false; }); }
  else if (_focusNodeId) applyFocusMode(_focusNodeId);
  isStable = false;
}

// ── 연결 모드 ─────────────────────────────────────────────────────────

function toggleConnectMode() {
  const cb = document.getElementById('connect-toggle-input');
  _connectMode = cb ? cb.checked : !_connectMode;
  if (_connectFirstNode) { _connectFirstNode.connectSelected = false; _connectFirstNode = null; }
  if (!_connectMode) nodes.forEach(n => { n.connectSelected = false; });
  const s = document.getElementById('status');
  if (_connectMode && s) { s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요'; closePanel(); }
  else if (s) s.textContent = '';
  isStable = false;
}

function handleConnectClick(n) {
  const s = document.getElementById('status');
  if (!_connectFirstNode) {
    _connectFirstNode = n; n.connectSelected = true;
    if (s) s.textContent = `"${n.label}" 선택됨 — 연결할 노드를 클릭하세요`;
  } else if (_connectFirstNode.id === n.id) {
    _connectFirstNode.connectSelected = false; _connectFirstNode = null;
    if (s) s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요';
  } else {
    const a = _connectFirstNode, b = n;
    const existingManual = edges.find(e => e.manualLink && ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)));
    if (existingManual) {
      removeManualLink(a.id, b.id);
      if (s) s.textContent = `"${a.label}" ↔ "${b.label}" 연결 삭제 — 계속 연결할 노드를 클릭하세요`;
    } else {
      edges.push({ from: a.id, to: b.id, manualLink: true }); saveManualLinks();
      if (s) s.textContent = `"${a.label}" ↔ "${b.label}" 연결됨 — 계속 연결할 노드를 클릭하세요`;
    }
  }
  isStable = false;
}

function saveManualLinks() {
  const manual = edges.filter(e => e.manualLink).map(e => {
    const na = nodeMap[e.from], nb = nodeMap[e.to];
    if (!na || !nb) return null;
    return { from: e.from, to: e.to, fromKey: `${na.sourcePageId || ''}::${na.label}`, toKey: `${nb.sourcePageId || ''}::${nb.label}` };
  }).filter(Boolean);
  snSet('snlog_manual_links', JSON.stringify(manual), 'connect');
}

function loadManualLinks() {
  const saved = snGet('snlog_manual_links', 'connect');
  if (!saved) return;
  let links; try { links = JSON.parse(saved); } catch(e) { return; }
  links.forEach(link => {
    if (link.fromKey && link.toKey) {
      const na = nodes.find(n => `${n.sourcePageId || ''}::${n.label}` === link.fromKey);
      const nb = nodes.find(n => `${n.sourcePageId || ''}::${n.label}` === link.toKey);
      if (na && nb) {
        const exists = edges.some(e => (e.from === na.id && e.to === nb.id) || (e.from === nb.id && e.to === na.id));
        if (!exists) edges.push({ from: na.id, to: nb.id, manualLink: true });
      }
    } else if (link.from && link.to) {
      if (nodeMap[link.from] && nodeMap[link.to]) {
        const exists = edges.some(e => (e.from === link.from && e.to === link.to) || (e.from === link.to && e.to === link.from));
        if (!exists) edges.push({ from: link.from, to: link.to, manualLink: true });
      }
    }
  });
  isStable = false;
}

function removeManualLink(fromId, toId) {
  edges = edges.filter(e => !(e.manualLink && ((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))));
  saveManualLinks(); isStable = false;
}

// ── 사이드바 토글 ─────────────────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle');
  const collapsed = sidebar.classList.toggle('collapsed');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="1" x2="6" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;
  btn.style.left = collapsed ? '12px' : '394px';
}

// ── 디테일 패널 (탭) ──────────────────────────────────────────────────

let _detailPanelCollapsed = false;
const PANEL_SVG_RIGHT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" stroke-width="1.5"/></svg>`;

function toggleDetailPanel() {
  _detailPanelCollapsed = !_detailPanelCollapsed;
  const panel = document.getElementById('detail-panel'), btn = document.getElementById('detail-panel-sidebar-toggle');
  if (_detailPanelCollapsed) { panel.classList.add('panel-collapsed'); if (btn) { btn.innerHTML = PANEL_SVG_RIGHT; btn.classList.add('collapsed'); } }
  else { panel.classList.remove('panel-collapsed'); if (btn) { btn.innerHTML = PANEL_SVG_RIGHT; btn.classList.remove('collapsed'); } }
}

let _tabs = [], _activeTabId = null;

function renderTabs() {
  const tabsEl = document.getElementById('detail-tabs'), overflowBtn = document.getElementById('tab-overflow-btn');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';
  const reversed = [..._tabs].reverse();
  const MAX_VISIBLE = 3;
  const visibleTabs = reversed.slice(0, MAX_VISIBLE), hiddenTabs = reversed.slice(MAX_VISIBLE);
  visibleTabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'detail-tab' + (tab.nodeId === _activeTabId ? ' active' : '');
    el.innerHTML = `<span class="tab-label">${tab.label}</span><span class="tab-close">✕</span>`;
    el.querySelector('.tab-label').onclick = () => switchTab(tab.nodeId);
    el.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeTab(tab.nodeId); };
    tabsEl.appendChild(el);
  });
  if (overflowBtn) overflowBtn.style.display = hiddenTabs.length > 0 ? 'flex' : 'none';
}

function toggleOverflowMenu(e) {
  const menu = document.getElementById('tab-overflow-menu'), btn = document.getElementById('tab-overflow-btn');
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  menu.classList.toggle('open');
  if (!isOpen) {
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px'; menu.style.right = (window.innerWidth - rect.right) + 'px';
    menu.innerHTML = _tabs.map(tab => `<div class="overflow-tab-item ${tab.nodeId === _activeTabId ? 'active' : ''}" onclick="switchTab('${tab.nodeId}');closeOverflowMenu()"><span>${tab.label}</span><span class="overflow-close" onclick="event.stopPropagation();closeTab('${tab.nodeId}');closeOverflowMenu()">✕</span></div>`).join('');
  }
}
function closeOverflowMenu() { const menu = document.getElementById('tab-overflow-menu'); if (menu) menu.classList.remove('open'); }
document.addEventListener('click', (e) => { if (!e.target.closest('#tab-overflow-btn') && !e.target.closest('#tab-overflow-menu')) closeOverflowMenu(); });

function switchTab(nodeId) { _activeTabId = nodeId; const tab = _tabs.find(t => t.nodeId === nodeId); if (tab) renderPanelContent(tab.node); renderTabs(); }
function closeTab(nodeId) {
  const idx = _tabs.findIndex(t => t.nodeId === nodeId);
  _tabs = _tabs.filter(t => t.nodeId !== nodeId);
  if (_tabs.length === 0) { closePanel(); } else { const next = _tabs[Math.min(idx, _tabs.length - 1)]; switchTab(next.nodeId); }
  renderTabs();
}

function renderPanelContent(n) {
  if (detailTitle) detailTitle.textContent = n.label;
  if (detailDate) {
    if (n.date) { detailDate.style.display = 'inline'; detailDate.textContent = n.date; }
    else { detailDate.style.display = 'none'; }
  }
  let notionLinkEl = document.getElementById('detail-notion-link');
  if (!notionLinkEl) {
    notionLinkEl = document.createElement('a');
    notionLinkEl.id = 'detail-notion-link'; notionLinkEl.target = '_blank';
    notionLinkEl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#ff9f43;text-decoration:none;margin-left:8px;opacity:0.8;';
    notionLinkEl.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Notion에서 보기`;
    if (detailTitle) detailTitle.parentElement.appendChild(notionLinkEl);
  }
  const pid = n.sourcePageId || '';
  if (pid) { notionLinkEl.href = `https://notion.so/${pid.replace(/-/g, '')}`; notionLinkEl.style.display = 'inline-flex'; }
  else { notionLinkEl.style.display = 'none'; }

  let rawDesc = (n.desc || '(내용 없음)').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  if (searchKeyword && searchMatches.has(n.id)) {
    const re = new RegExp(`(${searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    rawDesc = rawDesc.replace(re, '<mark style="background:rgba(255,159,67,0.35);color:#ff9f43;border-radius:3px;padding:0 2px;">$1</mark>');
  }
  if (detailContent) {
    detailContent.innerHTML = rawDesc;
    if (searchKeyword && searchMatches.has(n.id)) {
      setTimeout(() => { const mark = detailContent.querySelector('mark'); if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
    }
  }
}

function openPanel(n) {
  const existing = _tabs.find(t => t.nodeId === n.id);
  if (existing) { switchTab(n.id); }
  else { _tabs.push({ nodeId: n.id, label: n.label, node: n }); _activeTabId = n.id; renderPanelContent(n); renderTabs(); }
  _detailPanelCollapsed = false;
  detailPanel.classList.add('open'); detailPanel.classList.remove('panel-collapsed');
  statusEl.classList.add('panel-open');
  const toggleBtn = document.getElementById('detail-panel-sidebar-toggle');
  if (toggleBtn) { toggleBtn.classList.add('visible'); toggleBtn.classList.remove('collapsed'); toggleBtn.innerHTML = PANEL_SVG_RIGHT; }
  if (_focusMode) applyFocusMode(n.id);
}

function closePanel() {
  _tabs = []; _activeTabId = null; _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  renderTabs();
  const toggleBtn = document.getElementById('detail-panel-sidebar-toggle');
  if (toggleBtn) toggleBtn.classList.remove('visible', 'collapsed');
}

function hidePanel() {
  if (!detailPanel.classList.contains('open')) return;
  _detailPanelCollapsed = false;
  detailPanel.classList.remove('open', 'panel-collapsed');
  statusEl.classList.remove('panel-open');
  const toggleBtn = document.getElementById('detail-panel-sidebar-toggle');
  if (toggleBtn) toggleBtn.classList.remove('visible', 'collapsed');
}

// ── 검색 ──────────────────────────────────────────────────────────────

const _searchHistory = [];
const MAX_HISTORY = 8;

function renderSearchHistory() {
  const container = document.getElementById('search-history');
  if (!container) return;
  container.innerHTML = '';
  _searchHistory.forEach((kw, idx) => {
    const item = document.createElement('div');
    item.className = 'search-history-item';
    item.innerHTML = `<span>${kw}</span><button class="search-history-del" onclick="deleteHistory(${idx},event)">✕</button>`;
    item.addEventListener('click', () => { searchInput.value = kw; doSearch(kw); });
    container.appendChild(item);
  });
}

function addHistory(kw) {
  if (!kw || kw.length < 1) return;
  const idx = _searchHistory.indexOf(kw);
  if (idx !== -1) _searchHistory.splice(idx, 1);
  _searchHistory.unshift(kw);
  if (_searchHistory.length > MAX_HISTORY) _searchHistory.pop();
  renderSearchHistory();
}

function deleteHistory(idx, e) { e.stopPropagation(); _searchHistory.splice(idx, 1); renderSearchHistory(); }

function doSearch(kw) {
  searchKeyword = kw.trim().toLowerCase();
  searchMatches.clear();
  const resultEl = document.getElementById('search-result-count');
  if (searchKeyword) {
    const directMatches = new Set();
    nodes.forEach(n => {
      if (!n.visible) return;
      const lt = n.label.toLowerCase(), dt = n.desc.toLowerCase();
      if (lt.includes(searchKeyword) || dt.includes(searchKeyword)) directMatches.add(n.id);
    });
    function getAncestors(nodeId) {
      const ancestors = []; let cur = nodeId;
      for (let i = 0; i < 10; i++) { const parentEdge = edges.find(e => e.to === cur && !e.weakLink); if (!parentEdge) break; ancestors.push(parentEdge.from); cur = parentEdge.from; }
      return ancestors;
    }
    directMatches.forEach(id => { searchMatches.add(id); getAncestors(id).forEach(aid => searchMatches.add(aid)); });
    if (resultEl) { resultEl.style.display = 'block'; resultEl.textContent = `${directMatches.size}개 결과`; }
    clearBtn.style.display = 'block';
  } else {
    if (resultEl) resultEl.style.display = 'none';
    clearBtn.style.display = 'none';
  }
  isStable = false;
}

searchInput.addEventListener('input', e => doSearch(e.target.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { const kw = searchInput.value.trim(); if (kw) addHistory(kw); doSearch(kw); } });
document.getElementById('search-btn').addEventListener('click', () => { const kw = searchInput.value.trim(); if (kw) addHistory(kw); doSearch(kw); });
clearBtn.addEventListener('click', () => { searchInput.value = ''; doSearch(''); });

document.getElementById('add-page-id').addEventListener('paste', function(e) {
  setTimeout(() => {
    const val = this.value.trim();
    const match = val.match(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i);
    if (match && (val.startsWith('http') || val.includes('notion'))) { this.value = match[1].replace(/-/g, ''); }
  }, 0);
});

// ── 캔버스 이벤트 ─────────────────────────────────────────────────────

let mouseDownNode = null, mouseDownTime = 0;

canvas.addEventListener('mousemove', e => {
  if (drag) {
    const w = screenToWorld(e.clientX, e.clientY); drag.x = w.x; drag.y = w.y;
    nodes.forEach(n => { if (n._frozen && dist(n, drag) < 200) { n._frozen = false; n._frozenFrames = 0; } });
    { const q = [drag.id], seen = new Set([drag.id]); while (q.length) { const id = q.shift(); edges.forEach(e => { if (e.from === id && !e.weakLink && !seen.has(e.to)) { seen.add(e.to); const c = nodeMap[e.to]; if (c) { if (c._frozen) { c._frozen = false; c._frozenFrames = 0; } q.push(e.to); } } }); } }
    return;
  }
  if (isPanning) { panX = panStartOffsetX + (e.clientX - panStartX); panY = panStartOffsetY + (e.clientY - panStartY); return; }
  const n = getNodeAt(e.clientX, e.clientY);
  hoveredNode = n; canvas.style.cursor = n ? 'pointer' : 'default';
  if (n && n.level > 0) {
    tooltip.textContent = n.label; tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px'; tooltip.style.top = (e.clientY - 32) + 'px';
  } else { tooltip.style.display = 'none'; }
});

canvas.addEventListener('mousedown', e => {
  mouseDownTime = Date.now();
  const n = getNodeAt(e.clientX, e.clientY);
  mouseDownNode = n;
  if (n) { drag = n; isStable = false; }
  else { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; panStartOffsetX = panX; panStartOffsetY = panY; canvas.style.cursor = 'grab'; }
});

canvas.addEventListener('mouseup', e => {
  const elapsed = Date.now() - mouseDownTime;
  const n = getNodeAt(e.clientX, e.clientY);
  if (elapsed < 150 && n && n === mouseDownNode && n.level > 0) {
    if (_connectMode) { handleConnectClick(n); } else { openPanel(n); }
  } else if (elapsed < 150 && !n) {
    if (_focusMode) { _focusNodeId = null; nodes.forEach(nd => { nd.dimmed = false; }); isStable = false; }
    if (_connectMode && _connectFirstNode) {
      _connectFirstNode.connectSelected = false; _connectFirstNode = null;
      const s = document.getElementById('status');
      if (s) s.textContent = '연결 모드: 첫 번째 노드를 클릭하세요';
      isStable = false;
    }
  }
  if (drag && drag.fixed) saveFixedPositions();
  drag = null; isPanning = false; canvas.style.cursor = 'default';
});

canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; hoveredNode = null; drag = null; isPanning = false; });

canvas.addEventListener('dblclick', e => {
  const n = getNodeAt(e.clientX, e.clientY);
  if (!n || n.level === 0) return;
  n.fixed = !n.fixed;
  if (!n.fixed) { n.vx = 0; n.vy = 0; }
  saveFixedPositions(); isStable = false;
  const s = document.getElementById('status');
  if (s) { s.textContent = n.fixed ? `📌 "${n.label}" 고정됨` : `"${n.label}" 고정 해제`; clearTimeout(canvas._st); canvas._st = setTimeout(() => { s.textContent = ''; }, 1800); }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const w = screenToWorld(e.clientX, e.clientY);
  let closest = null, minDist = 12 / scale;
  edges.filter(e2 => e2.manualLink).forEach(e2 => {
    const na = nodeMap[e2.from], nb = nodeMap[e2.to];
    if (!na?.visible || !nb?.visible) return;
    const dx = nb.x - na.x, dy = nb.y - na.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const t = Math.max(0, Math.min(1, ((w.x - na.x) * dx + (w.y - na.y) * dy) / (len * len)));
    const px = na.x + t * dx - w.x, py = na.y + t * dy - w.y;
    const d = Math.sqrt(px * px + py * py);
    if (d < minDist) { minDist = d; closest = e2; }
  });
  if (closest) { if (confirm(`"${nodeMap[closest.from]?.label}" ↔ "${nodeMap[closest.to]?.label}" 연결을 삭제할까요?`)) { removeManualLink(closest.from, closest.to); } }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.06 : 0.94;
  const mx = e.clientX, my = e.clientY;
  const wx = (mx - W / 2 - panX) / scale, wy = (my - H / 2 - panY) / scale;
  scale = Math.max(0.15, Math.min(4, scale * factor));
  panX = mx - W / 2 - wx * scale; panY = my - H / 2 - wy * scale;
  statusEl.textContent = `확대: ${Math.round(scale * 100)}%`;
  clearTimeout(canvas._st); canvas._st = setTimeout(() => { statusEl.textContent = ''; }, 1200);
}, { passive: false });

window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const root = nodes.find(n => n.level === 0);
  if (root) { root.x = W / 2; root.y = H / 2; }
  isStable = false;
});

// ── 언어 시스템 ────────────────────────────────────────────────────────

const LANG = {
  ko: {
    'pg-add':'페이지 추가','kw-search':'키워드 검색','graph-cfg':'그래프 설정',
    'lbl-title':'제목 표시','lbl-focus':'포커스 모드','lbl-connect':'연결 모드','lbl-fit':'화면 맞춤',
    'lbl-export':'이미지 내보내기','lbl-repulsion':'노드 반발력','lbl-gravity':'중력',
    'btn-add':'+ 노드 불러오기','ph-add':'노션 링크 붙여넣기 or .MD파일 불러오기','ph-search':'키워드 검색',
    'btn-sync-all':'전체 동기화','btn-close-all':'전체 닫기',
    's-lang':'언어 / Language','s-lang-label':'언어','s-lang-sub':'앱 UI 언어를 변경합니다',
    's-api':'API 토큰','sc-save':'저장','sc-placeholder-token':'새 토큰 입력...',
    's-imgsize':'이미지 저장 크기',
    's-shortcuts':'키보드 단축키','s-shortcuts-hint':'버튼 클릭 후 원하는 키 입력',
    'sc-lbl':'제목 표시','sc-lbl-sub':'제목 표시 / 그래프',
    'sc-focus':'포커스 모드','sc-focus-sub':'선택 노드만 표시',
    'sc-connect':'연결 모드','sc-connect-sub':'노드 수동 연결',
    'sc-fit':'화면 맞춤','sc-fit-sub':'전체 화면 맞춤',
    'sc-hide':'패널 숨기기','sc-hide-sub':'Esc (고정)',
    'sc-pin':'노드 고정 / 해제','sc-pin-sub':'더블클릭으로 고정','sc-dblclick':'더블클릭',
    's-local-warn':'⚠ API 토큰이 이 기기의 브라우저에 저장됩니다. 공용 컴퓨터에서는 사용을 권장하지 않습니다.',
    's-storage':'저장 & 캐시','s-local':'로컬 저장 사용','s-local-sub':'브라우저를 닫아도 데이터가 유지됩니다',
    's-page-cache':'페이지 캐시','s-page-cache-sub':'불러온 노션 페이지 내용',
    's-connect-cache':'연결 모드 캐시','s-connect-cache-sub':'수동 연결 엣지',
    's-all-cache':'전체 캐시','s-del':'삭제','s-del-all':'전체 삭제','s-close-btn':'닫기',
  },
  en: {
    'pg-add':'Add Page','kw-search':'Search','graph-cfg':'Graph Settings',
    'lbl-title':'Title Mark','lbl-focus':'Focus Mode','lbl-connect':'Connect Mode','lbl-fit':'Fit to View',
    'lbl-export':'Export PNG','lbl-repulsion':'Repulsion','lbl-gravity':'Gravity',
    'btn-add':'+ Load Nodes','ph-add':'Paste Notion link or import .MD','ph-search':'Search keywords',
    'btn-sync-all':'Sync All','btn-close-all':'Close All',
    's-lang':'Language','s-lang-label':'Language','s-lang-sub':'Change app UI language',
    's-api':'API Token','sc-save':'Save','sc-placeholder-token':'Enter new token...',
    's-imgsize':'Export Image Size',
    's-shortcuts':'Keyboard Shortcuts','s-shortcuts-hint':'Click a button, then press a key',
    'sc-lbl':'Toggle Labels','sc-lbl-sub':'Show/hide node labels',
    'sc-focus':'Focus Mode','sc-focus-sub':'Show selected node only',
    'sc-connect':'Connect Mode','sc-connect-sub':'Connect nodes manually',
    'sc-fit':'Fit to View','sc-fit-sub':'Fit graph to screen',
    'sc-hide':'Hide Panel','sc-hide-sub':'Esc (fixed)',
    'sc-pin':'Pin / Unpin Node','sc-pin-sub':'Double-click to pin','sc-dblclick':'Double-click',
    's-local-warn':'⚠ API token is stored in this browser. Not recommended on shared computers.',
    's-storage':'Storage & Cache','s-local':'Use Local Storage','s-local-sub':'Data persists after browser is closed',
    's-page-cache':'Page Cache','s-page-cache-sub':'Loaded Notion page content',
    's-connect-cache':'Connect Cache','s-connect-cache-sub':'Manual edge connections',
    's-all-cache':'All Cache','s-del':'Delete','s-del-all':'Delete All','s-close-btn':'Close',
  }
};

let _lang = localStorage.getItem('snlog_lang') || 'ko';
function t(key) { return (LANG[_lang] || LANG.ko)[key] || (LANG.ko[key] || key); }
function setLang(lang) { _lang = lang; localStorage.setItem('snlog_lang', lang); applyLang(); }
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.dataset.i18n); if (v) el.textContent = v; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const v = t(el.dataset.i18nPh); if (v) el.placeholder = v; });
  ['ko','en'].forEach(l => { document.getElementById('lang-btn-' + l)?.classList.toggle('active', _lang === l); });
}
function toggleSection(id) {
  const body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (arrow) arrow.textContent = isOpen ? '▸' : '▾';
  localStorage.setItem('snlog_sec_' + id, isOpen ? '0' : '1');
}

// ── 단축키 시스템 ─────────────────────────────────────────────────────

const DEFAULT_SHORTCUTS = { toggleLabels: 't', toggleFocusMode: 'f', toggleConnectMode: 'c', fitGraph: ' ' };
let _shortcuts = (() => { try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem('snlog_shortcuts') || '{}') }; } catch(e) { return { ...DEFAULT_SHORTCUTS }; } })();
function saveShortcuts() { localStorage.setItem('snlog_shortcuts', JSON.stringify(_shortcuts)); }
function formatKey(k) { return k === ' ' ? 'Space' : k.toUpperCase(); }

let _recordingFor = null, _recordingBtn = null;
function recordShortcut(action, btn) {
  if (_recordingFor) { _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); }
  _recordingFor = action; _recordingBtn = btn;
  btn.classList.add('recording'); btn.textContent = '...';
}

document.addEventListener('keydown', e => {
  if (_recordingFor) {
    e.preventDefault();
    if (e.key === 'Escape') { _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); _recordingFor = null; _recordingBtn = null; return; }
    const k = e.key;
    if (k.length === 1) { _shortcuts[_recordingFor] = k; saveShortcuts(); _recordingBtn.classList.remove('recording'); _recordingBtn.textContent = formatKey(k); _recordingFor = null; _recordingBtn = null; }
    return;
  }
  if (e.key === 'Escape') {
    if (document.getElementById('settings-modal').classList.contains('open')) { closeSettings(); return; }
    if (detailPanel.classList.contains('open')) { hidePanel(); }
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('collapsed')) { toggleSidebar(); }
    return;
  }
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === _shortcuts.toggleLabels) { e.preventDefault(); document.getElementById('label-toggle-input')?.click(); }
  else if (k === _shortcuts.toggleFocusMode) { e.preventDefault(); document.getElementById('focus-toggle-input')?.click(); }
  else if (k === _shortcuts.toggleConnectMode) { e.preventDefault(); document.getElementById('connect-toggle-input')?.click(); }
  else if (k === _shortcuts.fitGraph) { e.preventDefault(); fitGraph(); }
});

// ── 프로필 ────────────────────────────────────────────────────────────

let _profile = {};

async function loadProfile() {
  if (!_savedToken) return;
  try { _profile = await notionFetch({ action: 'profile' }); renderProfile(); } catch(e) {}
}

function renderProfile() {
  const profileEl = document.getElementById('sidebar-profile');
  if (profileEl) profileEl.style.display = 'flex';
  const initial = (_profile.name || '?')[0].toUpperCase();
  const initEl = document.getElementById('profile-initial');
  const avatarEl = document.getElementById('profile-avatar');
  if (_profile.avatar) {
    avatarEl.innerHTML = `<img src="${_profile.avatar}" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`;
  } else if (initEl) { initEl.textContent = initial; }
  const nameEl = document.getElementById('profile-name'), wsEl = document.getElementById('profile-workspace');
  if (nameEl) nameEl.textContent = _profile.name || '—';
  if (wsEl) wsEl.textContent = _profile.workspace || '';
}

// ── 설정 모달 ─────────────────────────────────────────────────────────

function openSettings() {
  const initial = (_profile.name || '?')[0].toUpperCase();
  const sAvatar = document.getElementById('settings-avatar'), sInitial = document.getElementById('settings-initial');
  if (_profile.avatar) { sAvatar.innerHTML = `<img src="${_profile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<span>${initial}</span>'" />`; }
  else if (sInitial) { sInitial.textContent = initial; }
  const sName = document.getElementById('settings-name'), sEmail = document.getElementById('settings-email'), sWs = document.getElementById('settings-workspace');
  if (sName) sName.textContent = _profile.name || '—';
  if (sEmail) sEmail.textContent = _profile.email || '—';
  if (sWs) sWs.textContent = _profile.workspace || '—';

  const localToggle = document.getElementById('s-local-toggle');
  if (localToggle) localToggle.checked = _useLocalStorage;
  const warn = document.getElementById('s-local-warn');
  if (warn) warn.style.display = _useLocalStorage ? 'block' : 'none';

  ['pages','connect'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) el.checked = _storageScopes[k] !== false; });
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', _exportSize === s); });
  ['toggleLabels','toggleFocusMode','toggleConnectMode','fitGraph'].forEach(action => { const btn = document.getElementById('sc-' + action); if (btn) btn.textContent = formatKey(_shortcuts[action]); });
  ['ko','en'].forEach(l => { document.getElementById('lang-btn-' + l)?.classList.toggle('active', _lang === l); });

  ['shortcuts','storage'].forEach(id => {
    const saved = localStorage.getItem('snlog_sec_' + id), body = document.getElementById('section-' + id), arrow = document.getElementById('arrow-' + id);
    if (!body) return;
    const isOpen = saved !== '0';
    body.style.display = isOpen ? '' : 'none';
    if (arrow) arrow.textContent = isOpen ? '▾' : '▸';
  });

  document.getElementById('settings-modal').classList.add('open');
}

function closeSettings() {
  if (_recordingFor) { _recordingBtn?.classList.remove('recording'); if (_recordingBtn) _recordingBtn.textContent = formatKey(_shortcuts[_recordingFor]); _recordingFor = null; _recordingBtn = null; }
  document.getElementById('settings-modal').classList.remove('open');
  ['pages','connect'].forEach(k => { const el = document.getElementById(`s-scope-${k}`); if (el) _storageScopes[k] = el.checked; });
  localStorage.setItem('snlog_scopes', JSON.stringify(_storageScopes));
}

function onStorageToggle(el) {
  _useLocalStorage = el.checked;
  localStorage.setItem('snlog_use_local', _useLocalStorage);
  const warn = document.getElementById('s-local-warn');
  if (warn) warn.style.display = _useLocalStorage ? 'block' : 'none';
  if (_useLocalStorage) { if (_savedToken) localStorage.setItem('snlog_token', _savedToken); }
  else { Object.keys(localStorage).filter(k => k.startsWith('snlog_') && k !== 'snlog_use_local').forEach(k => localStorage.removeItem(k)); }
}

function updateToken() {
  const input = document.getElementById('settings-token-input'), msg = document.getElementById('settings-token-msg');
  const val = input?.value.trim();
  if (!val) { if (msg) { msg.textContent = '토큰을 입력해주세요'; msg.style.display = 'block'; } return; }
  if (!val.startsWith('secret_') && !val.startsWith('ntn_')) { if (msg) { msg.textContent = '올바른 형식이 아닙니다 (secret_ 또는 ntn_)'; msg.style.display = 'block'; } return; }
  _savedToken = val;
  sessionStorage.setItem('snlog_token', val);
  if (_useLocalStorage) localStorage.setItem('snlog_token', val);
  if (input) input.value = '';
  if (msg) { msg.textContent = '저장됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
  loadProfile();
}

function setExportSize(size) {
  _exportSize = size;
  localStorage.setItem('snlog_export_size', size);
  [1024, 2048, 4096].forEach(s => { const btn = document.getElementById(`s-size-${s}`); if (btn) btn.classList.toggle('active', s === size); });
}

function clearCache(type) {
  const allKeys = [...Object.keys(sessionStorage), ...Object.keys(localStorage)];
  if (type === 'pages' || type === 'all') {
    allKeys.filter(k => k.startsWith('snlog_') && !['snlog_token','snlog_pages','snlog_manual_links','snlog_use_local','snlog_scopes','snlog_export_size','snlog_slider','snlog_search_history'].includes(k))
      .forEach(k => { sessionStorage.removeItem(k); localStorage.removeItem(k); });
    sessionStorage.removeItem('snlog_pages'); localStorage.removeItem('snlog_pages');
  }
  if (type === 'slider' || type === 'all') { sessionStorage.removeItem('snlog_slider'); localStorage.removeItem('snlog_slider'); }
  if (type === 'connect' || type === 'all') { sessionStorage.removeItem('snlog_manual_links'); localStorage.removeItem('snlog_manual_links'); }
  if (type === 'search' || type === 'all') { sessionStorage.removeItem('snlog_search_history'); localStorage.removeItem('snlog_search_history'); }
  const msg = document.getElementById('settings-token-msg');
  if (msg) { msg.textContent = '삭제됐어요'; msg.style.display = 'block'; setTimeout(() => { msg.style.display = 'none'; }, 1500); }
}

document.getElementById('settings-modal')?.addEventListener('click', function(e) { if (e.target === this) closeSettings(); });

// ── 슬라이더 복원 ─────────────────────────────────────────────────────

function restoreSlider() {
  const saved = snGet('snlog_slider', 'slider');
  if (!saved) return;
  try { const { rep, grav } = JSON.parse(saved); if (rep) cfgRep.value = rep; if (grav) cfgGrav.value = grav; updateConfig(); } catch(e) {}
}

// ── 검색 기록 저장/복원 ───────────────────────────────────────────────

function saveSearchHistory() { snSet('snlog_search_history', JSON.stringify(_searchHistory), 'search'); }
function restoreSearchHistory() {
  const saved = snGet('snlog_search_history', 'search');
  if (!saved) return;
  try { const arr = JSON.parse(saved); arr.forEach(kw => { if (!_searchHistory.includes(kw)) _searchHistory.push(kw); }); renderSearchHistory(); } catch(e) {}
}

// ── 메인 루프 & 초기화 ────────────────────────────────────────────────

updateConfig();
applyLang();

function loop() { simulate(); draw(); requestAnimationFrame(loop); }

if (_savedToken) {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('input-token');
    if (input) input.value = _savedToken;
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';
    buildGraph();
    loop();
    setTimeout(restorePageList, 500);
    setTimeout(loadManualLinks, 2000);
    setTimeout(initSidebarPageList, 600);
    setTimeout(loadProfile, 400);
    setTimeout(restoreSlider, 200);
  });
}
