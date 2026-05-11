/* ─────────────────────────────────────────────────────────────────────────────
   grid.js  —  Perspective trapezoid grid geometry + canvas rendering
   The grid lives inside #canvas-container which is inside an f7ExpandableCard.
   We wait for the card to be fully open before sizing/drawing the canvas.

   Geometry:
     • 8×8 fixed grid
     • Top edge inset by TOP_MARGIN on each side (perspective narrowing)
     • Row heights decrease bottom→top by ROW_RATIO per row (geometric series)
───────────────────────────────────────────────────────────────────────────── */

/* ── Constants ───────────────────────────────────────────────────────────── */
var G          = 8;
var TOP_MARGIN = 0.22;
var ROW_RATIO  = 0.9;

/* ── State ───────────────────────────────────────────────────────────────── */
var selectedTiles = {};   // key: "r,c" (0-based) → true

/* ─────────────────────────────────────────────────────────────────────────────
   GEOMETRY
───────────────────────────────────────────────────────────────────────────── */

/* Precompute v-boundaries for row heights (geometric series).
   vs[r]   = v at bottom edge of row r  (v=0 → bottom of trapezoid)
   vs[r+1] = v at top    edge of row r  (v=1 → top    of trapezoid)  */
function computeVBoundaries() {
  var h0 = (1 - ROW_RATIO) / (1 - Math.pow(ROW_RATIO, G));
  var vs = [0];
  for (var r = 0; r < G; r++) {
    vs.push(vs[r] + h0 * Math.pow(ROW_RATIO, r));
  }
  return vs;
}

/* Bilinear interpolation inside the trapezoid.
   u ∈ [0,1] left→right,  v ∈ [0,1] bottom→top.
   Returns {x, y} in canvas pixels.                                          */
function bilerp(W, H, u, v) {
  var blX = 0,                   blY = H;
  var brX = W,                   brY = H;
  var tlX = W * TOP_MARGIN,      tlY = 0;
  var trX = W * (1 - TOP_MARGIN),trY = 0;
  return {
    x: (1-u)*(1-v)*blX + u*(1-v)*brX + (1-u)*v*tlX + u*v*trX,
    y: (1-u)*(1-v)*blY + u*(1-v)*brY + (1-u)*v*tlY + u*v*trY
  };
}

/* Four pixel-space corners of cell (row, col) — 0-based. */
function tilePixelCorners(row, col, W, H, vs) {
  var u0 = col / G,     u1 = (col + 1) / G;
  var vb = vs[row],     vt = vs[row + 1];
  return {
    bl: bilerp(W, H, u0, vb),
    br: bilerp(W, H, u1, vb),
    tl: bilerp(W, H, u0, vt),
    tr: bilerp(W, H, u1, vt)
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   DRAWING
───────────────────────────────────────────────────────────────────────────── */

function drawGrid() {
  var canvas = document.getElementById('grid-canvas');
  var img    = document.getElementById('card-image');
  if (!canvas || !img || !img.offsetWidth) return;

  /* Size canvas to match the displayed image exactly */
  canvas.width  = img.offsetWidth;
  canvas.height = img.offsetHeight;

  /* Also size the container so the absolute canvas aligns correctly */
  var container = document.getElementById('canvas-container');
  if (container) container.style.height = img.offsetHeight + 'px';

  var ctx = canvas.getContext('2d');
  var W   = canvas.width;
  var H   = canvas.height;
  var vs  = computeVBoundaries();

  ctx.clearRect(0, 0, W, H);

  /* 1 — Selected fills */
  for (var key in selectedTiles) {
    var rc = key.split(',');
    var p  = tilePixelCorners(+rc[0], +rc[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p.bl.x, p.bl.y);
    ctx.lineTo(p.br.x, p.br.y);
    ctx.lineTo(p.tr.x, p.tr.y);
    ctx.lineTo(p.tl.x, p.tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(109,206,160,0.35)';
    ctx.fill();
  }

  /* 2 — Horizontal grid lines */
  ctx.strokeStyle = 'rgba(80,200,130,0.85)';
  ctx.lineWidth   = 1.4;
  for (var ri = 0; ri <= G; ri++) {
    ctx.beginPath();
    for (var ci = 0; ci <= G; ci++) {
      var pt = bilerp(W, H, ci / G, vs[ri]);
      ci === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }

  /* 3 — Vertical grid lines */
  for (var ci2 = 0; ci2 <= G; ci2++) {
    ctx.beginPath();
    for (var ri2 = 0; ri2 <= G; ri2++) {
      var pt2 = bilerp(W, H, ci2 / G, vs[ri2]);
      ri2 === 0 ? ctx.moveTo(pt2.x, pt2.y) : ctx.lineTo(pt2.x, pt2.y);
    }
    ctx.stroke();
  }

  /* 4 — Selected borders (on top of grid lines) */
  ctx.strokeStyle = '#6dcea0';
  ctx.lineWidth   = 2;
  for (var key2 in selectedTiles) {
    var rc2 = key2.split(',');
    var p2  = tilePixelCorners(+rc2[0], +rc2[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p2.bl.x, p2.bl.y);
    ctx.lineTo(p2.br.x, p2.br.y);
    ctx.lineTo(p2.tr.x, p2.tr.y);
    ctx.lineTo(p2.tl.x, p2.tl.y);
    ctx.closePath();
    ctx.stroke();
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   HIT TEST
───────────────────────────────────────────────────────────────────────────── */

function cross2D(ax, ay, bx, by) { return ax * by - ay * bx; }

function pointInQuad(px, py, p) {
  /* CCW winding: bl → tl → tr → br */
  var pts = [p.bl, p.tl, p.tr, p.br];
  for (var i = 0; i < 4; i++) {
    var a = pts[i], b = pts[(i + 1) % 4];
    if (cross2D(b.x - a.x, b.y - a.y, px - a.x, py - a.y) < 0) return false;
  }
  return true;
}

function hitTile(px, py) {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return null;
  var vs = computeVBoundaries();
  for (var r = 0; r < G; r++)
    for (var c = 0; c < G; c++)
      if (pointInQuad(px, py, tilePixelCorners(r, c, canvas.width, canvas.height, vs)))
        return { row: r, col: c };
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SHINY COMMUNICATION
───────────────────────────────────────────────────────────────────────────── */

function notifyShiny() {
  var tiles = Object.keys(selectedTiles).map(function(key) {
    var p = key.split(',');
    return { row: +p[0] + 1, col: +p[1] + 1 };   // 1-based for R
  });
  Shiny.setInputValue('selected_tiles', tiles, { priority: 'event' });
}

/* R → JS: load a new image into #card-image, reset selection, redraw */
Shiny.addCustomMessageHandler('load_image', function(msg) {
  var img = document.getElementById('card-image');
  selectedTiles = {};

  img.src = msg.src + '?t=' + Date.now();   // cache-bust
  img.onload = function() {
    drawGrid();
    notifyShiny();
  };
});

/* R → JS: clear selection without changing the image */
Shiny.addCustomMessageHandler('clear_tiles', function(_msg) {
  selectedTiles = {};
  drawGrid();
  notifyShiny();
});

/* ─────────────────────────────────────────────────────────────────────────────
   CARD OPEN / CLOSE EVENTS
   Framework7 fires `card:open` and `card:opened` on the card element.
   We redraw once the animation is complete (`card:opened`) so the canvas
   dimensions match the fully-expanded card size, not the collapsed thumbnail.
───────────────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
  var card = document.getElementById('tile-card');
  if (!card) return;

  /* Redraw when the expand animation finishes */
  card.addEventListener('card:opened', function() {
    drawGrid();
  });

  /* Optional: clear canvas when card collapses (saves memory) */
  card.addEventListener('card:closed', function() {
    var canvas = document.getElementById('grid-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  });

  window.addEventListener('resize', drawGrid);
});
