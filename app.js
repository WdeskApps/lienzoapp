/* =========================================================
   MindMapper — Pizarrón diario de mapas mentales y doodles
   (Vanilla JS + Rough.js)
   ========================================================= */

const svgNS = 'http://www.w3.org/2000/svg';
const LEGACY_KEY = 'mindmapper-data';
const DAY_PREFIX = 'mindmapper-day-';
const VIEW_KEY = 'mindmapper-view';
const DARK_KEY = 'mindmapper-dark';
const STAB_KEY = 'mindmapper-stabilizer';
const AUTOSHAPE_KEY = 'mindmapper-autoshape';
const ONBOARD_KEY = 'mindmapper-onboarded';
const THEME_KEY = 'mindmapper-theme';
const DEFAULT_INK = '#2b2b2b';

const svgCanvas   = document.getElementById('svg-canvas');
const staticDefs  = document.getElementById('static-defs');
const maskDefs    = document.getElementById('mask-defs');
const worldGroup  = document.getElementById('world');
const imagesLayer = document.getElementById('images-layer');
const linksLayer  = document.getElementById('links-layer');
const nodesLayer  = document.getElementById('nodes-layer');
const drawingsLayer = document.getElementById('drawings-layer');
const textLayer   = document.getElementById('text-layer');
const uiLayer     = document.getElementById('ui-layer');
const zoomIndicator = document.getElementById('zoom-indicator');

const rc = rough.svg(svgCanvas);

/* ---------------- Estado ---------------- */
let nodes = [];
let links = [];
let strokes = [];   // {id, brush, color, points:[[x,y],...]}
let doodles = [];   // {id, kind, x, y, w, h, color, filled}
let images = [];    // {id, x, y, w, h, dataUrl, isGif, playing}
let idCounter = 1;

let selection = { type: null, id: null };   // 'node' | 'link' | 'doodle' | 'image'
let currentTool = 'select';                 // select | add-link | draw | shape | erase
let currentColor = DEFAULT_INK;
let currentBrush = 'pencil';
let currentFigure = 'rect';
let figureFilled = false;
let stabilizerOn = true;
let autoShapeOn = true;
let linkSourceId = null;
let isDarkMode = false;
let currentTheme = 'sketch';

let editingNodeId = null;
let selectAllOnFocus = false;
let editPreSnapshot = null;

let draggingNode = null;
let dragOffset = { x: 0, y: 0 };
let panState = null;

let view = { x: 0, y: 0, zoom: 1 };
let viewDayKey = todayKey();

let historyStack = [];
let quotaWarned = false;

let searchMatches = [];
let searchIndex = -1;

let calYear = 0, calMonth = 0;

const textDivs = {};
const knownMarkers = new Set();

const CLOUD_PATH = 'M40,80 A30,30 0 1,1 45,20 A35,35 0 1,1 110,15 A30,30 0 1,1 165,35 A25,25 0 1,1 170,80 A20,20 0 1,1 150,100 L60,100 A20,20 0 1,1 40,80 Z';
const CLOUD_REF_W = 200, CLOUD_REF_H = 120;

const BRUSHES = {
  pencil:      { width: 2.5,  opacity: 1,    cap: 'round' },
  marker:      { width: 7,    opacity: 0.85, cap: 'round' },
  dotted:      { width: 4,    opacity: 0.95, cap: 'round', dash: '0.1 11' },
  spray:       { width: 1.4,  opacity: 0.8 },
  highlighter: { width: 16,   opacity: 0.35, cap: 'butt' }
};

/* Temas visuales: 'sketchy' dibuja con rough.js (trazo a mano);
   los demás generan SVG nítido. Los colores del lienzo/dock viven
   en style.css bajo body[data-theme=...]. */
const THEMES = {
  sketch: {
    sketchy: true, cornerRadius: 0,
    nodeStroke: 2.2, doodleStroke: 2.4,
    font: "'Kalam', cursive", weight: 700,
    darkInk: '#efe9da',
    nodeFill: '#fffdf7', nodeFillDark: '#332f27',
    accentFill: '#e8e2d0', accentFillDark: '#25221c'
  },
  pro: {
    sketchy: false, cornerRadius: 8,
    nodeStroke: 1.7, doodleStroke: 2,
    font: "'Inter', 'Segoe UI', sans-serif", weight: 600,
    darkInk: '#e2e8f0',
    nodeFill: '#ffffff', nodeFillDark: '#1e293b',
    accentFill: '#e2e8f0', accentFillDark: '#0f172a'
  },
  minimal: {
    sketchy: false, cornerRadius: 16,
    nodeStroke: 2, doodleStroke: 2.2,
    font: "'Nunito', 'Segoe UI', sans-serif", weight: 700,
    darkInk: '#e9e9f0',
    nodeFill: '#ffffff', nodeFillDark: '#26262e',
    accentFill: '#ececf2', accentFillDark: '#1b1b22'
  }
};

function themeCfg() { return THEMES[currentTheme] || THEMES.sketch; }

/* =========================================================
   Utilidades
   ========================================================= */
function genId() { return 'n' + (idCounter++); }
function liveNode(id) { return nodes.find(n => n.id === id) || null; }
function liveDoodle(id) { return doodles.find(d => d.id === id) || null; }
function liveImage(id) { return images.find(i => i.id === id) || null; }
function snapshot() { return JSON.stringify({ nodes, links, strokes, doodles, images }); }
function commitIfChanged(before) {
  const after = snapshot();
  if (before !== after) {
    historyStack.push(before);
    if (historyStack.length > 30) historyStack.shift();
  }
}
function boardIsEmpty() {
  return !nodes.length && !links.length && !strokes.length && !doodles.length && !images.length;
}
function saveLocal() {
  const key = DAY_PREFIX + viewDayKey;
  try {
    // Un día sin contenido no debe quedar marcado en el calendario
    if (boardIsEmpty()) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, snapshot());
  } catch (e) {
    if (!quotaWarned) {
      quotaWarned = true;
      alert('El almacenamiento local está lleno. Borra imágenes o días antiguos para seguir guardando.');
    }
  }
}
function resolveColor(hex) {
  return (isDarkMode && hex === DEFAULT_INK) ? themeCfg().darkInk : hex;
}
function r1(v) { return Math.round(v * 10) / 10; }

/* =========================================================
   Días / calendario
   ========================================================= */
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseDayKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return { y, m: m - 1, d };
}
function formatDayKey(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function dayHasData(key) {
  return localStorage.getItem(DAY_PREFIX + key) !== null;
}

function updateDayChip() {
  const chip = document.getElementById('day-chip');
  const label = document.getElementById('day-chip-label');
  const p = parseDayKey(viewDayKey);
  const date = new Date(p.y, p.m, p.d);
  label.textContent = new Intl.DateTimeFormat('es', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  }).format(date);
  chip.classList.toggle('not-today', viewDayKey !== todayKey());
}

function loadBoard(dayKey) {
  nodes = []; links = []; strokes = []; doodles = []; images = [];
  let raw = localStorage.getItem(DAY_PREFIX + dayKey);
  if (!raw && dayKey === todayKey()) {
    // Migración: pizarras guardadas antes del sistema por día
    raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      try {
        localStorage.setItem(DAY_PREFIX + dayKey, raw);
        localStorage.removeItem(LEGACY_KEY);
      } catch (e) { /* si no cabe, se seguirá leyendo del legado */ }
    }
  }
  if (raw) {
    try {
      const data = JSON.parse(raw);
      nodes = data.nodes || [];
      links = data.links || [];
      strokes = data.strokes || [];
      doodles = data.doodles || [];
      images = data.images || [];
      nodes.forEach(n => { if (n.icon === undefined) n.icon = ''; });
    } catch (e) { /* pizarra corrupta: se parte vacía */ }
  }
  let maxId = 0;
  [...nodes, ...links, ...strokes, ...doodles, ...images].forEach(o => {
    const n = parseInt(String(o.id).replace('n', ''), 10);
    if (!isNaN(n) && n > maxId) maxId = n;
  });
  idCounter = maxId + 1;
  if (!nodes.length && !links.length && !strokes.length && !doodles.length && !images.length
      && dayKey === todayKey() && !localStorage.getItem(ONBOARD_KEY)) {
    seedExample();
  }
}

function switchDay(dayKey) {
  if (dayKey === viewDayKey) return;
  saveLocal();
  viewDayKey = dayKey;
  selection = { type: null, id: null };
  editingNodeId = null;
  linkSourceId = null;
  historyStack = [];
  loadBoard(dayKey);
  updateDayChip();
  render();
}

/* ---------------- UI del calendario ---------------- */
function renderCalendar() {
  const pop = document.getElementById('calendar-popover');
  pop.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'cal-header';
  const prev = document.createElement('button');
  prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  const title = document.createElement('span');
  title.className = 'cal-title';
  title.textContent = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' })
    .format(new Date(calYear, calMonth, 1));
  const next = document.createElement('button');
  next.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  prev.addEventListener('click', e => { e.stopPropagation(); calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
  next.addEventListener('click', e => { e.stopPropagation(); calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
  header.appendChild(prev); header.appendChild(title); header.appendChild(next);
  pop.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  ['L', 'M', 'X', 'J', 'V', 'S', 'D'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const tKey = todayKey();

  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('button');
    blank.className = 'cal-cell blank';
    grid.appendChild(blank);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = formatDayKey(calYear, calMonth, d);
    const cell = document.createElement('button');
    cell.className = 'cal-cell';
    cell.textContent = d;
    if (dayHasData(key)) cell.classList.add('has-data');
    if (key === tKey) cell.classList.add('today');
    if (key === viewDayKey) cell.classList.add('viewing');
    cell.addEventListener('click', e => {
      e.stopPropagation();
      closePopovers();
      switchDay(key);
    });
    grid.appendChild(cell);
  }
  pop.appendChild(grid);
}

/* =========================================================
   Vista (pan & zoom)
   ========================================================= */
function screenToWorld(clientX, clientY) {
  const rect = svgCanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom
  };
}

function applyView() {
  worldGroup.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.zoom})`);
  const t = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  textLayer.style.transform = t;
  uiLayer.style.transform = t;
  zoomIndicator.textContent = Math.round(view.zoom * 100) + '%';
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
}

function resetView() {
  view = { x: 0, y: 0, zoom: 1 };
  applyView();
}

function loadView() {
  const raw = localStorage.getItem(VIEW_KEY);
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (typeof v.zoom === 'number') view = v;
    } catch (e) { /* vista por defecto */ }
  }
}

function loadDarkMode() {
  isDarkMode = localStorage.getItem(DARK_KEY) === '1';
  document.body.classList.toggle('dark', isDarkMode);
  document.getElementById('darkmode-btn').innerHTML =
    isDarkMode ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

function loadDrawPrefs() {
  stabilizerOn = localStorage.getItem(STAB_KEY) !== '0';
  autoShapeOn = localStorage.getItem(AUTOSHAPE_KEY) !== '0';
  document.getElementById('stabilizer-toggle').classList.toggle('on', stabilizerOn);
  document.getElementById('autoshape-toggle').classList.toggle('on', autoShapeOn);
}

function seedExample() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  nodes = [
    { id: 'n1', x: cx - 90,  y: cy - 170, w: 180, h: 100, shape: 'rect',      text: 'Idea Central',    color: '#2b2b2b', icon: '⭐', collapsed: false },
    { id: 'n2', x: cx - 340, y: cy + 30,  w: 175, h: 95,  shape: 'cloud',     text: 'Lluvia de ideas', color: '#1d4ed8', icon: '',   collapsed: false },
    { id: 'n3', x: cx + 130, y: cy + 30,  w: 175, h: 95,  shape: 'circle',    text: 'Tareas',          color: '#16a34a', icon: '',   collapsed: false },
    { id: 'n4', x: cx - 70,  y: cy + 190, w: 175, h: 95,  shape: 'clipboard', text: 'Notas',           color: '#dc2626', icon: '',   collapsed: false }
  ];
  links = [
    { id: 'l1', from: 'n1', to: 'n2', color: '#1d4ed8' },
    { id: 'l2', from: 'n1', to: 'n3', color: '#16a34a' },
    { id: 'l3', from: 'n1', to: 'n4', color: '#dc2626' }
  ];
  idCounter = 5;
}

/* =========================================================
   Visibilidad de grafo (BFS + inDegree, soporta ciclos)
   ========================================================= */
function computeGraph() {
  const byId = {};
  nodes.forEach(n => byId[n.id] = n);
  const adj = {};
  nodes.forEach(n => adj[n.id] = []);
  const inDegree = {};
  nodes.forEach(n => inDegree[n.id] = 0);
  links.forEach(l => {
    if (adj[l.from]) adj[l.from].push(l.to);
    if (inDegree[l.to] !== undefined) inDegree[l.to]++;
  });

  const reachableFull = new Set();
  function bfsIgnoreCollapse(startId) {
    const queue = [startId];
    reachableFull.add(startId);
    while (queue.length) {
      const id = queue.shift();
      (adj[id] || []).forEach(childId => {
        if (!reachableFull.has(childId)) {
          reachableFull.add(childId);
          queue.push(childId);
        }
      });
    }
  }
  const roots = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  roots.forEach(r => { if (!reachableFull.has(r)) bfsIgnoreCollapse(r); });
  nodes.forEach(n => { if (!reachableFull.has(n.id)) { roots.push(n.id); bfsIgnoreCollapse(n.id); } });

  const visible = new Set();
  function bfsRespectCollapse(startId) {
    if (visible.has(startId)) return;
    const queue = [startId];
    visible.add(startId);
    while (queue.length) {
      const id = queue.shift();
      const node = byId[id];
      if (!node || node.collapsed) continue;
      (adj[id] || []).forEach(childId => {
        if (!visible.has(childId)) {
          visible.add(childId);
          queue.push(childId);
        }
      });
    }
  }
  roots.forEach(r => bfsRespectCollapse(r));

  return { adj, inDegree, visible, byId };
}

/* =========================================================
   Render principal
   ========================================================= */
let graphCache = null;

function render() {
  graphCache = computeGraph();
  renderSVG();
  renderTextLayer();
  renderUILayer();
}

function visibleNodeList() {
  return nodes.filter(n => graphCache.visible.has(n.id));
}
function visibleLinkList() {
  return links.filter(l => graphCache.visible.has(l.from) && graphCache.visible.has(l.to));
}

/* ---------------- Formas de nodos (Rough.js) ---------------- */
/* Fachada de primitivas: en temas 'sketchy' delega en rough.js;
   en los limpios crea el elemento SVG equivalente con trazo nítido. */
function cleanEl(tag, opts) {
  const el = document.createElementNS(svgNS, tag);
  el.setAttribute('stroke', opts.stroke);
  el.setAttribute('stroke-width', opts.strokeWidth);
  el.setAttribute('fill', opts.fill || 'none');
  if (opts.fillOpacity != null) el.setAttribute('fill-opacity', opts.fillOpacity);
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('stroke-linecap', 'round');
  return el;
}

const draw = {
  rectangle(x, y, w, h, opts) {
    if (themeCfg().sketchy) return rc.rectangle(x, y, w, h, opts);
    const el = cleanEl('rect', opts);
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('width', w); el.setAttribute('height', h);
    const r = opts.rx != null ? opts.rx : Math.min(themeCfg().cornerRadius, w / 2, h / 2);
    if (r) el.setAttribute('rx', r);
    return el;
  },
  ellipse(cx, cy, w, h, opts) {
    if (themeCfg().sketchy) return rc.ellipse(cx, cy, w, h, opts);
    const el = cleanEl('ellipse', opts);
    el.setAttribute('cx', cx); el.setAttribute('cy', cy);
    el.setAttribute('rx', w / 2); el.setAttribute('ry', h / 2);
    return el;
  },
  polygon(pts, opts) {
    if (themeCfg().sketchy) return rc.polygon(pts, opts);
    const el = cleanEl('polygon', opts);
    el.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    return el;
  },
  path(d, opts) {
    if (themeCfg().sketchy) return rc.path(d, opts);
    const el = cleanEl('path', opts);
    el.setAttribute('d', d);
    return el;
  },
  line(x1, y1, x2, y2, opts) {
    if (themeCfg().sketchy) return rc.line(x1, y1, x2, y2, opts);
    const el = cleanEl('line', opts);
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    return el;
  }
};

function shapeOptions(node) {
  const t = themeCfg();
  const opts = {
    stroke: resolveColor(node.color),
    strokeWidth: t.nodeStroke,
    fill: isDarkMode ? t.nodeFillDark : t.nodeFill
  };
  if (t.sketchy) {
    opts.roughness = 1.6;
    opts.bowing = 1.2;
    opts.fillStyle = 'solid';
  }
  return opts;
}

function polygonPoints(shape, w, h) {
  if (shape === 'hexagon') {
    return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]];
  }
  if (shape === 'diamond') {
    return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
  }
  if (shape === 'star') {
    const cx = w / 2, cy = h / 2, rOuter = Math.min(w, h) / 2, rInner = rOuter * 0.45;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    return pts;
  }
  return null;
}

function buildNodeShape(node) {
  const g = document.createElementNS(svgNS, 'g');
  g.classList.add('node-shape');
  g.setAttribute('transform', `translate(${node.x},${node.y})`);
  const opts = shapeOptions(node);
  const t = themeCfg();
  const accent = isDarkMode ? t.accentFillDark : t.accentFill;
  let el;

  if (node.shape === 'circle') {
    el = draw.ellipse(node.w / 2, node.h / 2, node.w, node.h, opts);
  } else if (node.shape === 'cloud') {
    const inner = document.createElementNS(svgNS, 'g');
    inner.setAttribute('transform', `scale(${node.w / CLOUD_REF_W}, ${node.h / CLOUD_REF_H})`);
    inner.appendChild(draw.path(CLOUD_PATH, opts));
    el = inner;
  } else if (node.shape === 'clipboard') {
    el = document.createElementNS(svgNS, 'g');
    el.appendChild(draw.rectangle(0, 0, node.w, node.h, opts));
    const clipW = node.w * 0.36, clipH = Math.max(10, node.h * 0.1);
    const clipX = (node.w - clipW) / 2, clipY = -clipH * 0.5;
    el.appendChild(draw.rectangle(clipX, clipY, clipW, clipH, { ...opts, fill: accent, rx: 4 }));
  } else if (node.shape === 'sticky') {
    el = document.createElementNS(svgNS, 'g');
    el.appendChild(draw.rectangle(0, 0, node.w, node.h, { ...opts, rx: 0 }));
    const fold = Math.min(node.w, node.h) * 0.22;
    el.appendChild(draw.polygon([[node.w - fold, 0], [node.w, 0], [node.w, fold]], { ...opts, fill: accent }));
    el.appendChild(draw.line(node.w - fold, 0, node.w - fold, fold, opts));
    el.appendChild(draw.line(node.w - fold, fold, node.w, fold, opts));
  } else if (node.shape === 'hexagon' || node.shape === 'diamond' || node.shape === 'star') {
    el = draw.polygon(polygonPoints(node.shape, node.w, node.h), opts);
  } else {
    el = draw.rectangle(0, 0, node.w, node.h, opts);
  }
  g.appendChild(el);
  return g;
}

/* ---------------- Enlaces + máscaras SVG ---------------- */
function markerId(color) { return 'arrow-' + color.replace('#', ''); }

function ensureMarker(color) {
  const id = markerId(color);
  if (knownMarkers.has(id)) return id;
  const marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', 'M0,0 L10,5 L0,10 Z');
  path.setAttribute('fill', color);
  marker.appendChild(path);
  staticDefs.appendChild(marker);
  knownMarkers.add(id);
  return id;
}

function edgePoint(node, towardX, towardY) {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
  let dx = towardX - cx, dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = node.w / 2, hh = node.h / 2;
  const scale = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function curvedPath(p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const c1x = p1.x + dx * 0.5, c1y = p1.y + dy * 0.15;
  const c2x = p1.x + dx * 0.5, c2y = p1.y + dy * 0.85;
  return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
}

function buildMask(id, rects, isSolid) {
  const mask = document.createElementNS(svgNS, 'mask');
  mask.setAttribute('id', id);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', '-8000'); bg.setAttribute('y', '-8000');
  bg.setAttribute('width', '30000'); bg.setAttribute('height', '30000');
  bg.setAttribute('fill', isSolid ? 'white' : 'black');
  mask.appendChild(bg);
  rects.forEach(n => {
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', n.x); r.setAttribute('y', n.y);
    r.setAttribute('width', n.w); r.setAttribute('height', n.h);
    r.setAttribute('rx', 10);
    r.setAttribute('fill', isSolid ? 'black' : 'white');
    mask.appendChild(r);
  });
  return mask;
}

function buildLink(link, allVisibleNodes) {
  const byId = graphCache.byId;
  const from = byId[link.from], to = byId[link.to];
  if (!from || !to) return null;

  const p1 = edgePoint(from, to.x + to.w / 2, to.y + to.h / 2);
  const p2 = edgePoint(to, from.x + from.w / 2, from.y + from.h / 2);
  const d = curvedPath(p1, p2);

  const otherNodes = allVisibleNodes.filter(n => n.id !== link.from && n.id !== link.to);
  const maskSolidId = `mask-solid-${link.id}`;
  const maskDashedId = `mask-dashed-${link.id}`;
  maskDefs.appendChild(buildMask(maskSolidId, otherNodes, true));
  maskDefs.appendChild(buildMask(maskDashedId, otherNodes, false));

  const isSelected = selection.type === 'link' && selection.id === link.id;
  const strokeColor = isSelected ? '#1d4ed8' : resolveColor(link.color || DEFAULT_INK);
  const mId = ensureMarker(strokeColor);

  const g = document.createElementNS(svgNS, 'g');
  g.classList.add('link-group');
  g.dataset.linkId = link.id;

  const dashedPath = document.createElementNS(svgNS, 'path');
  dashedPath.setAttribute('d', d);
  dashedPath.setAttribute('class', 'link-dashed');
  dashedPath.setAttribute('stroke', strokeColor);
  dashedPath.setAttribute('stroke-width', isSelected ? 3.4 : 2.6);
  dashedPath.setAttribute('stroke-dasharray', '7,7');
  dashedPath.setAttribute('opacity', '0.4');
  dashedPath.setAttribute('fill', 'none');
  dashedPath.setAttribute('mask', `url(#${maskDashedId})`);

  const solidPath = document.createElementNS(svgNS, 'path');
  solidPath.setAttribute('d', d);
  solidPath.setAttribute('class', 'link-solid');
  solidPath.setAttribute('stroke', strokeColor);
  solidPath.setAttribute('stroke-width', isSelected ? 3.4 : 2.6);
  solidPath.setAttribute('fill', 'none');
  solidPath.setAttribute('marker-end', `url(#${mId})`);
  solidPath.setAttribute('mask', `url(#${maskSolidId})`);

  const hitPath = document.createElementNS(svgNS, 'path');
  hitPath.setAttribute('d', d);
  hitPath.setAttribute('class', 'link-hit');
  hitPath.setAttribute('stroke', 'transparent');
  hitPath.setAttribute('stroke-width', '16');
  hitPath.setAttribute('fill', 'none');
  hitPath.addEventListener('pointerdown', e => { e.stopPropagation(); selectLink(link.id); });

  g.appendChild(dashedPath);
  g.appendChild(solidPath);
  g.appendChild(hitPath);
  return g;
}

/* ---------------- Trazos a mano alzada ---------------- */
function strokePathD(points) {
  if (!points.length) return '';
  if (points.length < 3) {
    return 'M ' + points.map(p => p[0] + ' ' + p[1]).join(' L ');
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i][0] + points[i + 1][0]) / 2;
    const my = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]} ${mx} ${my}`;
  }
  return d;
}

function prand(seed) {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function buildSprayDots(points, color, parent) {
  points.forEach((p, i) => {
    for (let j = 0; j < 6; j++) {
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', p[0] + (prand(i * 12.9898 + j * 78.233) - 0.5) * 18);
      dot.setAttribute('cy', p[1] + (prand(i * 39.346 + j * 11.135) - 0.5) * 18);
      dot.setAttribute('r', 0.9 + prand(i * 7.77 + j * 3.33) * 1.3);
      dot.setAttribute('fill', color);
      dot.setAttribute('opacity', 0.75);
      parent.appendChild(dot);
    }
  });
}

function buildStrokeEl(s) {
  const color = resolveColor(s.color);
  const cfg = BRUSHES[s.brush] || BRUSHES.pencil;
  if (s.brush === 'spray') {
    const g = document.createElementNS(svgNS, 'g');
    g.classList.add('stroke-el');
    buildSprayDots(s.points, color, g);
    return g;
  }
  const path = document.createElementNS(svgNS, 'path');
  path.classList.add('stroke-el');
  path.setAttribute('d', strokePathD(s.points));
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', cfg.width);
  path.setAttribute('stroke-linecap', cfg.cap || 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('opacity', cfg.opacity);
  if (cfg.dash) path.setAttribute('stroke-dasharray', cfg.dash);
  path.setAttribute('fill', 'none');
  return path;
}

/* ---------------- Figuras doodle (círculos, cuadrados...) ---------------- */
function doodleBBox(d) {
  const x = Math.min(d.x, d.x + d.w), y = Math.min(d.y, d.y + d.h);
  return { x, y, w: Math.abs(d.w), h: Math.abs(d.h) };
}

function doodleOptions(d) {
  const t = themeCfg();
  const color = resolveColor(d.color);
  const opts = { stroke: color, strokeWidth: t.doodleStroke };
  if (t.sketchy) { opts.roughness = 1.5; opts.bowing = 1.1; }
  if (d.filled && d.kind !== 'line' && d.kind !== 'arrow') {
    opts.fill = color;
    if (t.sketchy) {
      opts.fillStyle = 'hachure';
      opts.hachureGap = 7;
      opts.fillWeight = 1.3;
    } else {
      // En temas limpios el relleno es un velo del mismo color
      opts.fillOpacity = 0.16;
    }
  }
  return opts;
}

function buildDoodleEl(d) {
  const opts = doodleOptions(d);
  const g = document.createElementNS(svgNS, 'g');
  g.classList.add('doodle-el');
  const b = doodleBBox(d);

  if (d.kind === 'ellipse') {
    g.appendChild(draw.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, opts));
  } else if (d.kind === 'triangle') {
    g.appendChild(draw.polygon([[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], opts));
  } else if (d.kind === 'line' || d.kind === 'arrow') {
    g.appendChild(draw.line(d.x, d.y, d.x + d.w, d.y + d.h, opts));
    if (d.kind === 'arrow') {
      const angle = Math.atan2(d.h, d.w);
      const ex = d.x + d.w, ey = d.y + d.h, len = 15;
      g.appendChild(draw.line(ex, ey, ex - len * Math.cos(angle - 0.45), ey - len * Math.sin(angle - 0.45), opts));
      g.appendChild(draw.line(ex, ey, ex - len * Math.cos(angle + 0.45), ey - len * Math.sin(angle + 0.45), opts));
    }
  } else {
    g.appendChild(draw.rectangle(b.x, b.y, b.w, b.h, { ...opts, rx: themeCfg().sketchy ? null : 6 }));
  }
  return g;
}

function buildDoodleHit(d) {
  let hit;
  if (d.kind === 'line' || d.kind === 'arrow') {
    hit = document.createElementNS(svgNS, 'path');
    hit.setAttribute('d', `M ${d.x} ${d.y} L ${d.x + d.w} ${d.y + d.h}`);
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '16');
    hit.setAttribute('fill', 'none');
  } else {
    const b = doodleBBox(d);
    hit = document.createElementNS(svgNS, 'rect');
    hit.setAttribute('x', b.x); hit.setAttribute('y', b.y);
    hit.setAttribute('width', b.w); hit.setAttribute('height', b.h);
    hit.setAttribute('fill', 'transparent');
  }
  hit.classList.add('doodle-hit');
  hit.dataset.id = d.id;
  hit.addEventListener('pointerdown', e => onDoodlePointerDown(e, d.id));
  return hit;
}

/* ---------------- Imágenes pegadas ---------------- */
function buildImageEl(im) {
  const el = document.createElementNS(svgNS, 'image');
  el.setAttribute('x', im.x); el.setAttribute('y', im.y);
  el.setAttribute('width', im.w); el.setAttribute('height', im.h);
  el.setAttribute('href', im.dataUrl);
  el.setAttribute('preserveAspectRatio', 'none');
  el.dataset.id = im.id;
  el.addEventListener('pointerdown', e => onImagePointerDown(e, im.id));
  return el;
}

// Los GIF dentro de <image> SVG quedan congelados en Chromium; para verlos
// animados se superpone un <foreignObject> con un <img> HTML real. Al pausar
// basta con quitar el overlay: el <image> de abajo muestra el primer frame.
function buildGifOverlay(im) {
  const fo = document.createElementNS(svgNS, 'foreignObject');
  fo.setAttribute('x', im.x); fo.setAttribute('y', im.y);
  fo.setAttribute('width', im.w); fo.setAttribute('height', im.h);
  fo.classList.add('gif-overlay');
  const img = document.createElement('img');
  img.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  img.src = im.dataUrl;
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.pointerEvents = 'none';
  fo.appendChild(img);
  return fo;
}

function renderSVG() {
  imagesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';
  linksLayer.innerHTML = '';
  drawingsLayer.innerHTML = '';
  maskDefs.innerHTML = '';

  images.forEach(im => {
    imagesLayer.appendChild(buildImageEl(im));
    if (im.isGif && im.playing) imagesLayer.appendChild(buildGifOverlay(im));
  });

  const visNodes = visibleNodeList();
  visibleLinkList().forEach(link => {
    const g = buildLink(link, visNodes);
    if (g) linksLayer.appendChild(g);
  });
  visNodes.forEach(node => nodesLayer.appendChild(buildNodeShape(node)));

  doodles.forEach(d => drawingsLayer.appendChild(buildDoodleEl(d)));
  strokes.forEach(s => drawingsLayer.appendChild(buildStrokeEl(s)));
  doodles.forEach(d => drawingsLayer.appendChild(buildDoodleHit(d)));
}

/* =========================================================
   Capa de texto — Smart Text Engine
   ========================================================= */
function fitText(div, node) {
  const maxFont = 30, minFont = 8;
  let fs = maxFont;
  div.style.fontSize = fs + 'px';
  while (fs > minFont && (div.scrollHeight > div.clientHeight || div.scrollWidth > div.clientWidth)) {
    fs -= 1;
    div.style.fontSize = fs + 'px';
  }
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function startEditing(nodeId, selectAll) {
  if (draggingNode) return;
  editPreSnapshot = snapshot();
  editingNodeId = nodeId;
  selectAllOnFocus = !!selectAll;
  render();
}

function finishEditing(nodeId) {
  if (editingNodeId !== nodeId) return;
  editingNodeId = null;
  if (editPreSnapshot) {
    commitIfChanged(editPreSnapshot);
    editPreSnapshot = null;
  }
  saveLocal();
  render();
}

function renderTextLayer() {
  const visNodes = visibleNodeList();
  const visibleIds = new Set(visNodes.map(n => n.id));
  const searchOpen = document.getElementById('search-panel').classList.contains('open');

  Object.keys(textDivs).forEach(id => {
    if (!visibleIds.has(id)) { textDivs[id].remove(); delete textDivs[id]; }
  });

  visNodes.forEach(node => {
    const nodeId = node.id;
    let div = textDivs[nodeId];
    if (!div) {
      div = document.createElement('div');
      div.className = 'node-text';
      div.dataset.id = nodeId;
      div.addEventListener('dblclick', (e) => { e.stopPropagation(); startEditing(nodeId, false); });
      div.addEventListener('pointerdown', (e) => onNodePointerDown(e, nodeId));
      div.addEventListener('input', () => {
        const n = liveNode(nodeId);
        if (n) { n.text = div.innerText; fitText(div, n); }
      });
      div.addEventListener('blur', () => finishEditing(nodeId));
      div.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { div.blur(); return; }
        if (e.key === 'Tab') { e.preventDefault(); finishEditing(nodeId); addChildNode(nodeId); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEditing(nodeId); addSiblingNode(nodeId); return; }
      });
      textLayer.appendChild(div);
      textDivs[nodeId] = div;
    }

    div.style.left = node.x + 'px';
    div.style.top = node.y + 'px';
    div.style.width = node.w + 'px';
    div.style.height = node.h + 'px';
    div.style.color = resolveColor(node.color);

    const isEditing = editingNodeId === nodeId;
    div.contentEditable = isEditing ? 'true' : 'false';
    div.classList.toggle('editing', isEditing);
    div.classList.toggle('pending-source', linkSourceId === nodeId);
    div.classList.toggle('search-hit', searchOpen && searchMatches.includes(nodeId));

    if (document.activeElement !== div) div.textContent = node.text;
    fitText(div, node);

    if (isEditing && document.activeElement !== div) {
      div.focus();
      if (selectAllOnFocus) { document.execCommand('selectAll', false, null); selectAllOnFocus = false; }
      else placeCaretAtEnd(div);
    }
  });
}

/* =========================================================
   Capa UI — selección, resize, colapso, etiquetas, GIF
   ========================================================= */
function selectionBBox() {
  if (selection.type === 'node') {
    const n = graphCache.byId[selection.id];
    return n ? { x: n.x, y: n.y, w: n.w, h: n.h } : null;
  }
  if (selection.type === 'doodle') {
    const d = liveDoodle(selection.id);
    return d ? doodleBBox(d) : null;
  }
  if (selection.type === 'image') {
    const im = liveImage(selection.id);
    return im ? { x: im.x, y: im.y, w: im.w, h: im.h } : null;
  }
  return null;
}

function renderUILayer() {
  uiLayer.innerHTML = '';
  const visNodes = visibleNodeList();
  const adj = graphCache.adj;

  visNodes.forEach(node => {
    if (node.icon) {
      const badge = document.createElement('div');
      badge.className = 'node-icon-badge';
      badge.textContent = node.icon;
      badge.style.left = node.x + 'px';
      badge.style.top = node.y + 'px';
      uiLayer.appendChild(badge);
    }
    if ((adj[node.id] || []).length > 0) {
      const btn = document.createElement('button');
      btn.className = 'collapse-btn';
      btn.textContent = node.collapsed ? '+' : '−';
      btn.style.left = (node.x + node.w / 2 - 11) + 'px';
      btn.style.top = (node.y + node.h - 11) + 'px';
      btn.title = node.collapsed ? 'Expandir rama' : 'Colapsar rama';
      btn.addEventListener('pointerdown', e => { e.stopPropagation(); toggleCollapse(node.id); });
      uiLayer.appendChild(btn);
    }
  });

  // Botón play/stop sobre cada GIF
  images.forEach(im => {
    if (!im.isGif) return;
    const btn = document.createElement('button');
    btn.className = 'gif-btn';
    btn.innerHTML = im.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    btn.title = im.playing ? 'Detener GIF' : 'Reproducir GIF';
    btn.style.left = (im.x + im.w - 32) + 'px';
    btn.style.top = (im.y + 6) + 'px';
    btn.addEventListener('pointerdown', e => {
      e.stopPropagation();
      im.playing = !im.playing;
      saveLocal();
      render();
    });
    uiLayer.appendChild(btn);
  });

  const b = selectionBBox();
  if (b) {
    const box = document.createElement('div');
    box.className = 'selection-box';
    box.style.left = (b.x - 5) + 'px';
    box.style.top = (b.y - 5) + 'px';
    box.style.width = (b.w + 10) + 'px';
    box.style.height = (b.h + 10) + 'px';
    uiLayer.appendChild(box);

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    if (selection.type === 'doodle') {
      const d = liveDoodle(selection.id);
      handle.style.left = (d.x + d.w - 8) + 'px';
      handle.style.top = (d.y + d.h - 8) + 'px';
    } else {
      handle.style.left = (b.x + b.w - 8) + 'px';
      handle.style.top = (b.y + b.h - 8) + 'px';
    }
    handle.addEventListener('pointerdown', e => startResize(e));
    uiLayer.appendChild(handle);
  }
}

function toggleCollapse(nodeId) {
  const before = snapshot();
  const node = liveNode(nodeId);
  if (node) node.collapsed = !node.collapsed;
  commitIfChanged(before);
  saveLocal();
  render();
}

/* =========================================================
   Selección
   ========================================================= */
function selectNode(id) { selection = { type: 'node', id }; render(); }
function selectLink(id) { selection = { type: 'link', id }; render(); }
function deselect() { selection = { type: null, id: null }; render(); }

/* =========================================================
   Arrastres (nodos, doodles, imágenes)
   ========================================================= */
function onNodePointerDown(e, nodeId) {
  if (currentTool === 'add-link') {
    e.stopPropagation();
    handleLinkClick(nodeId);
    return;
  }
  if (currentTool !== 'select') return;
  if (editingNodeId === nodeId) return;
  const node = liveNode(nodeId);
  if (!node) return;
  e.stopPropagation();
  selectNode(nodeId);

  const before = snapshot();
  draggingNode = node;
  const startWorld = screenToWorld(e.clientX, e.clientY);
  dragOffset.x = startWorld.x - node.x;
  dragOffset.y = startWorld.y - node.y;

  function onMove(ev) {
    const w = screenToWorld(ev.clientX, ev.clientY);
    draggingNode.x = w.x - dragOffset.x;
    draggingNode.y = w.y - dragOffset.y;
    render();
  }
  function onUp() {
    draggingNode = null;
    commitIfChanged(before);
    saveLocal();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startObjectDrag(e, obj, before) {
  const startWorld = screenToWorld(e.clientX, e.clientY);
  const offX = startWorld.x - obj.x, offY = startWorld.y - obj.y;
  function onMove(ev) {
    const w = screenToWorld(ev.clientX, ev.clientY);
    obj.x = r1(w.x - offX);
    obj.y = r1(w.y - offY);
    render();
  }
  function onUp() {
    commitIfChanged(before);
    saveLocal();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onDoodlePointerDown(e, id) {
  if (currentTool !== 'select') return;
  const d = liveDoodle(id);
  if (!d) return;
  e.stopPropagation();
  selection = { type: 'doodle', id };
  render();
  startObjectDrag(e, d, snapshot());
}

function onImagePointerDown(e, id) {
  if (currentTool !== 'select') return;
  const im = liveImage(id);
  if (!im) return;
  e.stopPropagation();
  e.preventDefault();
  selection = { type: 'image', id };
  render();
  startObjectDrag(e, im, snapshot());
}

/* =========================================================
   Redimensionar (nodo, doodle o imagen seleccionada)
   ========================================================= */
function startResize(e) {
  e.stopPropagation();
  let target = null, minW = 20, minH = 20, allowNegative = false;
  if (selection.type === 'node') { target = liveNode(selection.id); minW = 70; minH = 55; }
  else if (selection.type === 'doodle') {
    target = liveDoodle(selection.id);
    allowNegative = target && (target.kind === 'line' || target.kind === 'arrow');
  }
  else if (selection.type === 'image') { target = liveImage(selection.id); minW = 30; minH = 30; }
  if (!target) return;

  const before = snapshot();
  const startWorld = screenToWorld(e.clientX, e.clientY);
  const startW = target.w, startH = target.h;

  function onMove(ev) {
    const w = screenToWorld(ev.clientX, ev.clientY);
    const dw = w.x - startWorld.x, dh = w.y - startWorld.y;
    if (allowNegative) {
      target.w = r1(startW + dw);
      target.h = r1(startH + dh);
    } else {
      target.w = Math.max(minW, r1(startW + dw));
      target.h = Math.max(minH, r1(startH + dh));
    }
    render();
  }
  function onUp() {
    commitIfChanged(before);
    saveLocal();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* =========================================================
   Conexiones (enlaces)
   ========================================================= */
function handleLinkClick(nodeId) {
  if (!linkSourceId) {
    linkSourceId = nodeId;
  } else if (linkSourceId === nodeId) {
    linkSourceId = null;
  } else {
    const before = snapshot();
    links.push({ id: genId(), from: linkSourceId, to: nodeId, color: currentColor });
    commitIfChanged(before);
    saveLocal();
    linkSourceId = null;
  }
  render();
}

/* =========================================================
   Añadir nodos
   ========================================================= */
function addNode(shape) {
  const before = snapshot();
  const id = genId();
  const w = 175, h = 100;
  const jitter = () => Math.random() * 50 - 25;
  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
  const x = center.x - w / 2 + jitter();
  const y = center.y - h / 2 + jitter();
  nodes.push({ id, x, y, w, h, shape, text: 'Nueva idea', color: currentColor, icon: '', collapsed: false });
  commitIfChanged(before);
  saveLocal();
  selection = { type: 'node', id };
  render();
  startEditing(id, true);
}

function addChildNode(parentId, shapeOverride) {
  const parent = liveNode(parentId);
  if (!parent) return;
  const before = snapshot();
  const childCount = links.filter(l => l.from === parentId).length;
  const angle = childCount * (Math.PI / 4);
  const radius = 260;
  const id = genId();
  const w = 170, h = 95;
  const cx = parent.x + parent.w / 2 + Math.cos(angle) * radius;
  const cy = parent.y + parent.h / 2 + Math.sin(angle) * radius;
  nodes.push({
    id, x: cx - w / 2, y: cy - h / 2, w, h,
    shape: shapeOverride || parent.shape,
    text: 'Nueva idea', color: parent.color, icon: '', collapsed: false
  });
  links.push({ id: genId(), from: parentId, to: id, color: parent.color });
  commitIfChanged(before);
  saveLocal();
  selection = { type: 'node', id };
  render();
  startEditing(id, true);
}

function addSiblingNode(nodeId) {
  const parentLink = links.find(l => l.to === nodeId);
  if (parentLink) addChildNode(parentLink.from);
  else addChildNode(nodeId);
}

/* =========================================================
   Duplicar
   ========================================================= */
function duplicateSelection() {
  let src = null, arr = null;
  if (selection.type === 'node') { src = liveNode(selection.id); arr = nodes; }
  else if (selection.type === 'doodle') { src = liveDoodle(selection.id); arr = doodles; }
  else if (selection.type === 'image') { src = liveImage(selection.id); arr = images; }
  if (!src) return;
  const before = snapshot();
  const id = genId();
  arr.push({ ...JSON.parse(JSON.stringify(src)), id, x: src.x + 30, y: src.y + 30 });
  commitIfChanged(before);
  saveLocal();
  selection = { type: selection.type, id };
  render();
}

/* =========================================================
   Auto-organizar (layout radial)
   ========================================================= */
function autoLayout() {
  if (!nodes.length) return;
  const before = snapshot();
  const graph = computeGraph();
  const { adj, inDegree, byId } = graph;
  const roots = nodes.filter(n => inDegree[n.id] === 0).map(n => n.id);
  if (!roots.length) return;

  const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
  const levelRadius = 260;

  function subtreeSize(id, seen) {
    if (seen.has(id)) return 0;
    seen.add(id);
    let size = 1;
    (adj[id] || []).forEach(c => size += subtreeSize(c, seen));
    return size;
  }

  function place(id, angleStart, angleEnd, depth, seen) {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId[id];
    if (depth === 0) {
      node.x = center.x - node.w / 2;
      node.y = center.y - node.h / 2;
    } else {
      const angle = (angleStart + angleEnd) / 2;
      const r = levelRadius * depth;
      node.x = center.x + Math.cos(angle) * r - node.w / 2;
      node.y = center.y + Math.sin(angle) * r - node.h / 2;
    }
    const children = (adj[id] || []).filter(c => !seen.has(c));
    if (!children.length) return;
    const sizes = children.map(c => subtreeSize(c, new Set(seen)));
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    let a = angleStart;
    children.forEach((c, i) => {
      const span = (angleEnd - angleStart) * (sizes[i] / total);
      place(c, a, a + span, depth + 1, seen);
      a += span;
    });
  }

  const seen = new Set();
  const rootDepth = roots.length > 1 ? 1 : 0;
  const rootSizes = roots.map(r => subtreeSize(r, new Set()));
  const totalAll = rootSizes.reduce((a, b) => a + b, 0) || 1;
  let cursor = -Math.PI / 2;
  roots.forEach((r, i) => {
    const span = 2 * Math.PI * (rootSizes[i] / totalAll);
    place(r, cursor, cursor + span, rootDepth, seen);
    cursor += span;
  });

  commitIfChanged(before);
  saveLocal();
  render();
}

/* =========================================================
   Borrar selección
   ========================================================= */
function deleteSelection() {
  if (!selection.type) return;
  const before = snapshot();
  if (selection.type === 'node') {
    nodes = nodes.filter(n => n.id !== selection.id);
    links = links.filter(l => l.from !== selection.id && l.to !== selection.id);
  } else if (selection.type === 'link') {
    links = links.filter(l => l.id !== selection.id);
  } else if (selection.type === 'doodle') {
    doodles = doodles.filter(d => d.id !== selection.id);
  } else if (selection.type === 'image') {
    images = images.filter(i => i.id !== selection.id);
  }
  selection = { type: null, id: null };
  commitIfChanged(before);
  saveLocal();
  render();
}

/* =========================================================
   Deshacer
   ========================================================= */
function undo() {
  if (!historyStack.length) return;
  const prev = JSON.parse(historyStack.pop());
  nodes = prev.nodes || [];
  links = prev.links || [];
  strokes = prev.strokes || [];
  doodles = prev.doodles || [];
  images = prev.images || [];
  selection = { type: null, id: null };
  editingNodeId = null;
  saveLocal();
  render();
}

/* =========================================================
   Dibujo a mano alzada — estabilizador y autoajuste
   ========================================================= */

/* Geometría auxiliar */
function segDist2(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p[0] - (a[0] + t * abx), dy = p[1] - (a[1] + t * aby);
  return dx * dx + dy * dy;
}

// Simplificación Ramer-Douglas-Peucker
function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  const eps2 = epsilon * epsilon;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = 0, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist2(points[i], points[i0], points[i1]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps2 && maxI > 0) {
      keep[maxI] = true;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return L;
}

function shoelaceArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

/* Reconocimiento de figuras: devuelve null (dejar a mano alzada),
   {type:'line'} (enderezar) o {type:'doodle', kind, x, y, w, h}. */
function recognizeStroke(pts) {
  if (pts.length < 6) return null;
  const L = pathLength(pts);
  if (L < 60) return null;

  const first = pts[0], last = pts[pts.length - 1];

  // ¿Casi recto? → enderezar conservando el pincel
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, segDist2(p, first, last));
  if (Math.sqrt(maxDev) < Math.max(6, L * 0.04)) return { type: 'line' };

  // ¿Trazo cerrado? → intentar círculo/rectángulo/triángulo
  const dEnds = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (dEnds > Math.max(35, L * 0.22)) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  });
  const w = maxX - minX, h = maxY - minY;
  if (w < 18 || h < 18) return null;

  const areaRatio = shoelaceArea(pts) / (w * h);
  const corners = rdp(pts, Math.max(9, L * 0.045));
  const nCorners = Math.max(2, corners.length - 2); // sin contar extremos duplicados

  // Circularidad: radios normalizados al bbox ≈ 1 con poca dispersión
  const cx = minX + w / 2, cy = minY + h / 2;
  const radii = pts.map(p => Math.hypot((p[0] - cx) / (w / 2), (p[1] - cy) / (h / 2)));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const std = Math.sqrt(radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length);

  const base = { type: 'doodle', x: r1(minX), y: r1(minY), w: r1(w), h: r1(h) };
  // Elipse: radio normalizado ≈ 1 con poca dispersión. Ojo: normalizado al
  // bbox, TODO rectángulo se comporta como un cuadrado, cuyo radio medio
  // teórico es ln(tan 67.5°)/(π/4) ≈ 1.12 y su relación de áreas ≈ 0.95;
  // por eso la elipse exige media < 1.06 y área < 0.88 (círculo: media ≈ 1,
  // área ≈ π/4 ≈ 0.785).
  if (std / mean < 0.13 && mean > 0.90 && mean < 1.06 && areaRatio > 0.55 && areaRatio < 0.88) return { ...base, kind: 'ellipse' };
  if (areaRatio > 0.82 && nCorners <= 6) return { ...base, kind: 'rect' };
  if (areaRatio >= 0.32 && areaRatio <= 0.62 && nCorners <= 5) return { ...base, kind: 'triangle' };
  return null;
}

function startStroke(e) {
  e.preventDefault();
  const before = snapshot();
  const p0 = screenToWorld(e.clientX, e.clientY);
  const pts = [[r1(p0.x), r1(p0.y)]];
  const cfg = BRUSHES[currentBrush];
  const color = resolveColor(currentColor);

  // Estabilizador en dos etapas: "cuerda" (la pluma persigue al cursor y solo
  // avanza cuando éste sale del radio) + media móvil exponencial para amortiguar
  // también los saltos bruscos que la cuerda deja pasar.
  const pen = [p0.x, p0.y];
  const smooth = [p0.x, p0.y];
  const stabRadius = stabilizerOn ? 8 / view.zoom : 0;
  const emaAlpha = stabilizerOn ? 0.35 : 1;
  const minStep = 1.4 / view.zoom;

  let temp;
  if (currentBrush === 'spray') {
    temp = document.createElementNS(svgNS, 'g');
    buildSprayDots(pts, color, temp);
  } else {
    temp = document.createElementNS(svgNS, 'path');
    temp.setAttribute('stroke', color);
    temp.setAttribute('stroke-width', cfg.width);
    temp.setAttribute('stroke-linecap', cfg.cap || 'round');
    temp.setAttribute('stroke-linejoin', 'round');
    temp.setAttribute('opacity', cfg.opacity);
    if (cfg.dash) temp.setAttribute('stroke-dasharray', cfg.dash);
    temp.setAttribute('fill', 'none');
  }
  drawingsLayer.appendChild(temp);

  function onMove(ev) {
    const c = screenToWorld(ev.clientX, ev.clientY);
    const dx = c.x - pen[0], dy = c.y - pen[1];
    const dist = Math.hypot(dx, dy);
    if (dist <= stabRadius) return;
    const pull = stabRadius ? (dist - stabRadius) / dist : 1;
    pen[0] += dx * pull;
    pen[1] += dy * pull;
    smooth[0] += (pen[0] - smooth[0]) * emaAlpha;
    smooth[1] += (pen[1] - smooth[1]) * emaAlpha;

    const lastPt = pts[pts.length - 1];
    if (Math.hypot(smooth[0] - lastPt[0], smooth[1] - lastPt[1]) < minStep) return;
    pts.push([r1(smooth[0]), r1(smooth[1])]);
    if (currentBrush === 'spray') {
      buildSprayDots([pts[pts.length - 1]], color, temp);
    } else {
      temp.setAttribute('d', strokePathD(pts));
    }
  }
  function onUp() {
    temp.remove();
    if (pts.length > 1) {
      const canSnap = autoShapeOn && currentBrush !== 'spray';
      const rec = canSnap ? recognizeStroke(pts) : null;

      if (rec && rec.type === 'doodle' && currentBrush !== 'highlighter') {
        doodles.push({ id: genId(), kind: rec.kind, x: rec.x, y: rec.y, w: rec.w, h: rec.h, color: currentColor, filled: false });
      } else if (rec && rec.type === 'line') {
        strokes.push({ id: genId(), brush: currentBrush, color: currentColor, points: [pts[0], pts[pts.length - 1]] });
      } else {
        // Autoajuste suave: simplificar puntos para un trazo más limpio y liviano
        const finalPts = currentBrush === 'spray' ? pts : rdp(pts, 1.1);
        strokes.push({ id: genId(), brush: currentBrush, color: currentColor, points: finalPts });
      }
      commitIfChanged(before);
      saveLocal();
    }
    render();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* =========================================================
   Figuras arrastradas (círculo, cuadrado, etc.)
   ========================================================= */
function startFigureDrag(e) {
  e.preventDefault();
  const before = snapshot();
  const p0 = screenToWorld(e.clientX, e.clientY);
  let ghost = null;

  function ghostDoodle(p) {
    return {
      id: '_ghost', kind: currentFigure,
      x: r1(p0.x), y: r1(p0.y),
      w: r1(p.x - p0.x), h: r1(p.y - p0.y),
      color: currentColor, filled: figureFilled
    };
  }

  function onMove(ev) {
    const p = screenToWorld(ev.clientX, ev.clientY);
    if (ghost) ghost.remove();
    ghost = buildDoodleEl(ghostDoodle(p));
    ghost.setAttribute('opacity', '0.6');
    drawingsLayer.appendChild(ghost);
  }
  function onUp(ev) {
    if (ghost) ghost.remove();
    const p = screenToWorld(ev.clientX, ev.clientY);
    const d = ghostDoodle(p);
    if (Math.abs(d.w) > 8 || Math.abs(d.h) > 8) {
      d.id = genId();
      // Normalizar dimensiones salvo en líneas/flechas (dirección importa)
      if (d.kind !== 'line' && d.kind !== 'arrow') {
        if (d.w < 0) { d.x += d.w; d.w = -d.w; }
        if (d.h < 0) { d.y += d.h; d.h = -d.h; }
      }
      doodles.push(d);
      commitIfChanged(before);
      saveLocal();
    }
    render();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* =========================================================
   Borrador (trazos y figuras)
   ========================================================= */
function eraseAt(p) {
  const rad = 14 / view.zoom;
  const rad2 = rad * rad;
  let changed = false;
  strokes = strokes.filter(s => {
    const hit = s.points.some(pt => {
      const dx = pt[0] - p.x, dy = pt[1] - p.y;
      return dx * dx + dy * dy < rad2;
    });
    if (hit) changed = true;
    return !hit;
  });
  doodles = doodles.filter(d => {
    const b = doodleBBox(d);
    const hit = p.x > b.x - rad && p.x < b.x + b.w + rad && p.y > b.y - rad && p.y < b.y + b.h + rad;
    if (hit) changed = true;
    return !hit;
  });
  return changed;
}

function startErase(e) {
  e.preventDefault();
  const before = snapshot();
  let any = eraseAt(screenToWorld(e.clientX, e.clientY));
  if (any) render();

  function onMove(ev) {
    if (eraseAt(screenToWorld(ev.clientX, ev.clientY))) { any = true; render(); }
  }
  function onUp() {
    if (any) { commitIfChanged(before); saveLocal(); }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/* =========================================================
   Pegar imágenes (PNG con alfa, GIF animado, etc.)
   ========================================================= */
function addPastedImage(dataUrl, mime) {
  const probe = new Image();
  probe.onload = () => {
    const isGif = mime === 'image/gif';
    let finalUrl = dataUrl;
    let nw = probe.naturalWidth || 300, nh = probe.naturalHeight || 300;

    // Reducir imágenes estáticas enormes para no reventar localStorage.
    // PNG conserva el canal alfa; los GIF nunca se re-codifican (perderían
    // la animación).
    if (!isGif && Math.max(nw, nh) > 1600) {
      const scale = 1600 / Math.max(nw, nh);
      const c = document.createElement('canvas');
      c.width = Math.round(nw * scale);
      c.height = Math.round(nh * scale);
      c.getContext('2d').drawImage(probe, 0, 0, c.width, c.height);
      finalUrl = c.toDataURL('image/png');
      nw = c.width; nh = c.height;
    }

    const before = snapshot();
    const maxDim = 460;
    const s = Math.min(1, maxDim / Math.max(nw, nh));
    const w = r1(nw * s), h = r1(nh * s);
    const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const id = genId();
    images.push({
      id,
      x: r1(center.x - w / 2 + Math.random() * 40 - 20),
      y: r1(center.y - h / 2 + Math.random() * 40 - 20),
      w, h,
      dataUrl: finalUrl,
      isGif,
      playing: isGif
    });
    commitIfChanged(before);
    saveLocal();
    selection = { type: 'image', id };
    render();
  };
  probe.src = dataUrl;
}

function initPaste() {
  window.addEventListener('paste', e => {
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const items = (e.clipboardData || {}).items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => addPastedImage(reader.result, item.type);
        reader.readAsDataURL(file);
        e.preventDefault();
        return;
      }
    }
  });
}

/* =========================================================
   Buscador
   ========================================================= */
function expandAncestors(nodeId) {
  let changed = false;
  let current = nodeId;
  const guard = new Set();
  while (true) {
    const parentLink = links.find(l => l.to === current);
    if (!parentLink || guard.has(parentLink.from)) break;
    guard.add(parentLink.from);
    const parent = liveNode(parentLink.from);
    if (parent && parent.collapsed) { parent.collapsed = false; changed = true; }
    current = parentLink.from;
  }
  return changed;
}

function focusOnNodeId(nodeId) {
  const node = liveNode(nodeId);
  if (!node) return;
  view.zoom = Math.max(view.zoom, 1);
  view.x = window.innerWidth / 2 - (node.x + node.w / 2) * view.zoom;
  view.y = window.innerHeight / 2 - (node.y + node.h / 2) * view.zoom;
  applyView();
}

function updateSearchUI() {
  document.getElementById('search-count').textContent =
    searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : '0/0';
}

function runSearch(query) {
  query = query.trim().toLowerCase();
  searchMatches = query ? nodes.filter(n => (n.text || '').toLowerCase().includes(query)).map(n => n.id) : [];
  searchIndex = searchMatches.length ? 0 : -1;
  updateSearchUI();
  if (searchIndex >= 0) {
    if (expandAncestors(searchMatches[searchIndex])) saveLocal();
    focusOnNodeId(searchMatches[searchIndex]);
  }
  render();
}

function searchStep(dir) {
  if (!searchMatches.length) return;
  searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
  updateSearchUI();
  if (expandAncestors(searchMatches[searchIndex])) saveLocal();
  focusOnNodeId(searchMatches[searchIndex]);
  render();
}

function openSearch() {
  document.getElementById('search-panel').classList.add('open');
  document.getElementById('search-input').focus();
}

function closeSearch() {
  document.getElementById('search-panel').classList.remove('open');
  document.getElementById('search-input').value = '';
  searchMatches = [];
  searchIndex = -1;
  render();
}

/* =========================================================
   Modo oscuro
   ========================================================= */
function setTheme(name) {
  if (!THEMES[name]) name = 'sketch';
  currentTheme = name;
  document.body.dataset.theme = name;
  localStorage.setItem(THEME_KEY, name);
  document.querySelectorAll('#theme-popover [data-app-theme]').forEach(b =>
    b.classList.toggle('active', b.dataset.appTheme === name));
  render();
}

function loadTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || 'sketch');
}

function toggleDarkMode() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark', isDarkMode);
  document.getElementById('darkmode-btn').innerHTML =
    isDarkMode ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  localStorage.setItem(DARK_KEY, isDarkMode ? '1' : '0');
  render();
}

/* =========================================================
   Exportar a PNG
   (El texto va como <text>/<tspan> nativo; foreignObject mancha
   el canvas en Chromium y bloquearía toBlob.)
   ========================================================= */
function measureCtx() {
  if (!measureCtx._ctx) measureCtx._ctx = document.createElement('canvas').getContext('2d');
  return measureCtx._ctx;
}

function wrapLinesForExport(ctx, text, maxWidth) {
  const lines = [];
  (text || '').split('\n').forEach(paragraph => {
    const words = paragraph.split(' ');
    let current = '';
    words.forEach(word => {
      const test = current ? current + ' ' + word : word;
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    lines.push(current);
  });
  return lines;
}

function fitExportText(node) {
  const ctx = measureCtx();
  const padding = 12;
  const maxW = Math.max(10, node.w - padding * 2);
  const maxH = Math.max(10, node.h - padding * 2);
  const minFont = 8;
  let fontSize = 30;
  let lines = [node.text || ''];
  const t = themeCfg();
  for (; fontSize > minFont; fontSize--) {
    ctx.font = `${t.weight} ${fontSize}px ${t.font}`;
    lines = wrapLinesForExport(ctx, node.text, maxW);
    const lineHeight = fontSize * 1.18;
    const totalH = lines.length * lineHeight;
    const maxLineW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    if (totalH <= maxH && maxLineW <= maxW) break;
  }
  return { fontSize, lines };
}

async function exportPNG() {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* continúa igual */ }
  }

  const W = window.innerWidth, H = window.innerHeight;
  const bgColor = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#faf6ec';
  const clone = svgCanvas.cloneNode(true);
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  clone.setAttribute('xmlns', svgNS);

  // Los overlays de GIF animado (foreignObject) manchan el canvas;
  // se eliminan y queda el <image> de abajo con el primer frame.
  clone.querySelectorAll('foreignObject').forEach(fo => fo.remove());

  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%');
  bg.setAttribute('fill', bgColor);
  clone.insertBefore(bg, clone.firstChild);

  const worldClone = clone.querySelector('#world') || clone;

  visibleNodeList().forEach(node => {
    const { fontSize, lines } = fitExportText(node);
    const lineHeight = fontSize * 1.18;
    const totalH = lines.length * lineHeight;
    const cx = node.x + node.w / 2;
    const firstBaseline = node.y + node.h / 2 - totalH / 2 + fontSize * 0.85;

    const textEl = document.createElementNS(svgNS, 'text');
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('font-family', themeCfg().font);
    textEl.setAttribute('font-weight', themeCfg().weight);
    textEl.setAttribute('font-size', fontSize);
    textEl.setAttribute('fill', resolveColor(node.color));
    lines.forEach((line, i) => {
      const tspan = document.createElementNS(svgNS, 'tspan');
      tspan.setAttribute('x', cx);
      tspan.setAttribute('y', firstBaseline + i * lineHeight);
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });
    worldClone.appendChild(textEl);
  });

  const svgData = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.getElementById('export-canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(url);
    canvas.toBlob(blob2 => {
      const a = document.createElement('a');
      a.download = 'pizarra-' + viewDayKey + '.png';
      a.href = URL.createObjectURL(blob2);
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.onerror = () => { alert('No se pudo exportar la imagen.'); URL.revokeObjectURL(url); };
  img.src = url;
}

/* =========================================================
   Dock — interacción
   ========================================================= */
const PAINT_TOOLS = ['draw', 'shape', 'erase'];

function setTool(tool) {
  currentTool = tool;
  linkSourceId = null;
  document.querySelectorAll('.dock [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  document.body.classList.toggle('mode-paint', PAINT_TOOLS.includes(tool));
  const cursors = { 'add-link': 'crosshair', draw: 'crosshair', shape: 'crosshair', erase: 'cell' };
  svgCanvas.style.cursor = cursors[tool] || 'grab';
  render();
}

function closePopovers() {
  document.querySelectorAll('.popover').forEach(p => {
    if (p.id !== 'search-panel') p.classList.remove('open');
  });
}

function togglePopover(pop) {
  const willOpen = !pop.classList.contains('open');
  closePopovers();
  if (willOpen) pop.classList.add('open');
}

function initDock() {
  document.querySelectorAll('.dock [data-tool]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tool = btn.dataset.tool;
      if (tool === 'draw') {
        togglePopover(document.getElementById('brush-popover'));
      } else if (tool === 'shape') {
        togglePopover(document.getElementById('figure-popover'));
      } else {
        closePopovers();
      }
      setTool(tool);
    });
  });

  const shapePop = document.getElementById('shape-popover');
  document.getElementById('add-node-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePopover(shapePop);
  });
  shapePop.querySelectorAll('[data-shape]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closePopovers();
      addNode(btn.dataset.shape);
    });
  });

  // Pinceles
  const brushPop = document.getElementById('brush-popover');
  brushPop.querySelectorAll('[data-brush]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      currentBrush = btn.dataset.brush;
      brushPop.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('active', b === btn));
      setTool('draw');
      closePopovers();
    });
  });

  // Estabilizador y autoajuste del trazo
  const stabBtn = document.getElementById('stabilizer-toggle');
  const autoBtn = document.getElementById('autoshape-toggle');
  stabBtn.addEventListener('click', e => {
    e.stopPropagation();
    stabilizerOn = !stabilizerOn;
    stabBtn.classList.toggle('on', stabilizerOn);
    localStorage.setItem(STAB_KEY, stabilizerOn ? '1' : '0');
  });
  autoBtn.addEventListener('click', e => {
    e.stopPropagation();
    autoShapeOn = !autoShapeOn;
    autoBtn.classList.toggle('on', autoShapeOn);
    localStorage.setItem(AUTOSHAPE_KEY, autoShapeOn ? '1' : '0');
  });

  // Figuras + relleno
  const figurePop = document.getElementById('figure-popover');
  figurePop.querySelectorAll('[data-figure]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      currentFigure = btn.dataset.figure;
      figurePop.querySelectorAll('[data-figure]').forEach(b => b.classList.toggle('active', b === btn));
      setTool('shape');
      closePopovers();
    });
  });
  document.getElementById('fill-toggle').addEventListener('click', e => {
    e.stopPropagation();
    figureFilled = !figureFilled;
    document.getElementById('fill-toggle').classList.toggle('active', figureFilled);
  });

  // Colores
  const colorPop = document.getElementById('color-popover');
  const colorDot = document.getElementById('color-dot');
  document.getElementById('color-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePopover(colorPop);
  });
  colorPop.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const color = btn.dataset.color;
      currentColor = color;
      colorDot.style.background = color;
      if (selection.type === 'node' || selection.type === 'doodle') {
        const before = snapshot();
        const obj = selection.type === 'node' ? liveNode(selection.id) : liveDoodle(selection.id);
        if (obj) obj.color = color;
        commitIfChanged(before); saveLocal();
      } else if (selection.type === 'link') {
        const before = snapshot();
        const link = links.find(l => l.id === selection.id);
        if (link) link.color = color;
        commitIfChanged(before); saveLocal();
      }
      closePopovers();
      render();
    });
  });

  // Etiquetas
  const tagPop = document.getElementById('tag-popover');
  document.getElementById('tag-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePopover(tagPop);
  });
  tagPop.querySelectorAll('[data-icon]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (selection.type === 'node') {
        const before = snapshot();
        const node = liveNode(selection.id);
        if (node) node.icon = btn.dataset.icon;
        commitIfChanged(before);
        saveLocal();
      }
      closePopovers();
      render();
    });
  });

  // Calendario
  document.getElementById('calendar-btn').addEventListener('click', e => {
    e.stopPropagation();
    const pop = document.getElementById('calendar-popover');
    const willOpen = !pop.classList.contains('open');
    closePopovers();
    if (willOpen) {
      const p = parseDayKey(viewDayKey);
      calYear = p.y; calMonth = p.m;
      renderCalendar();
      pop.classList.add('open');
    }
  });
  document.getElementById('day-chip-today').addEventListener('click', e => {
    e.stopPropagation();
    switchDay(todayKey());
  });

  document.getElementById('edit-btn').addEventListener('click', e => {
    e.stopPropagation();
    if (selection.type === 'node') startEditing(selection.id, false);
  });
  document.getElementById('duplicate-btn').addEventListener('click', e => {
    e.stopPropagation();
    duplicateSelection();
  });
  document.getElementById('organize-btn').addEventListener('click', e => {
    e.stopPropagation();
    autoLayout();
  });
  document.getElementById('darkmode-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleDarkMode();
  });

  // Temas visuales
  const themePop = document.getElementById('theme-popover');
  document.getElementById('theme-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePopover(themePop);
  });
  themePop.querySelectorAll('[data-app-theme]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      setTheme(btn.dataset.appTheme);
      closePopovers();
    });
  });
  document.getElementById('search-btn').addEventListener('click', e => {
    e.stopPropagation();
    const panel = document.getElementById('search-panel');
    if (panel.classList.contains('open')) closeSearch(); else openSearch();
  });

  document.getElementById('undo-btn').addEventListener('click', e => { e.stopPropagation(); undo(); });
  document.getElementById('delete-btn').addEventListener('click', e => { e.stopPropagation(); deleteSelection(); });
  document.getElementById('export-btn').addEventListener('click', e => { e.stopPropagation(); exportPNG(); });

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); searchStep(1); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  document.getElementById('search-prev').addEventListener('click', e => { e.stopPropagation(); searchStep(-1); });
  document.getElementById('search-next').addEventListener('click', e => { e.stopPropagation(); searchStep(1); });
  document.getElementById('search-close').addEventListener('click', e => { e.stopPropagation(); closeSearch(); });

  zoomIndicator.addEventListener('click', e => { e.stopPropagation(); resetView(); });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.dock-group')) closePopovers();
  });
}

/* =========================================================
   Eventos globales — lienzo (pan, zoom, dibujo)
   ========================================================= */
function initCanvasEvents() {
  svgCanvas.addEventListener('pointerdown', e => {
    if (e.button === 1) { startPan(e); return; }
    if (currentTool === 'draw') { startStroke(e); return; }
    if (currentTool === 'shape') { startFigureDrag(e); return; }
    if (currentTool === 'erase') { startErase(e); return; }
    const isBackground = e.target === svgCanvas;
    if (isBackground && currentTool === 'select') startPan(e);
    else if (isBackground && currentTool === 'add-link') deselect();
  });

  function startPan(e) {
    e.preventDefault();
    panState = { startX: e.clientX, startY: e.clientY, startViewX: view.x, startViewY: view.y, moved: false };
    svgCanvas.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanUp);
  }
  function onPanMove(e) {
    if (!panState) return;
    const dx = e.clientX - panState.startX, dy = e.clientY - panState.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panState.moved = true;
    view.x = panState.startViewX + dx;
    view.y = panState.startViewY + dy;
    applyView();
  }
  function onPanUp() {
    if (panState && !panState.moved) deselect();
    panState = null;
    const cursors = { 'add-link': 'crosshair', draw: 'crosshair', shape: 'crosshair', erase: 'cell' };
    svgCanvas.style.cursor = cursors[currentTool] || 'grab';
    window.removeEventListener('pointermove', onPanMove);
    window.removeEventListener('pointerup', onPanUp);
  }

  svgCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const newZoom = Math.min(2.5, Math.max(0.2, view.zoom * factor));
    const rect = svgCanvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    view.x = cx - (cx - view.x) * (newZoom / view.zoom);
    view.y = cy - (cy - view.y) * (newZoom / view.zoom);
    view.zoom = newZoom;
    applyView();
  }, { passive: false });

  window.addEventListener('resize', () => {
    svgCanvas.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    render();
  });

  window.addEventListener('keydown', e => {
    const active = document.activeElement;
    const isEditable = active && active.isContentEditable;
    const isTyping = isEditable || (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !isTyping) { e.preventDefault(); duplicateSelection(); return; }

    if (isTyping) return;

    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Tab' && selection.type === 'node') { e.preventDefault(); addChildNode(selection.id); return; }
    if (e.key === 'Enter' && selection.type === 'node') { e.preventDefault(); addSiblingNode(selection.id); return; }
    if (e.key === 'Escape') { linkSourceId = null; closeSearch(); setTool('select'); }
  });
}

/* =========================================================
   Onboarding
   ========================================================= */
function initOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (localStorage.getItem(ONBOARD_KEY)) {
    overlay.classList.add('hidden');
    return;
  }
  let step = 0;
  const steps = document.querySelectorAll('.onboarding-step');
  const dots = document.querySelectorAll('.onboarding-dots .dot');
  const nextBtn = document.getElementById('onboarding-next');
  const skipBtn = document.getElementById('onboarding-skip');

  function show(i) {
    steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
    dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
    nextBtn.textContent = i === steps.length - 1 ? 'Empezar' : 'Siguiente';
  }
  function close() {
    localStorage.setItem(ONBOARD_KEY, '1');
    overlay.classList.add('hidden');
  }
  nextBtn.addEventListener('click', () => {
    if (step < steps.length - 1) { step++; show(step); }
    else close();
  });
  skipBtn.addEventListener('click', close);
  show(0);
}

/* =========================================================
   Arranque
   ========================================================= */
function init() {
  svgCanvas.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  loadBoard(viewDayKey);
  loadView();
  loadDarkMode();
  loadTheme();
  loadDrawPrefs();
  initDock();
  initCanvasEvents();
  initPaste();
  initOnboarding();
  updateDayChip();
  setTool('select');
  applyView();
  render();
}

init();
