// ── Notion 클라이언트 & 페이지 관리 ────────────────────────────────

let _savedToken = sessionStorage.getItem('snlog_token') || localStorage.getItem('snlog_token') || '';
let _addedPageIds = new Set();

async function notionFetch(body) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: _savedToken, ...body })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch(e) { throw new Error('서버 응답 오류'); }
  if (!res.ok) throw new Error(data.error || '오류가 발생했어요');
  return data;
}

// ── 로그인/페이지 선택 ───────────────────────────────────────────────

function startWithMd(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('login-screen').style.display = 'none';
    buildGraph(); loop();
    const markdown = e.target.result;
    const title = file.name.replace(/\.md$|\.txt$/i, '');
    const pageId = 'md_' + Date.now();
    setTimeout(() => {
      mergeGraph(title, markdown, pageId);
      _addedPageIds.add(pageId);
      const list = document.getElementById('added-pages-list');
      const item = document.createElement('div');
      item.className = 'added-page-item'; item.dataset.pageId = pageId;
      item.innerHTML = `<span>📄 ${title} <span style="color:rgba(255,159,67,0.5);font-size:9px;">MD</span></span><div class="btn-group"><button class="btn-remove" onclick="removePage('${pageId}', this.closest('.added-page-item'))">✕</button></div>`;
      list.appendChild(item);
      updateBulkActionsVisibility(); savePageList();
    }, 100);
  };
  reader.readAsText(file); event.target.value = '';
}

async function startGraph() {
  const token = document.getElementById('input-token').value.trim();
  const errEl = document.getElementById('login-error');
  if (!token) { errEl.textContent = 'Notion API Token을 입력해주세요'; errEl.style.display = 'block'; return; }
  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
    errEl.textContent = '올바른 토큰 형식이 아니에요 (secret_ 또는 ntn_ 으로 시작)';
    errEl.style.display = 'block'; return;
  }
  _savedToken = token;
  try { sessionStorage.setItem('snlog_token', token); } catch(e) {}
  errEl.style.display = 'none';
  showPagePicker();
}

async function showPagePicker() {
  const loginBox = document.getElementById('login-box');
  loginBox.innerHTML = `
    <div class="login-title">Synapse<span>Log</span></div>
    <div class="login-sub" style="margin-bottom:14px;">불러올 페이지를 선택하세요</div>
    <div style="position:relative; margin-bottom:10px;">
      <input type="text" id="page-search-input" placeholder="페이지 검색..." style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:9px 12px; font-size:13px; font-family:inherit; color:#fff; outline:none; transition:border-color 0.2s;" oninput="filterPageList(this.value)" onfocus="this.style.borderColor='rgba(255,159,67,0.5)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'"/>
    </div>
    <div id="page-list" style="max-height:280px; overflow-y:auto; display:flex; flex-direction:column; gap:4px; margin-bottom:12px;">
      <div style="text-align:center; color:rgba(255,255,255,0.3); font-size:12px; padding:20px 0;">불러오는 중...</div>
    </div>
    <div style="display:flex; gap:8px;">
      <button onclick="startWithSelected()" style="flex:1; background:rgba(255,159,67,0.15); border:1px solid rgba(255,159,67,0.4); border-radius:8px; padding:11px; color:#ff9f43; font-size:13px; font-weight:700; font-family:inherit; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,159,67,0.25)'" onmouseout="this.style.background='rgba(255,159,67,0.15)'">선택한 페이지 불러오기</button>
      <button onclick="skipToGraph()" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:11px 14px; color:rgba(255,255,255,0.5); font-size:13px; font-weight:700; font-family:inherit; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.09)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">건너뛰기</button>
    </div>
    <div id="page-pick-error" style="font-size:12px; color:#ff6b6b; text-align:center; margin-top:8px; display:none;"></div>
  `;
  try {
    const data = await notionFetch({ action: 'list' });
    window._pageList = data.pages || [];
    renderPageList(window._pageList);
  } catch(e) {
    document.getElementById('page-list').innerHTML = `<div style="text-align:center; color:#ff6b6b; font-size:12px; padding:16px 0;">${e.message}</div>`;
  }
}

window._selectedPageIds = new Set();

function renderPageList(pages) {
  const list = document.getElementById('page-list');
  if (!list) return;
  if (pages.length === 0) { list.innerHTML = '<div style="text-align:center; color:rgba(255,255,255,0.3); font-size:12px; padding:20px 0;">페이지가 없어요</div>'; return; }
  list.innerHTML = pages.map(p => `
    <div class="page-pick-item" data-id="${p.id}" onclick="togglePageSelect('${p.id}', this)"
      style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); cursor:pointer; transition:background 0.15s; font-size:13px; color:rgba(255,255,255,0.75);">
      <div style="width:16px; height:16px; border-radius:4px; border:1px solid rgba(255,255,255,0.25); display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s;" class="pick-check"></div>
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</span>
    </div>
  `).join('');
}

function togglePageSelect(pageId, el) {
  if (window._selectedPageIds.has(pageId)) {
    window._selectedPageIds.delete(pageId);
    el.style.background = 'rgba(255,255,255,0.04)'; el.style.borderColor = 'rgba(255,255,255,0.08)';
    el.querySelector('.pick-check').style.background = '';
    el.querySelector('.pick-check').style.borderColor = 'rgba(255,255,255,0.25)';
    el.querySelector('.pick-check').innerHTML = '';
  } else {
    window._selectedPageIds.add(pageId);
    el.style.background = 'rgba(255,159,67,0.1)'; el.style.borderColor = 'rgba(255,159,67,0.35)';
    el.querySelector('.pick-check').style.background = '#ff9f43';
    el.querySelector('.pick-check').style.borderColor = '#ff9f43';
    el.querySelector('.pick-check').innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="2,5 4,7 8,3" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
}

function filterPageList(query) {
  if (!window._pageList) return;
  const filtered = query.trim() ? window._pageList.filter(p => p.title.toLowerCase().includes(query.toLowerCase())) : window._pageList;
  renderPageList(filtered);
}

async function startWithSelected() {
  if (window._selectedPageIds.size === 0) {
    const errEl = document.getElementById('page-pick-error');
    if (errEl) { errEl.textContent = '페이지를 하나 이상 선택해주세요'; errEl.style.display = 'block'; }
    return;
  }
  document.getElementById('login-screen').style.display = 'none';
  buildGraph(); loop();
  setTimeout(initSidebarPageList, 300); setTimeout(loadProfile, 500);
  for (const pageId of window._selectedPageIds) { await addPageById(pageId); }
}

function skipToGraph() {
  document.getElementById('login-screen').style.display = 'none';
  buildGraph(); loop();
  setTimeout(initSidebarPageList, 300); setTimeout(loadProfile, 500);
}

// ── 사이드바 페이지 목록 ─────────────────────────────────────────────

async function initSidebarPageList() {
  if (!_savedToken) return;
  const wrap = document.getElementById('sidebar-page-list-wrap');
  if (wrap) wrap.style.display = 'block';
  await refreshSidebarPageList();
}

async function refreshSidebarPageList() {
  if (!_savedToken) return;
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="font-size:11px; color:rgba(255,255,255,0.25); padding:6px 0; text-align:center;">불러오는 중...</div>';
  try {
    const data = await notionFetch({ action: 'list' });
    window._sidebarPageList = data.pages || [];
    renderSidebarPageList(window._sidebarPageList);
  } catch(e) {
    listEl.innerHTML = `<div style="font-size:11px; color:#ff6b6b; padding:6px 0; text-align:center;">${e.message}</div>`;
  }
}

function renderSidebarPageList(pages) {
  const listEl = document.getElementById('sidebar-page-list');
  if (!listEl) return;
  if (!pages || !pages.length) { listEl.innerHTML = '<div style="font-size:11px; color:rgba(255,255,255,0.25); padding:6px 0; text-align:center;">페이지 없음</div>'; return; }
  listEl.innerHTML = pages.map(p => {
    const isActive = _addedPageIds.has(p.id);
    if (isActive) {
      return `<div class="page-list-item active" data-page-id="${p.id}">
        <span class="item-label" title="${p.title}">${p.title}</span>
        <div class="item-actions">
          <button class="btn-sync" title="동기화" onclick="syncPage('${p.id}')">↻</button>
          <button class="btn-remove" onclick="removePage('${p.id}', document.querySelector('[data-page-id=\\'${p.id}\\']'))">✕</button>
        </div>
      </div>`;
    } else {
      return `<div class="page-list-item" data-page-id="${p.id}">
        <span class="item-label" title="${p.title}" onclick="addPageById('${p.id}')">${p.title}</span>
      </div>`;
    }
  }).join('');
}

function refreshSidebarRender() {
  if (window._sidebarPageList) renderSidebarPageList(window._sidebarPageList);
}

// ── 페이지 추가/동기화/제거 ──────────────────────────────────────────

async function addPageById(pageId) {
  if (_addedPageIds.has(pageId)) return;
  showLoading('노션 페이지 불러오는 중...');
  try {
    const cacheKey = `snlog_${pageId}`;
    let data;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) { try { data = JSON.parse(cached); } catch(e) {} }
    if (!data) {
      data = await notionFetch({ pageId, action: 'headings' });
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    }
    _addedPageIds.add(pageId);
    mergeGraph(data.title || '추가 페이지', data.markdown || '', pageId);
    updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
    _loadEntriesBackground(pageId);
  } catch(e) {} finally { hideLoading(); }
}

async function addPage() {
  const raw = document.getElementById('add-page-id').value.trim();
  const pageId = (raw.match(/([a-f0-9]{32})/i)?.[1] || raw.replace(/-/g, '')).toLowerCase();
  const errEl = document.getElementById('add-page-error');
  const btn = document.getElementById('add-page-btn');
  if (!pageId) { errEl.textContent = 'Page ID를 입력해주세요'; errEl.style.display = 'block'; return; }
  if (_addedPageIds.has(pageId)) { errEl.textContent = '이미 추가된 페이지예요'; errEl.style.display = 'block'; return; }
  if (!_savedToken) { errEl.textContent = '토큰 정보가 없어요. 새로고침 후 다시 시도해주세요'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = '불러오는 중...'; errEl.style.display = 'none';
  showLoading('노션 페이지 불러오는 중...');
  try {
    const cacheKey = `snlog_${pageId}`;
    const cached = sessionStorage.getItem(cacheKey);
    let data;
    if (cached) { try { data = JSON.parse(cached); setLoadingText('캐시에서 불러오는 중...'); } catch(e) { data = null; } }
    if (!data) {
      data = await notionFetch({ pageId, action: 'headings' });
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    }
    _addedPageIds.add(pageId);
    mergeGraph(data.title || '추가 페이지', data.markdown || '', pageId);
    const list = document.getElementById('added-pages-list');
    const item = document.createElement('div');
    item.className = 'added-page-item'; item.dataset.pageId = pageId;
    const isCached = !!cached && !JSON.parse(cached)._headingsOnly;
    item.innerHTML = `<span>📄 ${data.title || pageId}${isCached ? ' <span style="color:rgba(255,159,67,0.5);font-size:9px;">캐시</span>' : ''}</span><div class="btn-group"><button class="btn-sync" title="동기화" onclick="syncPage('${pageId}')">↻</button><button class="btn-remove" onclick="removePage('${pageId}', this.closest('.added-page-item'))">✕</button></div>`;
    list.appendChild(item);
    updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
    _loadEntriesBackground(pageId);
    document.getElementById('add-page-id').value = '';
    btn.disabled = false; btn.textContent = '+ 노드 불러오기'; isStable = false;
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = '+ 노드 불러오기';
  } finally { hideLoading(); }
}

function savePageList() {
  const list = [];
  _addedPageIds.forEach(pageId => {
    const cached = sessionStorage.getItem(`snlog_${pageId}`);
    const title = cached ? (JSON.parse(cached).title || pageId) : pageId;
    list.push({ pageId, title });
  });
  try { sessionStorage.setItem('snlog_pages', JSON.stringify(list)); } catch(e) {}
}

async function restorePageList() {
  const saved = sessionStorage.getItem('snlog_pages');
  if (!saved) return;
  let list; try { list = JSON.parse(saved); } catch(e) { return; }
  for (const { pageId, title } of list) {
    if (_addedPageIds.has(pageId)) continue;
    const cached = sessionStorage.getItem(`snlog_${pageId}`);
    let data;
    if (cached) { try { data = JSON.parse(cached); } catch(e) {} }
    if (!data) {
      try {
        data = await notionFetch({ pageId, action: 'headings' });
        sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() }));
      } catch(e) { continue; }
    }
    _addedPageIds.add(pageId);
    await mergeGraph(data.title || title, data.markdown || '', pageId);
    const listEl = document.getElementById('added-pages-list');
    const item = document.createElement('div');
    item.className = 'added-page-item'; item.dataset.pageId = pageId;
    item.innerHTML = `<span>📄 ${data.title || title} <span style="color:rgba(255,159,67,0.5);font-size:9px;">캐시</span></span><div class="btn-group"><button class="btn-sync" title="동기화" onclick="syncPage('${pageId}')">↻</button><button class="btn-remove" onclick="removePage('${pageId}', this.closest('.added-page-item'))">✕</button></div>`;
    listEl.appendChild(item);
    _loadEntriesBackground(pageId);
  }
  updateBulkActionsVisibility();
}

async function syncPage(pageId) {
  const item = document.querySelector(`[data-page-id="${pageId}"]`);
  const syncBtn = item?.querySelector('.btn-sync');
  if (syncBtn) syncBtn.textContent = '⟳';
  showLoading('동기화 중...');
  try {
    nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId)
         .forEach(n => sessionStorage.removeItem(`snlog_entry_${n.entryNotionId}`));
    const data = await notionFetch({ pageId, action: 'headings' });
    try { sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify({ ...data, _headingsOnly: true, _cachedAt: Date.now() })); } catch(e) {}
    const removeIds = new Set(nodes.filter(n => n.sourcePageId === pageId || n.id === 'ghost_' + pageId).map(n => n.id));
    nodes = nodes.filter(n => !removeIds.has(n.id));
    edges = edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to));
    Object.keys(nodeMap).forEach(k => { if (removeIds.has(k)) delete nodeMap[k]; });
    mergeGraph(data.title || '추가 페이지', data.markdown || '', pageId);
    if (syncBtn) syncBtn.textContent = '↻';
    _loadEntriesBackground(pageId);
  } catch(e) { if (syncBtn) syncBtn.textContent = '↻'; } finally { hideLoading(); }
}

function removePage(pageId, el) {
  _addedPageIds.delete(pageId);
  if (el) el.remove();
  const removeIds = new Set(nodes.filter(n => n.sourcePageId === pageId || n.id === 'ghost_' + pageId).map(n => n.id));
  nodes = nodes.filter(n => !removeIds.has(n.id));
  edges = edges.filter(e => !removeIds.has(e.from) && !removeIds.has(e.to));
  Object.keys(nodeMap).forEach(k => { if (removeIds.has(k)) delete nodeMap[k]; });
  isStable = false; updateBulkActionsVisibility(); savePageList(); refreshSidebarRender();
}

function updateBulkActionsVisibility() {
  const bulk = document.getElementById('bulk-actions');
  if (bulk) bulk.style.display = _addedPageIds.size > 0 ? 'flex' : 'none';
}

let _confirmCallback = null;
function showConfirm(title, msg, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').classList.add('open');
  _confirmCallback = onOk;
  document.getElementById('confirm-ok').onclick = () => { closeConfirm(); onOk(); };
}
function closeConfirm() { document.getElementById('confirm-modal').classList.remove('open'); _confirmCallback = null; }

function confirmBulkSync() { showConfirm('전체 동기화', '모든 페이지의 노션 데이터를 새로 불러옵니다. 계속할까요?', bulkSync); }
async function bulkSync() { const ids = [..._addedPageIds]; for (const pid of ids) { await syncPage(pid); } }
function confirmBulkClose() {
  showConfirm('전체 닫기', '추가된 모든 페이지 노드를 제거합니다. 계속할까요?', () => {
    const ids = [..._addedPageIds];
    ids.forEach(pid => { const el = document.querySelector(`[data-page-id="${pid}"]`); removePage(pid, el); });
    document.getElementById('bulk-actions').style.display = 'none';
  });
}

// ── 엔트리 백그라운드 로드 ───────────────────────────────────────────

function _addEntryChildNodes(entryNode, markdown) {
  const lines = markdown.split('\n');
  const prefix = 'ec' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_';
  let nid = 0;
  const newIds = new Set();
  const currentParents = { 0: entryNode.id };
  let pendingIsChildPage = false;
  let pendingEntryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('---')) continue;
    if (line === '[CHILD_PAGE]') { pendingIsChildPage = true; continue; }
    const entryMarker = line.match(/^\[NOTION_ENTRY:([a-f0-9]+)\]$/);
    if (entryMarker) { pendingEntryId = entryMarker[1]; continue; }
    const headerMatch = line.match(/^(#{1,5})\s+(.*)$/);
    if (!headerMatch) { pendingIsChildPage = false; pendingEntryId = null; continue; }

    const mdDepth = Math.min(headerMatch[1].length, 5);
    const graphLevel = Math.min(entryNode.level + mdDepth, 5);
    let lbl = headerMatch[2].trim().replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');

    let parentId = entryNode.id;
    for (let d = mdDepth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }

    let descLines = [], nextIdx = i + 1;
    while (nextIdx < lines.length) {
      const nl = lines[nextIdx].trim();
      if (!nl) { nextIdx++; continue; }
      if (nl.startsWith('#') || nl === '[CHILD_PAGE]' || nl.startsWith('[NOTION_ENTRY:')) break;
      if (descLines.join('\n').length > 3000) { nextIdx++; continue; }
      descLines.push(nl); nextIdx++;
    }

    const parentColor = nodeMap[parentId]?.color;
    let color = null;
    if (graphLevel === 1) { color = getH1Color(lbl); }
    else if (graphLevel === 2) {
      if (parentColor) {
        const sibCnt = edges.filter(e => e.from === parentId).length;
        color = hslColor((extractHue(parentColor) + (sibCnt * 47) % 120 - 60 + 360) % 360, 70, 58);
      }
    } else if (graphLevel === 3) {
      if (parentColor) color = hslColor(extractHue(parentColor), 65, 62);
    } else if (graphLevel === 4) {
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 55);
    } else if (graphLevel === 5) {
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 48);
    }

    const id = prefix + (nid++);
    const n = {
      id, label: cleanLabel(lbl), desc: cleanDesc(descLines.join('\n').substring(0, 5000)), date: '',
      x: entryNode.x + (Math.random()-0.5)*50, y: entryNode.y + (Math.random()-0.5)*50,
      vx: 0, vy: 0, level: graphLevel, fixed: false, color,
      _rgb: hexToRgb(color || '#74b9ff'),
      sourcePageId: entryNode.sourcePageId, visible: false, _frozen: false, _frozenFrames: 0
    };
    if (pendingEntryId) { n.entryNotionId = pendingEntryId; pendingEntryId = null; }
    if (pendingIsChildPage) { n.isChildPage = true; pendingIsChildPage = false; }
    nodes.push(n); nodeMap[id] = n;
    edges.push({ from: parentId, to: id });
    newIds.add(id);
    currentParents[mdDepth] = id;
    for (let d = mdDepth + 1; d <= 5; d++) currentParents[d] = null;
    if (nextIdx > i + 1) i = nextIdx - 1;
  }
  return newIds;
}

async function _loadEntryNode(node, pageId) {
  if (!_addedPageIds.has(pageId)) return;
  const cacheKey = `snlog_entry_${node.entryNotionId}`;
  let md = sessionStorage.getItem(cacheKey);
  if (!md) {
    try {
      const data = await notionFetch({ pageId: node.entryNotionId, action: 'entry' });
      md = data.markdown || '';
      if (md) try { sessionStorage.setItem(cacheKey, md); } catch(e) {}
    } catch(e) { return; }
  }
  if (!md) return;
  const newIds = _addEntryChildNodes(node, md);
  if (newIds.size > 0) {
    newIds.forEach(id => { if (nodeMap[id]) nodeMap[id].visible = true; });
    nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
    isStable = false;
    const nestedChildPages = [...newIds].map(id => nodeMap[id]).filter(n => n?.entryNotionId);
    for (const child of nestedChildPages) await _loadEntryNode(child, pageId);
  } else {
    node.desc = cleanDesc(md.replace(/^#{1,5}\s+/gm, '').substring(0, 5000).trim());
  }
}

async function _loadEntriesBackground(pageId) {
  const entryNodes = nodes.filter(n => n.sourcePageId === pageId && n.entryNotionId);
  if (!entryNodes.length) return;
  const total = entryNodes.length;
  let loaded = 0;

  const getTag = () => document.querySelector(`[data-page-id="${pageId}"] .entry-load-tag`);
  const setTag = (t) => { const el = getTag(); if (el) el.textContent = t; };

  const item = document.querySelector(`[data-page-id="${pageId}"]`);
  const labelEl = item?.querySelector('.item-label') || item?.querySelector('span');
  if (labelEl && !labelEl.querySelector('.entry-load-tag')) {
    labelEl.insertAdjacentHTML('beforeend', ` <span class="entry-load-tag" style="color:rgba(255,159,67,0.45);font-size:9px;">로딩 0/${total}</span>`);
  }

  for (const node of entryNodes) {
    await _loadEntryNode(node, pageId);
    loaded++; setTag(`로딩 ${loaded}/${total}`);
  }

  const tag = getTag(); if (tag) tag.remove();
  try {
    const c = sessionStorage.getItem(`snlog_${pageId}`);
    if (c) { const p = JSON.parse(c); delete p._headingsOnly; sessionStorage.setItem(`snlog_${pageId}`, JSON.stringify(p)); }
  } catch(e) {}
}

// ── 파일 임포트 / 내보내기 ───────────────────────────────────────────

function importMarkdownFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const markdown = e.target.result;
    const title = file.name.replace(/\.md$|\.txt$/i, '');
    const pageId = 'md_' + Date.now();
    mergeGraph(title, markdown, pageId);
    _addedPageIds.add(pageId);
    const list = document.getElementById('added-pages-list');
    const item = document.createElement('div');
    item.className = 'added-page-item'; item.dataset.pageId = pageId;
    item.innerHTML = `<span>📄 ${title} <span style="color:rgba(255,159,67,0.5);font-size:9px;">MD</span></span><div class="btn-group"><button class="btn-remove" onclick="removePage('${pageId}', this.closest('.added-page-item'))">✕</button></div>`;
    list.appendChild(item);
    updateBulkActionsVisibility(); savePageList();
  };
  reader.readAsText(file); event.target.value = '';
}

function exportGraph() {
  const SIZE = _exportSize || 2048, PADDING = 60;
  const hasSearch = searchKeyword.length > 0;
  const visibleNodes = nodes.filter(n => {
    if (!n.visible) return false;
    if (_focusMode && n.dimmed) return false;
    if (hasSearch && !searchMatches.has(n.id)) return false;
    return true;
  });
  if (visibleNodes.length === 0) return;
  const minX = Math.min(...visibleNodes.map(n => n.x)), maxX = Math.max(...visibleNodes.map(n => n.x));
  const minY = Math.min(...visibleNodes.map(n => n.y)), maxY = Math.max(...visibleNodes.map(n => n.y));
  const graphW = maxX - minX || 1, graphH = maxY - minY || 1;
  const exportScale = (SIZE - PADDING * 2) / Math.max(graphW, graphH);
  const offscreen = document.createElement('canvas');
  offscreen.width = SIZE; offscreen.height = SIZE;
  const ctx2 = offscreen.getContext('2d');
  ctx2.fillStyle = '#0a0c14'; ctx2.fillRect(0, 0, SIZE, SIZE);
  const offsetX = (SIZE - graphW * exportScale) / 2 - minX * exportScale;
  const offsetY = (SIZE - graphH * exportScale) / 2 - minY * exportScale;
  const visibleIds = new Set(visibleNodes.map(n => n.id));
  ctx2.save(); ctx2.translate(offsetX, offsetY); ctx2.scale(exportScale, exportScale);
  edges.forEach(e => {
    const a = nodeMap[e.from], b = nodeMap[e.to];
    if (!a?.visible || !b?.visible || !visibleIds.has(a.id) || !visibleIds.has(b.id)) return;
    const edgeRgb = hexToRgb(a.color || '#ffffff');
    if (hasSearch) {
      const bothMatch = searchMatches.has(e.from) && searchMatches.has(e.to);
      const eitherMatch = searchMatches.has(e.from) || searchMatches.has(e.to);
      if (!eitherMatch) return;
      ctx2.setLineDash(bothMatch ? [] : [4,5]);
      ctx2.strokeStyle = rgbStr(edgeRgb, bothMatch ? 0.9 : 0.3);
      ctx2.lineWidth = bothMatch ? 1.0 : 0.5;
    } else if (e.manualLink) { ctx2.setLineDash([4,5]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.6); ctx2.lineWidth = 0.8; }
    else if (e.weakLink) { ctx2.setLineDash([4,4]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.2); ctx2.lineWidth = 0.6; }
    else { ctx2.setLineDash([]); ctx2.strokeStyle = rgbStr(edgeRgb, 0.55); ctx2.lineWidth = 0.7; }
    ctx2.beginPath(); ctx2.moveTo(a.x, a.y); ctx2.lineTo(b.x, b.y); ctx2.stroke();
  });
  ctx2.setLineDash([]);
  visibleNodes.forEach(n => {
    const r = nodeR(n.level), nodeColor = n.level === 0 ? '#ffffff' : (n.color || '#74b9ff');
    const rgb = hexToRgb(nodeColor), isMatch = searchMatches.has(n.id);
    if (hasSearch && isMatch) {
      ctx2.beginPath(); ctx2.arc(n.x, n.y, r+10, 0, Math.PI*2);
      const gS = ctx2.createRadialGradient(n.x, n.y, r, n.x, n.y, r+10);
      gS.addColorStop(0, 'rgba(255,255,255,0.4)'); gS.addColorStop(1, 'rgba(255,255,255,0)');
      ctx2.fillStyle = gS; ctx2.fill();
    }
    if (n.level > 0) {
      const childCount = getChildCount(n.id);
      if (childCount >= 3) {
        const hubStrength = Math.min((childCount - 2) / 4, 1);
        const glowR = r + 8 + hubStrength * 22;
        ctx2.beginPath(); ctx2.arc(n.x, n.y, glowR, 0, Math.PI*2);
        const gH = ctx2.createRadialGradient(n.x, n.y, r, n.x, n.y, glowR);
        gH.addColorStop(0, rgbStr(hexToRgb(nodeColor), 0.28 + hubStrength * 0.15)); gH.addColorStop(1, rgbStr(hexToRgb(nodeColor), 0));
        ctx2.fillStyle = gH; ctx2.fill();
      }
    }
    if(n.level===0) drawStar8(ctx2, n.x, n.y, r);
    else if(n.isDbNode) drawStar4(ctx2, n.x, n.y, r);
    else { ctx2.beginPath(); ctx2.arc(n.x, n.y, r, 0, Math.PI*2); }
    ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : rgbStr(rgb, 1); ctx2.fill();
    if (_showLabels) {
      let lbl = n.label;
      if (n.level >= 2 && lbl.length > 14) lbl = lbl.substring(0,13) + '…';
      const fontSize = n.level <= 1 ? 12 : 10;
      ctx2.font = n.level <= 1 ? `bold ${fontSize}px 'Noto Sans KR', sans-serif` : `500 ${fontSize}px 'Noto Sans KR', sans-serif`;
      ctx2.fillStyle = hasSearch && isMatch ? '#ffffff' : 'rgba(215,220,230,0.85)';
      ctx2.textAlign = 'center'; ctx2.textBaseline = 'top';
      ctx2.fillText(lbl, n.x, n.y + r + 4);
    }
  });
  ctx2.restore();
  ctx2.fillStyle = 'rgba(255,255,255,0.15)'; ctx2.font = 'bold 13px sans-serif';
  ctx2.textAlign = 'right'; ctx2.textBaseline = 'bottom';
  ctx2.fillText('SynapseLog', SIZE-16, SIZE-14);
  const link = document.createElement('a');
  link.download = `SynapseLog_${new Date().toISOString().slice(0,10)}.png`;
  link.href = offscreen.toDataURL('image/png'); link.click();
}
