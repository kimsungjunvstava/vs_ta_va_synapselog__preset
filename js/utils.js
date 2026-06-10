// ── 색상/수치 헬퍼 ──────────────────────────────────────────────────

let _hueIndex = 0;
const _labelHueMap = {};

function getBaseHue(label) {
  if (_labelHueMap[label] === undefined) {
    _labelHueMap[label] = (_hueIndex * 137.508) % 360;
    _hueIndex++;
  }
  return _labelHueMap[label];
}

function nodeR(level) {
  return [10, 8, 6.5, 5.5, 4.5, 3.5][Math.min(level, 5)];
}

function drawStar8(ctx, cx, cy, r) {
  const outerLong = r * 2.0, outerShort = r * 1.3, inner = r * 0.52, round = r * 0.28;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI / 4) - Math.PI / 2;
    const nextAngle = angle + Math.PI / 4;
    const outer = (i % 2 === 0) ? outerLong : outerShort;
    const nextOuter = (i % 2 === 0) ? outerShort : outerLong;
    const ox = cx + Math.cos(angle) * outer, oy = cy + Math.sin(angle) * outer;
    const ia = angle + Math.PI / 8;
    const ix = cx + Math.cos(ia) * inner, iy = cy + Math.sin(ia) * inner;
    const nox = cx + Math.cos(nextAngle) * nextOuter, noy = cy + Math.sin(nextAngle) * nextOuter;
    const d1x = ix - ox, d1y = iy - oy, l1 = Math.sqrt(d1x*d1x + d1y*d1y);
    const p1x = ix - (d1x/l1)*round, p1y = iy - (d1y/l1)*round;
    const d2x = nox - ix, d2y = noy - iy, l2 = Math.sqrt(d2x*d2x + d2y*d2y);
    const p2x = ix + (d2x/l2)*round, p2y = iy + (d2y/l2)*round;
    if (i === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
    ctx.lineTo(p1x, p1y);
    ctx.quadraticCurveTo(ix, iy, p2x, p2y);
  }
  ctx.closePath();
}

function hslColor(h, s, l) { return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`; }
function getH1Color(label) { return hslColor(getBaseHue(label), 75, 65); }

function extractHue(color) {
  if (!color) return 0;
  const m = color.match(/hsl\((\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function getSaturation(color) {
  if (!color) return 70;
  const m = color.match(/hsl\(\d+(?:\.\d+)?,\s*(\d+(?:\.\d+)?)%/);
  return m ? parseFloat(m[1]) : 70;
}

function hexToRgb(hex) {
  if (!hex) return [150,150,150];
  if (hex.startsWith('hsl')) {
    const m = hex.match(/hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/);
    if (!m) return [150,150,150];
    let h = parseFloat(m[1])/360, s = parseFloat(m[2])/100, l = parseFloat(m[3])/100;
    if (s === 0) { const v = Math.round(l*255); return [v,v,v]; }
    const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    return [Math.round(hue2rgb(p,q,h+1/3)*255), Math.round(hue2rgb(p,q,h)*255), Math.round(hue2rgb(p,q,h-1/3)*255)];
  }
  if (hex[0] !== '#') return [150,150,150];
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function rgbStr(rgb, a=1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

function cleanLabel(str) {
  if (!str) return '';
  return str
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/[\[\]#`]/g, '').replace(/\{[^}]*\}/g, '').replace(/→|⇒|—/g, '').trim();
}

function cleanDesc(str) {
  if (!str) return '';
  return str
    .replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/[\[\]#`]/g, '').replace(/\{[^}]*\}/g, '').trim();
}

function dist(a, b) { return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2); }

function getChildCount(nodeId) {
  return edges.filter(e => e.from === nodeId && !e.weakLink && !e.manualLink).length;
}
