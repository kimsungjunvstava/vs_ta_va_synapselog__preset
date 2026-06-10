// ── 공유 전역 상태 (ui.js에서 canvas/ctx/W/H 초기화) ────────────────
let canvas, ctx, W, H;
let scale = 0.85, panX = 0, panY = 0;
let nodes = [], edges = [], nodeMap = {};
let drag = null, hoveredNode = null;
let isPanning = false, panStartX = 0, panStartY = 0, panStartOffsetX = 0, panStartOffsetY = 0;
let isStable = false;
let CONFIG = { repulsion: 500, gravity: 0.0010, linkDistance: 60 };
let searchKeyword = '', searchMatches = new Set();
let _showLabels = true;
let _focusMode = false, _focusNodeId = null;
let _connectMode = false, _connectFirstNode = null;
let _fitAnimId = null;

// ── 마크다운 → 그래프 파싱 ──────────────────────────────────────────

function parseMarkdown(text, rootTitle) {
  const nodes = [], edges = [], nodeMap = {};
  let nid = 0;

  function addNode(rawLabel, desc='', parentId=null, date='', level=0) {
    const label = cleanLabel(rawLabel);
    if (!label || label.length < 1) return null;
    const parentNode = nodeMap[parentId];
    let color = null;
    if (level === 0) { color = '#ffffff'; }
    else if (level === 1) { color = getH1Color(label); }
    else if (level === 2) {
      const parentColor = parentNode?.color;
      if (parentColor) {
        const parentHue = extractHue(parentColor);
        const siblingCount = edges.filter(e => e.from === parentId).length;
        const hueOffset = (siblingCount * 47) % 120 - 60;
        color = hslColor((parentHue + hueOffset + 360) % 360, 70, 58);
      } else { color = getH1Color(label); }
    } else if (level === 3) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), 65, 62);
    } else if (level === 4) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 55);
    } else if (level === 5) {
      const parentColor = parentNode?.color;
      if (parentColor) color = hslColor(extractHue(parentColor), getSaturation(parentColor), 48);
    }
    const id = 'n' + (nid++);
    const n = {
      id, label, desc: cleanDesc(desc), date,
      x: W/2 + (Math.random()-0.5)*60, y: H/2 + (Math.random()-0.5)*60,
      vx: 0, vy: 0, level, fixed: false, color,
      _rgb: hexToRgb(level === 0 ? '#ffffff' : (color || '#74b9ff'))
    };
    nodes.push(n); nodeMap[id] = n;
    if (parentId) edges.push({ from: parentId, to: id });
    return id;
  }

  const rootId = addNode(rootTitle || '자기관리: 내면', '', null, '', 0);
  const currentParents = { 0: rootId, 1: null, 2: null, 3: null, 4: null, 5: null };
  const lines = text.split('\n');
  let pendingEntryId = null;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('---') || line.startsWith('<')) continue;
    const entryMarker = line.match(/^\[NOTION_ENTRY:([a-f0-9]+)\]$/);
    if (entryMarker) { pendingEntryId = entryMarker[1]; continue; }
    const headerMatch = line.match(/^(#{1,5})\s+(.*)$/);
    if (headerMatch) {
      const rawDepth = headerMatch[1].length;
      const depth = Math.min(rawDepth, 5);
      let lbl = headerMatch[2].trim().replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '');
      let nDate = '';
      const inlineDateMatch = lbl.match(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/);
      if (inlineDateMatch) { nDate = inlineDateMatch[1]; lbl = lbl.replace(/-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-/, ''); }
      let parentId = null;
      for (let d = depth - 1; d >= 0; d--) { if (currentParents[d]) { parentId = currentParents[d]; break; } }
      if (!parentId) parentId = rootId;
      let descLines = [], nextIdx = i + 1;
      while (nextIdx < lines.length) {
        let nextLine = lines[nextIdx].trim();
        if (!nextLine) { nextIdx++; continue; }
        if (nextLine.startsWith('#')) break;
        if (nextLine.startsWith('[DB_PAGE]')) break;
        if (nextLine.startsWith('[NOTION_ENTRY:')) break;
        const dateOnlyMatch = nextLine.match(/^-\s*(\d{4}\.\d{2}(?:\.\d{2})?)\s*-$/);
        if (dateOnlyMatch) { nDate = nDate || dateOnlyMatch[1]; nextIdx++; continue; }
        if (/^\*\*[^*]{3,60}\*\*$/.test(nextLine) && descLines.length > 0) break;
        if (descLines.join('\n').length > 3000) { nextIdx++; continue; }
        descLines.push(nextLine); nextIdx++;
      }
      const curId = addNode(lbl, descLines.join('\n').substring(0, 5000), parentId, nDate, depth);
      if (curId) {
        if (pendingEntryId) { nodeMap[curId].entryNotionId = pendingEntryId; pendingEntryId = null; }
        currentParents[depth] = curId;
        for (let d = depth + 1; d <= 5; d++) currentParents[d] = null;
      }
      if (nextIdx > i + 1) i = nextIdx - 1;
    }
  }
  return { nodes, edges, nodeMap };
}

// ── 물리 시뮬레이션 ─────────────────────────────────────────────────

function simulate() {
  if (isStable && !drag) return;
  const repulsion = CONFIG.repulsion, damping = 0.92, centerForce = CONFIG.gravity;
  const fixedDescendants = new Set();
  nodes.filter(n => n.fixed && n.visible).forEach(fn => {
    const q=[fn.id], v=new Set([fn.id]);
    while(q.length){ const id=q.shift(); edges.forEach(e=>{ if(e.from===id&&!e.weakLink&&!v.has(e.to)){v.add(e.to);fixedDescendants.add(e.to);q.push(e.to);} }); }
  });
  const activeNodes = nodes.filter(n => n.visible && !n.fixed && !n._frozen && n !== drag);
  let totalVelocity = 0;
  activeNodes.forEach(n => {
    let fx = 0, fy = 0;
    nodes.forEach(m => {
      if(m === n || !m.visible) return;
      const dx = n.x-m.x, dy = n.y-m.y, d = Math.max(dist(n,m), 1);
      if(d < 400) { const f = repulsion/(d*d); fx += dx/d*f; fy += dy/d*f; }
    });
    edges.forEach(e => {
      if(e.from !== n.id && e.to !== n.id) return;
      const other = nodeMap[e.from===n.id?e.to:e.from];
      if(!other||!other.visible) return;
      if(other.fixed && e.from === n.id) return;
      const dx = other.x-n.x, dy = other.y-n.y, d = Math.max(dist(n,other), 1);
      let natural = CONFIG.linkDistance, strength = 0.005;
      if(e.weakLink) { natural = 600; strength = 0.001; }
      else if(e.manualLink) { return; }
      else {
        if(n.level===1||other.level===1) natural *= 1.2;
        if(n.level>=3||other.level>=3) natural *= 0.9;
      }
      const f = (d-natural)*strength;
      fx += dx/d*f; fy += dy/d*f;
    });
    if(!fixedDescendants.has(n.id)){fx += (W/2-n.x)*centerForce; fy += (H/2-n.y)*centerForce;}
    n.vx = Math.max(-3, Math.min(3, (n.vx+fx)*damping));
    n.vy = Math.max(-3, Math.min(3, (n.vy+fy)*damping));
    n.x += n.vx; n.y += n.vy;
    const speed = Math.abs(n.vx) + Math.abs(n.vy);
    totalVelocity += speed;
    if (speed < 0.05) { n._frozenFrames = (n._frozenFrames || 0) + 1; if (n._frozenFrames > 120) n._frozen = true; }
    else n._frozenFrames = 0;
  });
  if (totalVelocity < 2.0 && !drag) isStable = true;
}

// ── 렌더링 ──────────────────────────────────────────────────────────

function draw() {
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0c0d12'; ctx.fillRect(0,0,W,H);
  ctx.save();
  ctx.translate(W/2+panX, H/2+panY);
  ctx.scale(scale, scale);
  ctx.translate(-W/2, -H/2);
  const hasSearch = searchKeyword.length > 0;
  const childCountMap = new Map(), manualLinkedSet = new Set();
  edges.forEach(e => {
    if (!e.weakLink && !e.manualLink) childCountMap.set(e.from, (childCountMap.get(e.from) || 0) + 1);
    if (e.manualLink) { manualLinkedSet.add(e.from); manualLinkedSet.add(e.to); }
  });

  edges.forEach(e => {
    const na=nodeMap[e.from], nb=nodeMap[e.to];
    if(!na||!nb||!na.visible||!nb.visible) return;
    const isHov = hoveredNode&&(hoveredNode.id===e.from||hoveredNode.id===e.to);
    const bothMatch = hasSearch&&searchMatches.has(e.from)&&searchMatches.has(e.to);
    const eitherMatch = hasSearch&&(searchMatches.has(e.from)||searchMatches.has(e.to));
    if(e.manualLink) {
      if(hasSearch) return;
      if(_focusMode && na.dimmed && nb.dimmed) return;
      ctx.strokeStyle = `rgba(255,255,255,${isHov ? 0.7 : 0.35})`;
      ctx.lineWidth = (isHov ? 1.8 : 1.2) / scale; ctx.setLineDash([5, 6]);
    } else if(e.weakLink) {
      ctx.strokeStyle = `rgba(255,159,67,${isHov?0.6:0.25})`;
      ctx.lineWidth = 1/scale; ctx.setLineDash([6,6]);
    } else if(hasSearch) {
      if(bothMatch) { ctx.strokeStyle=rgbStr(na._rgb,0.9); ctx.lineWidth=1.6/scale; ctx.setLineDash([5,3]); }
      else if(eitherMatch) { ctx.strokeStyle=rgbStr(na._rgb,0.35); ctx.lineWidth=0.8/scale; ctx.setLineDash([4,5]); }
      else { ctx.strokeStyle=rgbStr(na._rgb,0.05); ctx.lineWidth=0.5/scale; ctx.setLineDash([3,7]); }
    } else {
      const alpha=isHov?0.85:0.55, width=isHov?2.2:0.8;
      ctx.strokeStyle=rgbStr(na._rgb,alpha); ctx.lineWidth=width/scale; ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke();
    ctx.setLineDash([]);
  });

  if(hasSearch && searchMatches.size > 0) {
    const matchArr = [...searchMatches].map(id => nodeMap[id]).filter(n => n && n.visible);
    function getPath(node) {
      const path = [node]; let cur = node;
      for(let depth=0; depth<10; depth++) {
        const parentEdge = edges.find(e => e.to===cur.id && !e.weakLink);
        if(!parentEdge) break;
        const parent = nodeMap[parentEdge.from]; if(!parent) break;
        path.unshift(parent); cur = parent;
      }
      return path;
    }
    const existingEdgeSet = new Set(edges.filter(e => !e.weakLink).map(e => [e.from,e.to].sort().join('|')));
    const drawnPairs = new Set();
    ctx.setLineDash([4,6]); ctx.lineWidth = 1.2/scale;
    matchArr.forEach(n => {
      const path = getPath(n);
      for(let i=0; i<path.length-1; i++) {
        const a=path[i], b=path[i+1];
        if(!a.visible||!b.visible) continue;
        if(a.level===1&&b.level===1) continue;
        const key=[a.id,b.id].sort().join('|');
        if(drawnPairs.has(key)||existingEdgeSet.has(key)) continue;
        drawnPairs.add(key);
        ctx.strokeStyle=rgbStr(hexToRgb(b.color||a.color||'#ff9f43'),0.75);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    });
    const matchedRoots = new Set();
    matchArr.forEach(n => { const path=getPath(n); const rootNode=path.find(p=>p.level===0); if(rootNode) matchedRoots.add(rootNode); });
    const rootArr=[...matchedRoots];
    if(rootArr.length>1) {
      ctx.lineWidth=1.5/scale; ctx.setLineDash([6,5]);
      for(let i=0; i<rootArr.length-1; i++) {
        const a=rootArr[i], b=rootArr[i+1];
        if(!a.visible||!b.visible) continue;
        const key=[a.id,b.id].sort().join('|');
        if(drawnPairs.has(key)) continue;
        drawnPairs.add(key);
        ctx.strokeStyle=rgbStr(hexToRgb(a.color||'#ff9f43'),0.9);
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  nodes.forEach(n => {
    if(!n.visible) return;
    const isHov=hoveredNode===n, isMatch=searchMatches.has(n.id);
    const isDim=(hasSearch&&!isMatch)||(_focusMode&&n.dimmed);
    const r=nodeR(n.level);
    const nodeColor = n.level===0 ? '#ffffff' : (n.color||'#74b9ff');
    const isManualLinked = manualLinkedSet.has(n.id);
    if(isManualLinked && !isDim) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r+14, 0, Math.PI*2);
      const gM = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+14);
      gM.addColorStop(0, 'rgba(255,255,255,0.35)'); gM.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gM; ctx.fill();
    }
    if(!isDim && n.level > 0) {
      const childCount = childCountMap.get(n.id) || 0;
      if(childCount >= 3) {
        const hubStrength = Math.min((childCount - 2) / 4, 1);
        const glowR = r + 8 + hubStrength * 22;
        ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, Math.PI*2);
        const gH = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, glowR);
        gH.addColorStop(0, rgbStr(n._rgb, 0.28 + hubStrength * 0.15)); gH.addColorStop(1, rgbStr(n._rgb, 0));
        ctx.fillStyle = gH; ctx.fill();
      }
    }
    if(isMatch) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+18,0,Math.PI*2);
      const g1=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+18);
      g1.addColorStop(0,'rgba(255,255,255,0.25)'); g1.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=g1; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x,n.y,r+8,0,Math.PI*2);
      const g2=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+8);
      g2.addColorStop(0,'rgba(255,255,255,0.4)'); g2.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=g2; ctx.fill();
    } else if(isHov) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+12,0,Math.PI*2);
      const g=ctx.createRadialGradient(n.x,n.y,r,n.x,n.y,r+12);
      g.addColorStop(0,rgbStr(n._rgb,0.3)); g.addColorStop(1,rgbStr(n._rgb,0));
      ctx.fillStyle=g; ctx.fill();
    }
    if(n.level===0) drawStar8(ctx, n.x, n.y, r);
    else { ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2); }
    if(isMatch) { ctx.fillStyle='#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else if(n.level===0) { ctx.fillStyle='#ffffff'; ctx.strokeStyle='rgba(255,255,255,0)'; ctx.lineWidth=0; ctx.fill(); }
    else {
      const satRatio=[1,1,0.80,0.65,0.52][Math.min(n.level,4)];
      const bg=[12,13,18];
      const mixed=n._rgb.map((c,i)=>Math.round(c*satRatio+bg[i]*(1-satRatio)));
      ctx.fillStyle=isDim?rgbStr(mixed,0.15):rgbStr(mixed,1);
      ctx.strokeStyle=isDim?rgbStr(mixed,0.06):rgbStr(mixed,1);
      ctx.lineWidth=isHov?2/scale:1/scale; ctx.fill(); ctx.stroke();
    }
    if(n.fixed) {
      ctx.beginPath(); ctx.arc(n.x,n.y,r+3.5,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=1/scale;
      ctx.setLineDash([2.5,2.5]); ctx.stroke(); ctx.setLineDash([]);
    }
    if(_connectMode && n.connectSelected) {
      ctx.beginPath(); ctx.arc(n.x, n.y, r+16, 0, Math.PI*2);
      const gSel = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+16);
      gSel.addColorStop(0, 'rgba(255,255,255,0.45)'); gSel.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gSel; ctx.fill();
      ctx.beginPath(); ctx.arc(n.x, n.y, r+7, 0, Math.PI*2);
      const gSel2 = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+7);
      gSel2.addColorStop(0, 'rgba(255,255,255,0.6)'); gSel2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gSel2; ctx.fill();
    }
    if(_connectMode && _connectFirstNode && !n.connectSelected) {
      const alreadyLinked = edges.some(e => e.manualLink && ((e.from === _connectFirstNode.id && e.to === n.id) || (e.from === n.id && e.to === _connectFirstNode.id)));
      if(alreadyLinked) {
        ctx.beginPath(); ctx.arc(n.x, n.y, r+16, 0, Math.PI*2);
        const gDel = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+16);
        gDel.addColorStop(0, 'rgba(255,80,80,0.4)'); gDel.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = gDel; ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r+7, 0, Math.PI*2);
        const gDel2 = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r+7);
        gDel2.addColorStop(0, 'rgba(255,80,80,0.55)'); gDel2.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = gDel2; ctx.fill();
      }
    }
    if(_showLabels) {
      let lbl=n.label;
      if(n.level>=2&&lbl.length>14) lbl=lbl.substring(0,13)+'…';
      let fontSize=10;
      if(n.level===0||n.level===1) fontSize=12;
      else if(n.level===2) fontSize=11;
      ctx.font=(n.level<=1)?`bold ${fontSize}px 'Noto Sans KR',sans-serif`:`500 ${fontSize}px 'Noto Sans KR',sans-serif`;
      ctx.fillStyle=isMatch?'#ffffff':`rgba(215,220,230,${isDim?0.12:0.85})`;
      ctx.textAlign='center'; ctx.textBaseline='top';
      ctx.fillText(lbl, n.x, n.y+r+5);
    }
  });
  ctx.restore();
}

// ── 그래프 빌드/병합/공개 ────────────────────────────────────────────

function screenToWorld(sx, sy) { return { x:(sx-W/2-panX)/scale+W/2, y:(sy-H/2-panY)/scale+H/2 }; }
function getNodeAt(sx, sy) { const w=screenToWorld(sx,sy); return nodes.find(n=>n.visible&&dist(n,w)<=nodeR(n.level)+5)||null; }

function saveFixedPositions() {
  const data = {};
  nodes.filter(n => n.fixed).forEach(n => { data[n.label] = { x: n.x, y: n.y }; });
  localStorage.setItem('snlog_fixed_pos', JSON.stringify(data));
}
function restoreFixedPositions() {
  try {
    const data = JSON.parse(localStorage.getItem('snlog_fixed_pos') || '{}');
    nodes.forEach(n => { if (data[n.label]) { n.fixed=true; n.x=data[n.label].x; n.y=data[n.label].y; n.vx=0; n.vy=0; } });
  } catch(e) {}
}

function placeChildrenAroundParent(parentNode, children, radius) {
  if (!children.length) return;
  const cx = parentNode.x, cy = parentNode.y;
  children.forEach((n, i) => {
    if(n.fixed) return;
    const angle = (2*Math.PI/children.length)*i - Math.PI/2;
    n.x = cx + Math.cos(angle)*radius; n.y = cy + Math.sin(angle)*radius;
    n.vx = 0; n.vy = 0;
  });
}

function revealByLevel(nodeIds, onComplete) {
  const LEVEL_DELAY = 500;
  const RADII = [0, 300, 220, 150, 100];
  const maxLevel = Math.max(...nodes.filter(n => nodeIds.has(n.id)).map(n => n.level), 0);
  for (let lv = 1; lv <= maxLevel; lv++) {
    setTimeout(() => {
      const levelNodes = nodes.filter(n => nodeIds.has(n.id) && n.level === lv);
      const radius = RADII[Math.min(lv, RADII.length - 1)];
      const byParent = new Map();
      levelNodes.forEach(n => {
        const parentEdge = edges.find(e => e.to === n.id && !e.weakLink);
        const parentId = parentEdge ? parentEdge.from : null;
        const parentNode = parentId ? nodeMap[parentId] : null;
        if (!byParent.has(parentId)) byParent.set(parentId, { parent: parentNode, children: [] });
        byParent.get(parentId).children.push(n);
      });
      byParent.forEach(({ parent, children }) => { if (parent) placeChildrenAroundParent(parent, children, radius); });
      levelNodes.forEach(n => { n.visible = true; });
      nodes.forEach(n => { n._frozen = false; n._frozenFrames = 0; });
      isStable = false;
    }, lv * LEVEL_DELAY);
  }
  isStable = false;
  setTimeout(() => { fitGraph(); if(onComplete) onComplete(); }, maxLevel * LEVEL_DELAY + 600);
}

function fitGraph() {
  if (nodes.length === 0) return;
  const visibleNodes = nodes.filter(n => n.visible);
  if (visibleNodes.length === 0) return;
  const sidebarWidth = document.getElementById('sidebar').classList.contains('collapsed') ? 0 : 380;
  const detailWidth = document.getElementById('detail-panel').classList.contains('open') ? 400 : 0;
  const availW = W - sidebarWidth - detailWidth - 40, availH = H - 40;
  const offsetLeft = sidebarWidth + 20;
  const minX = Math.min(...visibleNodes.map(n => n.x)), maxX = Math.max(...visibleNodes.map(n => n.x));
  const minY = Math.min(...visibleNodes.map(n => n.y)), maxY = Math.max(...visibleNodes.map(n => n.y));
  const graphW = maxX-minX || 1, graphH = maxY-minY || 1;
  const targetScale = Math.min(availW/graphW, availH/graphH, 1.5) * 0.82;
  const centerX = (minX+maxX)/2, centerY = (minY+maxY)/2;
  const targetPanX = (offsetLeft+availW/2) - W/2 - (centerX-W/2)*targetScale;
  const targetPanY = (availH/2+20) - H/2 - (centerY-H/2)*targetScale;
  if (_fitAnimId) cancelAnimationFrame(_fitAnimId);
  const DURATION = 600, startTime = performance.now();
  const startScale = scale, startPanX = panX, startPanY = panY;
  function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  function animate(now) {
    const t = Math.min((now-startTime)/DURATION, 1), e = easeInOut(t);
    scale = startScale + (targetScale-startScale)*e;
    panX = startPanX + (targetPanX-startPanX)*e;
    panY = startPanY + (targetPanY-startPanY)*e;
    if (t < 1) { _fitAnimId = requestAnimationFrame(animate); } else { _fitAnimId = null; }
  }
  _fitAnimId = requestAnimationFrame(animate);
}

function buildGraph() {
  _hueIndex = 0;
  const markdown = window._NOTION_MARKDOWN || '';
  if (!markdown || !markdown.trim()) {
    nodes = []; edges = []; Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
    isStable = false; return;
  }
  const title = window._NOTION_TITLE || '노션 페이지';
  const r = parseMarkdown(markdown, title);
  nodes = r.nodes; edges = r.edges; nodeMap = r.nodeMap;
  const root = nodes.find(n => n.level === 0);
  if (root) { root.x = W/2; root.y = H/2; root.vx = 0; root.vy = 0; }
  nodes.forEach(n => { n.visible = n.level === 0; });
  revealByLevel(new Set(nodes.map(n => n.id)), restoreFixedPositions);
}

function mergeGraph(title, markdown, pageId) {
  const result = parseMarkdown(markdown, title);
  const idMap = {};
  const prefix = 'p' + Date.now() + '_';
  const trackId = pageId || title;
  const existingNodes = nodes.filter(n => n.visible !== false);
  let newRootX, newRootY;
  if (existingNodes.length === 0) { newRootX = W/2 + 500; newRootY = H/2; }
  else {
    const minX = Math.min(...existingNodes.map(n => n.x)), maxX = Math.max(...existingNodes.map(n => n.x));
    const minY = Math.min(...existingNodes.map(n => n.y)), maxY = Math.max(...existingNodes.map(n => n.y));
    const centerX = (minX+maxX)/2, centerY = (minY+maxY)/2;
    const graphW = maxX-minX, graphH = maxY-minY;
    const margin = 300;
    const existingCount = nodes.filter(n => n.level === 0 && n.sourcePageId).length;
    const angles = [0, Math.PI, Math.PI/2, -Math.PI/2, Math.PI*0.75, -Math.PI*0.75, Math.PI*0.25, -Math.PI*0.25];
    const angle = angles[existingCount % angles.length];
    const distX = (graphW/2+margin)*Math.abs(Math.cos(angle));
    const distY = (graphH/2+margin)*Math.abs(Math.sin(angle));
    const dist2 = Math.max(distX+distY, 600);
    newRootX = centerX + Math.cos(angle)*dist2; newRootY = centerY + Math.sin(angle)*dist2;
  }
  const newRoot = result.nodes.find(n => n.level === 0);
  const newRootOldId = newRoot ? newRoot.id : null;
  result.nodes.forEach(n => {
    const oldId = n.id, newId = prefix + oldId;
    idMap[oldId] = newId; n.id = newId; n.sourcePageId = trackId;
    n.visible = false; n.x = newRootX; n.y = newRootY; n.vx = 0; n.vy = 0;
    nodes.push(n); nodeMap[newId] = n;
  });
  const newRootNewId = newRootOldId ? idMap[newRootOldId] : null;
  const newRootNode = newRootNewId ? nodeMap[newRootNewId] : null;
  if (newRootNode) newRootNode.visible = true;
  result.edges.forEach(e => {
    const newFrom = idMap[e.from], newTo = idMap[e.to];
    if (newFrom && newTo && nodeMap[newFrom] && nodeMap[newTo]) edges.push({ from: newFrom, to: newTo });
  });
  const firstRoot = nodes.find(n => n.level === 0 && !n.sourcePageId);
  if (firstRoot && newRootNewId && firstRoot.id !== newRootNewId) {
    edges.push({ from: firstRoot.id, to: newRootNewId, weakLink: true });
  }
  const newNodeIds = new Set(Object.values(idMap));
  revealByLevel(newNodeIds, restoreFixedPositions);
}
