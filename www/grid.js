/* ─────────────────────────────────────────────────────────────────────────────
   grid.js  —  Perspective trapezoid grid overlay
   The grid shape is a trapezoid defined by four corners:
     Bottom-left  : (0,          H)   — full image width at the bottom
     Bottom-right : (W,          H)
     Top-left     : (margin,     0)   — narrower at the top (inset by `topMargin`)
     Top-right    : (W-margin,   0)
   Each tile is drawn as a quadrilateral using bilinear interpolation of the
   four trapezoid corners, so rows and columns curve in perspective.
───────────────────────────────────────────────────────────────────────────── */

/* ── State ───────────────────────────────────────────────────────────────── */
var selectedTiles = [];
var gridSize      = 8;

/* ── Config ──────────────────────────────────────────────────────────────── */
// How far the top edge is inset from each side (as a fraction of canvas width)
var TOP_MARGIN_RATIO = 0.22;   // 0 = no perspective, 0.5 = triangle

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Bilinear interpolation inside a quad defined by four corners.
 * u ∈ [0,1]  → left→right (column)
 * v ∈ [0,1]  → top→bottom (row)
 */
function bilerp(tl, tr, bl, br, u, v) {
  return {
    x: (1-u)*(1-v)*tl.x + u*(1-v)*tr.x + (1-u)*v*bl.x + u*v*br.x,
    y: (1-u)*(1-v)*tl.y + u*(1-v)*tr.y + (1-u)*v*bl.y + u*v*br.y
  };
}

/** Return the four corners of the trapezoid for a given canvas size. */
function trapCorners(W, H) {
  var m = W * TOP_MARGIN_RATIO;
  return {
    tl: { x: m,     y: 0 },
    tr: { x: W - m, y: 0 },
    bl: { x: 0,     y: H },
    br: { x: W,     y: H }
  };
}

/**
 * Return the four screen-space corners of cell (row, col) inside the trapezoid.
 * Rows run top→bottom, columns run left→right.
 */
function tileCorners(row, col, G, W, H) {
  var c = trapCorners(W, H);
  var u0 =  col      / G,  u1 = (col + 1) / G;
  var v0 =  row      / G,  v1 = (row + 1) / G;
  return [
    bilerp(c.tl, c.tr, c.bl, c.br, u0, v0),  // top-left
    bilerp(c.tl, c.tr, c.bl, c.br, u1, v0),  // top-right
    bilerp(c.tl, c.tr, c.bl, c.br, u1, v1),  // bottom-right
    bilerp(c.tl, c.tr, c.bl, c.br, u0, v1)   // bottom-left
  ];
}

/** Draw a closed quad path from four {x,y} points. */
function quadPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath();
}

/**
 * Hit-test: is point (px, py) inside the quad defined by pts[]?
 * Uses the winding / cross-product sign test.
 */
function pointInQuad(px, py, pts) {
  for (var i = 0; i < 4; i++) {
    var a = pts[i], b = pts[(i + 1) % 4];
    var cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross < 0) return false;
  }
  return true;
}

/* ── Shiny message handlers ─────────────────────────────────────────────── */

Shiny.addCustomMessageHandler('load_image', function (msg) {
  gridSize         = msg.grid;
  TOP_MARGIN_RATIO = (msg.perspective || 0) / 100;
  selectedTiles    = [];
  updateTileList();

  var img  = document.getElementById('base-image');
  img.src  = msg.src + '?t=' + Date.now();
  img.onload = function () { drawGrid(); };
});

Shiny.addCustomMessageHandler('redraw_grid', function (msg) {
  gridSize         = msg.grid;
  TOP_MARGIN_RATIO = (msg.perspective || 0) / 100;
  selectedTiles    = selectedTiles.filter(function (t) {
    return t.row < gridSize && t.col < gridSize;
  });
  updateTileList();
  drawGrid();
});

Shiny.addCustomMessageHandler('clear_tiles', function (_msg) {
  selectedTiles = [];
  updateTileList();
  drawGrid();
});

/* ── Canvas drawing ──────────────────────────────────────────────────────── */
function drawGrid() {
  var canvas = document.getElementById('grid-canvas');
  var img    = document.getElementById('base-image');
  if (!img || !img.naturalWidth) return;

  canvas.width  = img.offsetWidth;
  canvas.height = img.offsetHeight;

  var ctx = canvas.getContext('2d');
  var W   = canvas.width;
  var H   = canvas.height;
  var G   = gridSize;

  ctx.clearRect(0, 0, W, H);

  /* 1 — Selected tile fills */
  selectedTiles.forEach(function (t) {
    var pts = tileCorners(t.row, t.col, G, W, H);
    quadPath(ctx, pts);
    ctx.fillStyle = 'rgba(109, 206, 160, 0.30)';
    ctx.fill();
  });

  /* 2 — Grid lines (draw each edge of every cell) */
  ctx.strokeStyle = 'rgba(80, 200, 130, 0.80)';
  ctx.lineWidth   = 1.2;
  ctx.lineJoin    = 'round';

  var corners = trapCorners(W, H);

  // Horizontal lines: iterate over row boundaries (v = r/G)
  for (var r = 0; r <= G; r++) {
    var v = r / G;
    ctx.beginPath();
    for (var c = 0; c <= G; c++) {
      var u = c / G;
      var p = bilerp(corners.tl, corners.tr, corners.bl, corners.br, u, v);
      if (c === 0) ctx.moveTo(p.x, p.y);
      else         ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // Vertical lines: iterate over column boundaries (u = c/G)
  for (var c2 = 0; c2 <= G; c2++) {
    var u2 = c2 / G;
    ctx.beginPath();
    for (var r2 = 0; r2 <= G; r2++) {
      var v2 = r2 / G;
      var p2 = bilerp(corners.tl, corners.tr, corners.bl, corners.br, u2, v2);
      if (r2 === 0) ctx.moveTo(p2.x, p2.y);
      else          ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  }

  /* 3 — Selected tile borders (drawn on top of grid lines) */
  selectedTiles.forEach(function (t) {
    var pts = tileCorners(t.row, t.col, G, W, H);
    quadPath(ctx, pts);
    ctx.strokeStyle = '#6dcea0';
    ctx.lineWidth   = 2;
    ctx.stroke();
  });
}

/* ── Click handler ───────────────────────────────────────────────────────── */
document.addEventListener('click', function (e) {
  var canvas = document.getElementById('grid-canvas');
  if (e.target !== canvas) return;

  var rect = canvas.getBoundingClientRect();
  var px   = e.clientX - rect.left;
  var py   = e.clientY - rect.top;
  var W    = canvas.width;
  var H    = canvas.height;
  var G    = gridSize;

  // Find which tile was clicked by testing each quad
  var hit = null;
  outer: for (var r = 0; r < G; r++) {
    for (var c = 0; c < G; c++) {
      var pts = tileCorners(r, c, G, W, H);
      if (pointInQuad(px, py, pts)) {
        hit = { row: r, col: c };
        break outer;
      }
    }
  }

  // Click was outside the trapezoid — ignore
  if (!hit) return;

  // Toggle selection
  var idx = selectedTiles.findIndex(function (t) {
    return t.row === hit.row && t.col === hit.col;
  });
  if (idx >= 0) {
    selectedTiles.splice(idx, 1);
  } else {
    selectedTiles.push(hit);
  }

  drawGrid();
  updateTileList();
  Shiny.setInputValue('selected_tiles', JSON.stringify(selectedTiles), { priority: 'event' });
});

/* ── Tile list (side panel) ──────────────────────────────────────────────── */
function updateTileList() {
  var el      = document.getElementById('tile-list');
  var countEl = document.getElementById('sel-count');
  if (countEl) countEl.textContent = selectedTiles.length;

  if (selectedTiles.length === 0) {
    el.innerHTML = '<div class="empty-state">No tiles selected yet</div>';
    return;
  }

  var sorted = selectedTiles.slice().sort(function (a, b) {
    return a.row !== b.row ? a.row - b.row : a.col - b.col;
  });

  el.innerHTML = sorted.map(function (t) {
    return (
      '<div class="tile-badge">' +
        'Row\u00a0' + (t.row + 1) + ' \u00b7 Col\u00a0' + (t.col + 1) +
        '<span>[' + (t.row + 1) + ',' + (t.col + 1) + ']</span>' +
      '</div>'
    );
  }).join('');
}

/* ── Redraw on resize ────────────────────────────────────────────────────── */
window.addEventListener('resize', function () { drawGrid(); });
