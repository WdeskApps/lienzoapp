/* =========================================================
   LienzoApp — Tu espacio infinito para pensar, dibujar y crear
   (pizarrón diario de mapas mentales y doodles)
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
let pinchActive = false;   // gesto de dos dedos en curso (móvil/tablet)

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
    sketchy: false, flat: true, cornerRadius: 22,
    nodeStroke: 0, doodleStroke: 2.2,
    font: "'Quicksand', 'Segoe UI', sans-serif", weight: 700,
    darkInk: '#ececf4',
    nodeFill: '#ffffff', nodeFillDark: '#26262e',
    accentFill: '#ececf2', accentFillDark: '#1b1b22',
    flatOpacity: 0.16, flatOpacityDark: 0.3
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
      const clean = sanitizeBoard(JSON.parse(raw));
      if (clean) {
        nodes = clean.nodes;
        links = clean.links;
        strokes = clean.strokes;
        doodles = clean.doodles;
        images = clean.images;
      }
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

/* Pequeña "foto" generada en canvas para mostrar que se pueden pegar
   imágenes, sin cargar ningún archivo externo. */
function seedDemoImage() {
  const c = document.createElement('canvas');
  c.width = 220; c.height = 150;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 150);
  g.addColorStop(0, '#aee3f5'); g.addColorStop(1, '#eaf7fb');
  x.fillStyle = g; x.fillRect(0, 0, 220, 150);
  x.fillStyle = '#f7c548'; x.beginPath(); x.arc(168, 42, 24, 0, 7); x.fill();
  x.fillStyle = '#7fb069'; x.beginPath();
  x.moveTo(0, 150); x.lineTo(64, 66); x.lineTo(136, 150); x.closePath(); x.fill();
  x.fillStyle = '#5e8c4a'; x.beginPath();
  x.moveTo(84, 150); x.lineTo(162, 84); x.lineTo(220, 150); x.closePath(); x.fill();
  return c.toDataURL('image/jpeg', 0.85);
}

/* Mapa demo: plan de ordenamiento de una organización genérica,
   decorado con iconos, notas, trazos e imagen para mostrar de un
   vistazo lo que se puede hacer. */
function seedExample() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  // El demo se ve mejor con el tema Profesional; solo si el visitante
  // aún no ha elegido uno propio.
  if (!localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, 'pro');

  nodes = [
    { id: 'n1',  x: cx - 110, y: cy - 60,  w: 220, h: 110, shape: 'cloud',     text: 'Plan Anual 2026',             color: '#2b2b2b', icon: '⭐', collapsed: false },

    { id: 'n2',  x: cx - 500, y: cy - 260, w: 185, h: 85,  shape: 'rect',      text: '🗂️ Procesos internos',        color: '#1d4ed8', icon: '',   collapsed: false },
    { id: 'n3',  x: cx - 590, y: cy - 120, w: 190, h: 75,  shape: 'rect',      text: 'Ordenar la documentación',    color: '#1d4ed8', icon: '',   collapsed: false },
    { id: 'n4',  x: cx - 360, y: cy - 125, w: 190, h: 75,  shape: 'rect',      text: 'Simplificar aprobaciones',    color: '#1d4ed8', icon: '',   collapsed: false },

    { id: 'n5',  x: cx + 250, y: cy - 270, w: 195, h: 95,  shape: 'hexagon',   text: '🎯 Metas y objetivos',        color: '#16a34a', icon: '',   collapsed: false },
    { id: 'n6',  x: cx + 470, y: cy - 160, w: 160, h: 75,  shape: 'rect',      text: 'Metas trimestrales',          color: '#16a34a', icon: '🚩', collapsed: false },
    { id: 'n7',  x: cx + 220, y: cy - 130, w: 200, h: 75,  shape: 'rect',      text: 'Indicadores de avance',       color: '#16a34a', icon: '',   collapsed: false },

    { id: 'n8',  x: cx + 380, y: cy + 30,  w: 200, h: 100, shape: 'cloud',     text: '💼 Ideas de negocio',         color: '#ca8a04', icon: '',   collapsed: false },
    { id: 'n9',  x: cx + 400, y: cy + 180, w: 195, h: 75,  shape: 'rect',      text: 'Encuestas de satisfacción',   color: '#ca8a04', icon: '',   collapsed: false },

    { id: 'n10', x: cx + 30,  y: cy + 180, w: 190, h: 90,  shape: 'clipboard', text: '📊 Finanzas',                 color: '#2b2b2b', icon: '',   collapsed: false },
    { id: 'n11', x: cx + 90,  y: cy + 320, w: 180, h: 70,  shape: 'rect',      text: 'Control de gastos',           color: '#2b2b2b', icon: '✅', collapsed: false },

    { id: 'n12', x: cx - 420, y: cy + 70,  w: 185, h: 100, shape: 'circle',    text: '🤝 Personas y equipo',        color: '#dc2626', icon: '',   collapsed: false },
    { id: 'n13', x: cx - 550, y: cy + 230, w: 165, h: 75,  shape: 'circle',    text: 'Actividades de integración',  color: '#dc2626', icon: '❗', collapsed: false },

    { id: 'n14', x: cx - 230, y: cy + 280, w: 195, h: 90,  shape: 'sticky',    text: '💡 Automatizar tareas repetitivas', color: '#16a34a', icon: '', collapsed: false },
    { id: 'n15', x: cx + 350, y: cy + 300, w: 195, h: 85,  shape: 'sticky',    text: '📸 Pega imágenes con Ctrl+V', color: '#ca8a04', icon: '',  collapsed: false }
  ];
  links = [
    { id: 'l1',  from: 'n1',  to: 'n2',  color: '#1d4ed8' },
    { id: 'l2',  from: 'n2',  to: 'n3',  color: '#1d4ed8' },
    { id: 'l3',  from: 'n2',  to: 'n4',  color: '#1d4ed8' },
    { id: 'l4',  from: 'n1',  to: 'n5',  color: '#16a34a' },
    { id: 'l5',  from: 'n5',  to: 'n6',  color: '#16a34a' },
    { id: 'l6',  from: 'n5',  to: 'n7',  color: '#16a34a' },
    { id: 'l7',  from: 'n1',  to: 'n8',  color: '#ca8a04' },
    { id: 'l8',  from: 'n8',  to: 'n9',  color: '#ca8a04' },
    { id: 'l9',  from: 'n1',  to: 'n10', color: '#2b2b2b' },
    { id: 'l10', from: 'n10', to: 'n11', color: '#2b2b2b' },
    { id: 'l11', from: 'n1',  to: 'n12', color: '#dc2626' },
    { id: 'l12', from: 'n12', to: 'n13', color: '#dc2626' }
  ];

  // Escena: persona presentando en un pizarrón (abajo a la izquierda)
  const bx = cx - 660, by = cy + 340;   // pizarrón de la presentación
  const px = bx + 215;                  // persona (figura de palitos)
  // Escena: monitor + mouse (arriba a la izquierda)
  const mx = cx - 700, my = cy - 340;
  // Gráfico de torta a mano (junto a Finanzas)
  const gx = cx + 235, gy = cy + 230, gc = gx + 47, gyc = gy + 47;

  strokes = [
    { id: 's1', brush: 'marker', color: '#ca8a04',
      points: [[cx - 95, cy + 62], [cx - 40, cy + 70], [cx + 25, cy + 60], [cx + 95, cy + 68]] },
    { id: 's2', brush: 'highlighter', color: '#ca8a04',
      points: [[cx + 95, cy + 355], [cx + 265, cy + 355]] },
    // contenido del pizarrón de la presentación
    { id: 's3', brush: 'pencil', color: '#2b2b2b', points: [[bx + 20, by + 25], [bx + 95, by + 25]] },
    { id: 's4', brush: 'pencil', color: '#2b2b2b', points: [[bx + 20, by + 45], [bx + 120, by + 45]] },
    { id: 's5', brush: 'pencil', color: '#2b2b2b', points: [[bx + 20, by + 65], [bx + 80, by + 65]] },
    // persona: cuerpo, brazo que apunta, otro brazo y piernas
    { id: 's6', brush: 'pencil', color: '#2b2b2b', points: [[px, by + 21], [px, by + 65]] },
    { id: 's7', brush: 'pencil', color: '#2b2b2b', points: [[px, by + 32], [px - 45, by + 18]] },
    { id: 's8', brush: 'pencil', color: '#2b2b2b', points: [[px, by + 35], [px + 18, by + 50]] },
    { id: 's9', brush: 'pencil', color: '#2b2b2b', points: [[px, by + 65], [px - 14, by + 95]] },
    { id: 's10', brush: 'pencil', color: '#2b2b2b', points: [[px, by + 65], [px + 14, by + 95]] },
    // pantalla del monitor: una curva tipo gráfico de líneas
    { id: 's11', brush: 'pencil', color: '#1d4ed8',
      points: [[mx + 18, my + 55], [mx + 45, my + 30], [mx + 70, my + 48], [mx + 105, my + 22]] },
    // cable del mouse
    { id: 's12', brush: 'pencil', color: '#2b2b2b',
      points: [[mx + 175, my + 52], [mx + 168, my + 28], [mx + 140, my + 12]] },
    // porción destacada de la torta
    { id: 's13', brush: 'highlighter', color: '#ca8a04', points: [[gc + 8, gyc - 18], [gc + 26, gyc - 4]] }
  ];

  doodles = [
    { id: 'dd1', kind: 'ellipse', x: cx + 445, y: cy - 185, w: 210, h: 120, color: '#dc2626', filled: false },
    { id: 'dd2', kind: 'arrow',   x: cx + 345, y: cy + 350, w: -160, h: 45, color: '#ca8a04', filled: false },
    // presentación: pizarrón con patas + cabeza de la persona
    { id: 'dd3', kind: 'rect',    x: bx, y: by, w: 150, h: 95, color: '#2b2b2b', filled: false },
    { id: 'dd4', kind: 'line',    x: bx + 30,  y: by + 95, w: -15, h: 40, color: '#2b2b2b', filled: false },
    { id: 'dd5', kind: 'line',    x: bx + 120, y: by + 95, w: 15,  h: 40, color: '#2b2b2b', filled: false },
    { id: 'dd6', kind: 'ellipse', x: px - 13, y: by - 5, w: 26, h: 26, color: '#2b2b2b', filled: false },
    // monitor con soporte + mouse
    { id: 'dd7', kind: 'rect',    x: mx, y: my, w: 130, h: 85, color: '#1d4ed8', filled: false },
    { id: 'dd8', kind: 'line',    x: mx + 65, y: my + 85, w: 0, h: 18, color: '#1d4ed8', filled: false },
    { id: 'dd9', kind: 'line',    x: mx + 35, y: my + 103, w: 60, h: 0, color: '#1d4ed8', filled: false },
    { id: 'dd10', kind: 'ellipse', x: mx + 160, y: my + 52, w: 30, h: 42, color: '#2b2b2b', filled: false },
    // gráfico de torta: círculo + tres radios
    { id: 'dd11', kind: 'ellipse', x: gx, y: gy, w: 95, h: 95, color: '#2b2b2b', filled: false },
    { id: 'dd12', kind: 'line',    x: gc, y: gyc, w: 0,   h: -47, color: '#2b2b2b', filled: false },
    { id: 'dd13', kind: 'line',    x: gc, y: gyc, w: 45,  h: 12,  color: '#2b2b2b', filled: false },
    { id: 'dd14', kind: 'line',    x: gc, y: gyc, w: -33, h: 33,  color: '#2b2b2b', filled: false }
  ];

  images = [
    { id: 'im1', x: cx + 130, y: cy + 400, w: 165, h: 112, dataUrl: seedDemoImage(), isGif: false, playing: false }
  ];
  idCounter = 16;
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
  // Tema plano (Minimalista): sin contorno, relleno pastel del color del nodo
  if (t.flat) {
    return {
      stroke: 'none',
      strokeWidth: 0,
      fill: resolveColor(node.color),
      fillOpacity: isDarkMode ? t.flatOpacityDark : t.flatOpacity
    };
  }
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
  // Piezas secundarias (clip del portapapeles, doblez de la nota):
  // en tema plano usan el mismo color más intenso; en el resto, el fill de acento
  const accentOpts = t.flat
    ? { ...opts, fillOpacity: Math.min(1, (opts.fillOpacity || 0.16) * 2) }
    : { ...opts, fill: isDarkMode ? t.accentFillDark : t.accentFill };
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
    el.appendChild(draw.rectangle(clipX, clipY, clipW, clipH, { ...accentOpts, rx: 4 }));
  } else if (node.shape === 'sticky') {
    el = document.createElementNS(svgNS, 'g');
    el.appendChild(draw.rectangle(0, 0, node.w, node.h, { ...opts, rx: 0 }));
    const fold = Math.min(node.w, node.h) * 0.22;
    el.appendChild(draw.polygon([[node.w - fold, 0], [node.w, 0], [node.w, fold]], accentOpts));
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
      // Pegar solo texto plano: evita que HTML enriquecido entre al div editable
      div.addEventListener('paste', e => {
        e.preventDefault();
        const t = (e.clipboardData || window.clipboardData).getData('text/plain');
        if (t) document.execCommand('insertText', false, t);
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
    if (pinchActive) return;
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
    if (pinchActive) return;
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
    if (pinchActive) return;
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
  let abortedByPinch = false;

  function onMove(ev) {
    if (pinchActive) { abortedByPinch = true; return; }
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
    if (abortedByPinch || pinchActive) {
      // El trazo era en realidad el inicio de un gesto de zoom: descartarlo
      render();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      return;
    }
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

  let abortedByPinch = false;
  function onMove(ev) {
    if (pinchActive) { abortedByPinch = true; if (ghost) { ghost.remove(); ghost = null; } return; }
    const p = screenToWorld(ev.clientX, ev.clientY);
    if (ghost) ghost.remove();
    ghost = buildDoodleEl(ghostDoodle(p));
    ghost.setAttribute('opacity', '0.6');
    drawingsLayer.appendChild(ghost);
  }
  function onUp(ev) {
    if (ghost) ghost.remove();
    if (abortedByPinch || pinchActive) {
      render();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      return;
    }
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
    if (pinchActive) return;
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
/* Toda imagen pegada se re-codifica liviana antes de guardarse:
   JPEG para fotos, PNG solo si tiene transparencia, y los GIF
   animados quedan congelados en su primer cuadro (drawImage toma
   el frame inicial). Video y audio no se aceptan. */
const PASTE_MAX_DIM = 1400;
const PASTE_RETRY_DIM = 900;
const PASTE_MAX_BYTES = 1500000; // ~1,5 MB como dataURL

function drawScaled(img, nw, nh, maxDim, whiteBg) {
  const scale = Math.min(1, maxDim / Math.max(nw, nh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(nw * scale));
  c.height = Math.max(1, Math.round(nh * scale));
  const ctx = c.getContext('2d');
  if (whiteBg) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function hasTransparency(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const totalPx = canvas.width * canvas.height;
  const skip = Math.max(1, Math.floor(totalPx / 2000));
  for (let p = 3; p < data.length; p += 4 * skip) {
    if (data[p] < 250) return true;
  }
  return false;
}

function compressImage(img) {
  const nw = img.naturalWidth || 300, nh = img.naturalHeight || 300;
  let c = drawScaled(img, nw, nh, PASTE_MAX_DIM, false);
  let url;
  if (hasTransparency(c)) {
    url = c.toDataURL('image/png');
    let dim = PASTE_MAX_DIM;
    while (url.length > PASTE_MAX_BYTES && dim > 400) {
      dim = Math.round(dim * 0.7);
      c = drawScaled(img, nw, nh, dim, false);
      url = c.toDataURL('image/png');
    }
  } else {
    c = drawScaled(img, nw, nh, PASTE_MAX_DIM, true);
    url = c.toDataURL('image/jpeg', 0.82);
    if (url.length > PASTE_MAX_BYTES) {
      c = drawScaled(img, nw, nh, PASTE_RETRY_DIM, true);
      url = c.toDataURL('image/jpeg', 0.75);
    }
  }
  return { url, w: c.width, h: c.height };
}

function addPastedImage(dataUrl) {
  const probe = new Image();
  probe.onload = () => {
    const packed = compressImage(probe);
    const before = snapshot();
    const maxDim = 460;
    const s = Math.min(1, maxDim / Math.max(packed.w, packed.h));
    const w = r1(packed.w * s), h = r1(packed.h * s);
    const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const id = genId();
    images.push({
      id,
      x: r1(center.x - w / 2 + Math.random() * 40 - 20),
      y: r1(center.y - h / 2 + Math.random() * 40 - 20),
      w, h,
      dataUrl: packed.url,
      isGif: false,
      playing: false
    });
    commitIfChanged(before);
    saveLocal();
    selection = { type: 'image', id };
    render();
  };
  probe.onerror = () => alert('No se pudo procesar la imagen pegada.');
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
        reader.onload = () => addPastedImage(reader.result);
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
   Guardar / cargar archivos (.json)
   ========================================================= */
const FILE_FORMAT = 'lienzoapp';
// Respaldos exportados antes del cambio de nombre siguen siendo válidos
const FILE_FORMATS_OK = ['lienzoapp', 'mindmapper'];

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportDayFile() {
  saveLocal();
  const days = {};
  days[viewDayKey] = JSON.parse(snapshot());
  downloadJSON(
    { app: FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), days },
    'pizarra-' + viewDayKey + '.json'
  );
}

function exportAllFile() {
  saveLocal();
  const days = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DAY_PREFIX)) {
      try { days[key.slice(DAY_PREFIX.length)] = JSON.parse(localStorage.getItem(key)); }
      catch (e) { /* día corrupto: se omite */ }
    }
  }
  downloadJSON(
    { app: FILE_FORMAT, version: 1, exportedAt: new Date().toISOString(), days },
    'pizarras-coleccion-' + todayKey() + '.json'
  );
}

function validDayKey(k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }

/* --- Sanitización profunda ---
   Todo dato que entra por archivo (o quedó corrupto en localStorage)
   se reduce a los campos esperados con tipos y rangos válidos. Evita
   XSS por URLs remotas en imágenes, y que un archivo malformado deje
   la app en un ciclo de crash al renderizar. */
const VALID_SHAPES = ['rect', 'cloud', 'circle', 'clipboard', 'hexagon', 'diamond', 'star', 'sticky'];
const VALID_KINDS = ['rect', 'ellipse', 'triangle', 'line', 'arrow'];
const LIMITS = { items: 3000, text: 5000, icon: 8, id: 64, points: 20000, dataUrl: 4000000, coord: 200000, size: 8000 };

function sanNum(v, fb, min, max) {
  v = Number(v);
  if (!Number.isFinite(v)) return fb;
  return Math.min(Math.max(v, min), max);
}
function sanStr(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function sanColor(v) { return (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : DEFAULT_INK; }
function sanDataUrl(v) {
  return (typeof v === 'string' && v.length <= LIMITS.dataUrl &&
    /^data:image\/(png|jpe?g|gif|webp|bmp|avif);base64,[A-Za-z0-9+/=]+$/.test(v)) ? v : null;
}
function sanArr(v) { return Array.isArray(v) ? v.slice(0, LIMITS.items) : []; }

function sanitizeBoard(b) {
  if (!b || typeof b !== 'object') return null;
  const C = LIMITS.coord, S = LIMITS.size;
  const out = { nodes: [], links: [], strokes: [], doodles: [], images: [] };

  sanArr(b.nodes).forEach(n => {
    if (!n || typeof n !== 'object' || !n.id) return;
    out.nodes.push({
      id: sanStr(n.id, LIMITS.id),
      shape: VALID_SHAPES.includes(n.shape) ? n.shape : 'rect',
      x: sanNum(n.x, 0, -C, C), y: sanNum(n.y, 0, -C, C),
      w: sanNum(n.w, 170, 20, S), h: sanNum(n.h, 95, 20, S),
      text: sanStr(n.text, LIMITS.text),
      color: sanColor(n.color),
      icon: sanStr(n.icon, LIMITS.icon),
      collapsed: !!n.collapsed
    });
  });

  sanArr(b.links).forEach(l => {
    if (!l || typeof l !== 'object' || !l.id || !l.from || !l.to) return;
    out.links.push({
      id: sanStr(l.id, LIMITS.id),
      from: sanStr(l.from, LIMITS.id),
      to: sanStr(l.to, LIMITS.id),
      color: sanColor(l.color)
    });
  });

  sanArr(b.strokes).forEach(s => {
    if (!s || typeof s !== 'object' || !s.id || !Array.isArray(s.points)) return;
    const points = s.points.slice(0, LIMITS.points)
      .filter(p => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map(p => [sanNum(p[0], 0, -C, C), sanNum(p[1], 0, -C, C)]);
    if (!points.length) return;
    out.strokes.push({
      id: sanStr(s.id, LIMITS.id),
      brush: Object.prototype.hasOwnProperty.call(BRUSHES, s.brush) ? s.brush : 'pencil',
      color: sanColor(s.color),
      points
    });
  });

  sanArr(b.doodles).forEach(d => {
    if (!d || typeof d !== 'object' || !d.id) return;
    out.doodles.push({
      id: sanStr(d.id, LIMITS.id),
      kind: VALID_KINDS.includes(d.kind) ? d.kind : 'rect',
      x: sanNum(d.x, 0, -C, C), y: sanNum(d.y, 0, -C, C),
      w: sanNum(d.w, 0, -S, S), h: sanNum(d.h, 0, -S, S),
      color: sanColor(d.color),
      filled: !!d.filled
    });
  });

  sanArr(b.images).forEach(im => {
    if (!im || typeof im !== 'object' || !im.id) return;
    const dataUrl = sanDataUrl(im.dataUrl);
    if (!dataUrl) return;
    out.images.push({
      id: sanStr(im.id, LIMITS.id),
      x: sanNum(im.x, 0, -C, C), y: sanNum(im.y, 0, -C, C),
      w: sanNum(im.w, 100, 4, S), h: sanNum(im.h, 100, 4, S),
      dataUrl,
      isGif: !!im.isGif,
      playing: false
    });
  });

  return out;
}

function boardEmpty(b) {
  return !b.nodes.length && !b.links.length && !b.strokes.length && !b.doodles.length && !b.images.length;
}

function importFromFile(file) {
  const reader = new FileReader();
  reader.onerror = () => alert('No se pudo leer el archivo.');
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { data = null; }
    if (!data || !FILE_FORMATS_OK.includes(data.app) || !data.days || typeof data.days !== 'object') {
      alert('El archivo no es un respaldo válido de esta aplicación.');
      return;
    }
    const entries = Object.entries(data.days)
      .filter(([k, v]) => validDayKey(k) && sanitizeBoard(v));
    if (!entries.length) { alert('El archivo no contiene pizarrones.'); return; }

    const conflicts = entries.filter(([k]) => dayHasData(k)).map(([k]) => k);
    let overwrite = true;
    if (conflicts.length) {
      overwrite = confirm(
        conflicts.length + ' día(s) del archivo ya tienen contenido en este navegador (' +
        conflicts.slice(0, 5).join(', ') + (conflicts.length > 5 ? '…' : '') + ').\n\n' +
        'Aceptar: reemplazarlos con los del archivo.\n' +
        'Cancelar: conservar los actuales e importar solo los días nuevos.'
      );
    }

    let imported = 0, skipped = 0, quotaHit = false;
    for (const [k, v] of entries) {
      if (dayHasData(k) && !overwrite) { skipped++; continue; }
      const board = sanitizeBoard(v);
      try {
        if (boardEmpty(board)) localStorage.removeItem(DAY_PREFIX + k);
        else localStorage.setItem(DAY_PREFIX + k, JSON.stringify(board));
        imported++;
      } catch (e) { quotaHit = true; break; }
    }

    historyStack = [];
    loadBoard(viewDayKey);
    updateDayChip();
    render();

    let msg = 'Se importaron ' + imported + ' pizarrón(es).';
    if (skipped) msg += ' Se conservaron ' + skipped + ' día(s) existentes.';
    if (quotaHit) msg += ' Atención: el almacenamiento se llenó antes de terminar.';
    alert(msg);
  };
  reader.readAsText(file);
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

  // Guardar / cargar
  const filePop = document.getElementById('file-popover');
  document.getElementById('file-btn').addEventListener('click', e => {
    e.stopPropagation();
    togglePopover(filePop);
  });
  document.getElementById('export-btn').addEventListener('click', e => { e.stopPropagation(); closePopovers(); exportPNG(); });
  document.getElementById('save-day-btn').addEventListener('click', e => { e.stopPropagation(); closePopovers(); exportDayFile(); });
  document.getElementById('save-all-btn').addEventListener('click', e => { e.stopPropagation(); closePopovers(); exportAllFile(); });
  const importInput = document.getElementById('import-input');
  document.getElementById('load-btn').addEventListener('click', e => {
    e.stopPropagation();
    closePopovers();
    importInput.click();
  });
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) importFromFile(importInput.files[0]);
    importInput.value = '';
  });

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

  // Panel "Sobre esta app" (contacto)
  const aboutBtn = document.getElementById('about-btn');
  const aboutPanel = document.getElementById('about-panel');
  aboutBtn.addEventListener('click', e => {
    e.stopPropagation();
    aboutPanel.classList.toggle('open');
  });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.dock-group')) closePopovers();
    if (!e.target.closest('#about-panel') && !e.target.closest('#about-btn')) aboutPanel.classList.remove('open');
  });
}

/* =========================================================
   Eventos globales — lienzo (pan, zoom, dibujo)
   ========================================================= */
function initCanvasEvents() {
  /* ---- Pinch-zoom con dos dedos (móvil/tablet) ----
     Se rastrean los toques a nivel de ventana para que el gesto funcione
     aunque un dedo haya caído sobre un nodo o un trazo. Al entrar el
     segundo dedo, las interacciones de un dedo se pausan o descartan. */
  const touches = new Map();
  let pinch = null;

  function beginPinch() {
    const [a, b] = [...touches.values()];
    pinch = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom0: view.zoom,
      mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      view0: { x: view.x, y: view.y }
    };
    pinchActive = true;
    panState = null;
  }
  function doPinch() {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const newZoom = Math.min(2.5, Math.max(0.2, pinch.zoom0 * (d / pinch.d0)));
    // El punto del mundo bajo el centro del gesto sigue al centro actual
    view.x = mid.x - (pinch.mid0.x - pinch.view0.x) * (newZoom / pinch.zoom0);
    view.y = mid.y - (pinch.mid0.y - pinch.view0.y) * (newZoom / pinch.zoom0);
    view.zoom = newZoom;
    applyView();
  }
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    if (e.target.closest && e.target.closest('.dock, .popover, #top-left-ui, #tour-tip, #search-panel, .onboarding-modal')) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) beginPinch();
  }, true);
  window.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) doPinch();
  }, true);
  function releaseTouch(e) {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) { pinch = null; pinchActive = false; }
  }
  window.addEventListener('pointerup', releaseTouch, true);
  window.addEventListener('pointercancel', releaseTouch, true);

  svgCanvas.addEventListener('pointerdown', e => {
    // El segundo dedo (y siguientes) pertenece al gesto de pinch, no a las herramientas
    if (e.pointerType === 'touch' && touches.size >= 2) return;
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
    if (!panState || pinchActive) return;
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
/* =========================================================
   Guía de primer uso — flecha que recorre el dock
   ========================================================= */
const TOUR_KEY = 'mindmapper-tour-done';
const TOUR_STEPS = [
  ['[data-tool="select"]', 'Selecciona y mueve lo que quieras'],
  ['#add-node-btn', 'Añade nodos con distintas formas'],
  ['[data-tool="add-link"]', 'Conecta un nodo con otro'],
  ['[data-tool="draw"]', 'Dibuja a mano alzada con varios pinceles'],
  ['[data-tool="shape"]', 'Figuras geométricas: arrastra para dibujarlas'],
  ['[data-tool="erase"]', 'Borra trazos y figuras'],
  ['#color-btn', 'Cambia el color de la tinta'],
  ['#organize-btn', 'Ordena el mapa automáticamente'],
  ['#calendar-btn', 'Cada día tienes un pizarrón nuevo'],
  ['#theme-btn', 'Cambia el tema visual cuando quieras — ¡mira, de Profesional a Boceto!', () => setTheme('sketch')],
  ['#file-btn', 'Guarda tus pizarrones como archivo o imagen, y cárgalos después']
];
let tourIndex = -1;
let tourTimer = null;

function endTour() {
  if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; }
  tourIndex = -1;
  localStorage.setItem(TOUR_KEY, '1');
  document.getElementById('tour-tip').classList.remove('visible');
  document.querySelectorAll('.tour-target').forEach(b => b.classList.remove('tour-target'));
}

function showTourStep(i) {
  if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; }
  document.querySelectorAll('.tour-target').forEach(b => b.classList.remove('tour-target'));
  if (i >= TOUR_STEPS.length) { endTour(); return; }
  const btn = document.querySelector(TOUR_STEPS[i][0]);
  if (!btn) { showTourStep(i + 1); return; }
  tourIndex = i;
  btn.classList.add('tour-target');
  if (TOUR_STEPS[i][2]) TOUR_STEPS[i][2]();

  const tip = document.getElementById('tour-tip');
  document.getElementById('tour-text').textContent = TOUR_STEPS[i][1];
  document.getElementById('tour-count').textContent = (i + 1) + ' / ' + TOUR_STEPS.length;
  tip.classList.add('visible');

  const r = btn.getBoundingClientRect();
  let left = r.left + r.width / 2 - tip.offsetWidth / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - tip.offsetWidth - 10));
  tip.style.left = left + 'px';
  tip.style.top = (r.top - tip.offsetHeight - 14) + 'px';
  document.getElementById('tour-arrow').style.left = (r.left + r.width / 2 - left - 7) + 'px';

  tourTimer = setTimeout(() => showTourStep(tourIndex + 1), 3500);
}

function startTour() {
  if (localStorage.getItem(TOUR_KEY)) return;
  showTourStep(0);
}

function initTour() {
  document.getElementById('tour-close').addEventListener('click', e => {
    e.stopPropagation();
    endTour();
  });
  document.getElementById('tour-next').addEventListener('click', e => {
    e.stopPropagation();
    showTourStep(tourIndex + 1);
  });
}

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
    startTour();
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
  initTour();
  initOnboarding();
  updateDayChip();
  setTool('select');
  applyView();
  render();
}

init();
