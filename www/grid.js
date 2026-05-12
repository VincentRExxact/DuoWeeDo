/* ─────────────────────────────────────────────────────────────────────────────
   grid.js  —  Grid display layer

   PUBLIC API (called by events.js):
     gridAttach()        → find active slide img, inject canvas, size it
                           returns true if successful
     gridDraw()          → redraw grid + selected tiles on canvas
     gridRemove()        → detach canvas from DOM (PhotoBrowser closed)
     gridHitTile(px, py) → return {row, col} (0-based) or null
     gridClear()         → clear selectedTiles + redraw

   STATE (read by events.js to notify Shiny):
     selectedTiles       → object { "r,c": true, ... }  0-based keys

   NO event listeners here. NO Shiny calls here.
───────────────────────────────────────────────────────────────────────────── */

/* ── Constants ───────────────────────────────────────────────────────────── */
var G          = 8;       /* grid size */
var TOP_MARGIN = 0.22;    /* top edge inset fraction on each side */
var ROW_RATIO  = 0.9;     /* height ratio between consecutive rows (bottom→top) */

/* ── Shared state ────────────────────────────────────────────────────────── */
var selectedTiles = {};   /* "r,c" (0-based) → true */

/* ── Private: canvas element ─────────────────────────────────────────────── */
var _canvas = null;

/* ─────────────────────────────────────────────────────────────────────────────
   GEOMETRY
───────────────────────────────────────────────────────────────────────────── */

function _computeVBoundaries() {
  /* Geometric series: row heights decrease by ROW_RATIO from bottom to top.
     vs[r] = v-coordinate at the bottom edge of row r  (v ∈ [0,1])
     vs[r+1]                at the top    edge of row r                       */
  var h0 = (1 - ROW_RATIO) / (1 - Math.pow(ROW_RATIO, G));
  var vs = [0];
  for (var r = 0; r < G; r++)
    vs.push(vs[r] + h0 * Math.pow(ROW_RATIO, r));
  return vs;
}

function _bilerp(W, H, u, v) {
  /* Bilinear interpolation inside the trapezoid.
     Corners (pixels):  bl=(0,H)  br=(W,H)  tl=(W*m,0)  tr=(W*(1-m),0)    */
  var m = TOP_MARGIN;
  return {
    x: (1-u)*(1-v)*0 + u*(1-v)*W + (1-u)*v*(W*m) + u*v*(W*(1-m)),
    y: (1-u)*(1-v)*H + u*(1-v)*H + (1-u)*v*0      + u*v*0
  };
}

function _tileCorners(row, col, W, H, vs) {
  /* Four pixel-space corners of cell (row, col), 0-based. */
  return {
    bl: _bilerp(W, H, col/G,       vs[row]),
    br: _bilerp(W, H, (col+1)/G,   vs[row]),
    tl: _bilerp(W, H, col/G,       vs[row+1]),
    tr: _bilerp(W, H, (col+1)/G,   vs[row+1])
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   DOM — find img, create canvas, size and position it
───────────────────────────────────────────────────────────────────────────── */

function _getActiveSlideImg() {
  /* Framework7 marks the visible slide with .swiper-slide-active */
  return document.querySelector(
    '.photo-browser .swiper-slide-active img,' +
    '.photo-browser-swiper .swiper-slide-active img'
  ) || null;
}

function _getOrCreateCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.id = 'grid-canvas';
    /* NO CSS width/height — canvas.width/height alone define the pixel buffer.
       position:absolute + explicit top/left align it exactly over the img.   */
    _canvas.style.cssText = [
      'position:absolute',
      'top:0', 'left:0',
      'z-index:9999',
      'touch-action:none',
      'pointer-events:auto'
    ].join(';');
  }
  return _canvas;
}

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC API
───────────────────────────────────────────────────────────────────────────── */

/* gridAttach()
   Finds the active slide <img>, injects the canvas as a sibling,
   and sizes the canvas pixel buffer to the img's rendered dimensions.
   Returns true on success, false if the img is not yet rendered.            */
function gridAttach() {
  var img = _getActiveSlideImg();
  if (!img) return false;

  var rect = img.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;   /* not yet painted */

  var canvas = _getOrCreateCanvas();
  var parent = img.parentElement;

  /* Parent must be position:relative so our absolute canvas aligns on it.   */
  if (parent && getComputedStyle(parent).position === 'static')
    parent.style.position = 'relative';

  /* Move canvas into the img's parent if needed */
  if (canvas.parentElement !== parent) {
    if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
    if (parent) parent.appendChild(canvas);
  }

  /* Size the pixel buffer to match the rendered img exactly.
     Also set explicit top/left in case img is offset within its parent
     (e.g. object-fit:contain with letterboxing).                            */
  var parentRect = parent.getBoundingClientRect();
  canvas.width        = Math.round(rect.width);
  canvas.height       = Math.round(rect.height);
  canvas.style.left   = Math.round(rect.left - parentRect.left) + 'px';
  canvas.style.top    = Math.round(rect.top  - parentRect.top)  + 'px';

  return true;
}

/* gridDraw()
   Redraws the full grid and highlights on the canvas.                       */
function gridDraw() {
  if (!_canvas) return;
  var W = _canvas.width, H = _canvas.height;
  if (!W || !H) return;

  var ctx = _canvas.getContext('2d');
  var vs  = _computeVBoundaries();
  ctx.clearRect(0, 0, W, H);

  /* Selected tile fills */
  Object.keys(selectedTiles).forEach(function(key) {
    var rc = key.split(','), p = _tileCorners(+rc[0], +rc[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p.bl.x,p.bl.y); ctx.lineTo(p.br.x,p.br.y);
    ctx.lineTo(p.tr.x,p.tr.y); ctx.lineTo(p.tl.x,p.tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(109,206,160,0.35)';
    ctx.fill();
  });

  /* Horizontal grid lines */
  ctx.strokeStyle = 'rgba(80,200,130,0.9)';
  ctx.lineWidth   = 1.5;
  for (var ri = 0; ri <= G; ri++) {
    ctx.beginPath();
    for (var ci = 0; ci <= G; ci++) {
      var pt = _bilerp(W, H, ci/G, vs[ri]);
      ci === 0 ? ctx.moveTo(pt.x,pt.y) : ctx.lineTo(pt.x,pt.y);
    }
    ctx.stroke();
  }

  /* Vertical grid lines */
  for (var ci2 = 0; ci2 <= G; ci2++) {
    ctx.beginPath();
    for (var ri2 = 0; ri2 <= G; ri2++) {
      var pt2 = _bilerp(W, H, ci2/G, vs[ri2]);
      ri2 === 0 ? ctx.moveTo(pt2.x,pt2.y) : ctx.lineTo(pt2.x,pt2.y);
    }
    ctx.stroke();
  }

  /* Selected tile borders (drawn on top of grid lines) */
  ctx.strokeStyle = '#6dcea0';
  ctx.lineWidth   = 2.5;
  Object.keys(selectedTiles).forEach(function(key2) {
    var rc2 = key2.split(','), p2 = _tileCorners(+rc2[0], +rc2[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p2.bl.x,p2.bl.y); ctx.lineTo(p2.br.x,p2.br.y);
    ctx.lineTo(p2.tr.x,p2.tr.y); ctx.lineTo(p2.tl.x,p2.tl.y);
    ctx.closePath();
    ctx.stroke();
  });
}

/* gridRemove()
   Detaches the canvas from the DOM. Called when PhotoBrowser closes.        */
function gridRemove() {
  if (_canvas && _canvas.parentElement)
    _canvas.parentElement.removeChild(_canvas);
}

/* gridClear()
   Resets tile selection and redraws.                                        */
function gridClear() {
  selectedTiles = {};
  gridDraw();
}

/* gridHitTile(px, py)
   Returns {row, col} (0-based) for the tile at canvas-pixel (px, py),
   or null if outside the trapezoid.
   px, py must be relative to the canvas top-left corner.                    */
function gridHitTile(px, py) {
  if (!_canvas) return null;
  var W = _canvas.width, H = _canvas.height;
  var vs = _computeVBoundaries();

  function cross(ax,ay,bx,by) { return ax*by - ay*bx; }
  function inQuad(px,py,p) {
    var pts = [p.bl, p.tl, p.tr, p.br];
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i+1)%4];
      if (cross(b.x-a.x, b.y-a.y, px-a.x, py-a.y) < 0) return false;
    }
    return true;
  }

  for (var r = 0; r < G; r++)
    for (var c = 0; c < G; c++)
      if (inQuad(px, py, _tileCorners(r, c, W, H, vs)))
        return { row: r, col: c };
  return null;
}
