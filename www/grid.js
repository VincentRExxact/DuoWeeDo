/* ─────────────────────────────────────────────────────────────────────────────
   grid.js  —  Grid display layer

   PUBLIC API (called by events.js):
     gridInit()           → size canvas to img, enable pointer events, draw
     gridDraw()           → redraw grid + selected tiles
     gridHitTile(px, py)  → {row,col} 0-based in canvas-pixel space, or null
     gridClear()          → clear selectedTiles + redraw
     gridApplyTransform(scale, dx, dy) → keep canvas aligned during zoom/pan

   SHARED STATE (read/written by events.js):
     selectedTiles        → { "r,c": true }  0-based

   NO event listeners. NO Shiny calls.
───────────────────────────────────────────────────────────────────────────── */

/* ── Constants ───────────────────────────────────────────────────────────── */
var G          = 8;
var TOP_MARGIN = 0.22;
var ROW_RATIO  = 0.9;

/* ── Shared state ────────────────────────────────────────────────────────── */
var selectedTiles = {};

/* ─────────────────────────────────────────────────────────────────────────────
   GEOMETRY
───────────────────────────────────────────────────────────────────────────── */

function _vBounds() {
  var h0 = (1 - ROW_RATIO) / (1 - Math.pow(ROW_RATIO, G));
  var vs = [0];
  for (var r = 0; r < G; r++) vs.push(vs[r] + h0 * Math.pow(ROW_RATIO, r));
  return vs;
}

function _bilerp(W, H, u, v) {
  var m = TOP_MARGIN;
  return {
    x: (1-u)*(1-v)*0 + u*(1-v)*W + (1-u)*v*(W*m)     + u*v*(W*(1-m)),
    y: (1-u)*(1-v)*H + u*(1-v)*H + (1-u)*v*0          + u*v*0
  };
}

function _corners(row, col, W, H, vs) {
  return {
    bl: _bilerp(W, H, col/G,       vs[row]),
    br: _bilerp(W, H, (col+1)/G,   vs[row]),
    tl: _bilerp(W, H, col/G,       vs[row+1]),
    tr: _bilerp(W, H, (col+1)/G,   vs[row+1])
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC API
───────────────────────────────────────────────────────────────────────────── */

/* gridInit()
   Called once after a new image loads.
   Sizes the canvas pixel buffer to exactly match the rendered <img>.
   Returns true on success (img must be painted).                            */
function gridInit() {
  var img    = document.getElementById('bg-image');
  var canvas = document.getElementById('grid-canvas');
  if (!img || !canvas) return false;

  var rect = img.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  /* Size the pixel buffer — NO CSS width/height, buffer IS the size.       */
  canvas.width  = Math.round(rect.width);
  canvas.height = Math.round(rect.height);

  /* Position canvas exactly over the img (img may be centred via flexbox). */
  var wrapRect = img.parentElement.getBoundingClientRect();
  canvas.style.left = Math.round(rect.left - wrapRect.left) + 'px';
  canvas.style.top  = Math.round(rect.top  - wrapRect.top)  + 'px';

  /* Enable touch events now that we're sized correctly.                    */
  canvas.style.pointerEvents = 'auto';

  gridDraw();
  return true;
}

/* gridApplyTransform(scale, originX, originY, dx, dy)
   Called by events.js during pinch-zoom / pan.
   Mirrors the CSS transform applied to <img> so the canvas tracks perfectly.
   scale    → current zoom scale factor
   originX/Y → transform-origin in img-wrap coordinates (pinch midpoint)
   dx, dy   → cumulative pan offset                                          */
function gridApplyTransform(scale, originX, originY, dx, dy) {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  /* Apply the same transform to canvas as applied to the img.              */
  canvas.style.transformOrigin = originX + 'px ' + originY + 'px';
  canvas.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';
}

/* gridResetTransform()  — called when zoom resets.                         */
function gridResetTransform() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  canvas.style.transform       = '';
  canvas.style.transformOrigin = '';
}

/* gridDraw()  — redraw grid + highlights.                                  */
function gridDraw() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  var W = canvas.width, H = canvas.height;
  if (!W || !H) return;

  var ctx = canvas.getContext('2d');
  var vs  = _vBounds();
  ctx.clearRect(0, 0, W, H);

  /* Selected fills */
  Object.keys(selectedTiles).forEach(function(k) {
    var rc = k.split(','), p = _corners(+rc[0], +rc[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p.bl.x,p.bl.y); ctx.lineTo(p.br.x,p.br.y);
    ctx.lineTo(p.tr.x,p.tr.y); ctx.lineTo(p.tl.x,p.tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(109,206,160,0.35)';
    ctx.fill();
  });

  /* Horizontal lines */
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

  /* Vertical lines */
  for (var ci2 = 0; ci2 <= G; ci2++) {
    ctx.beginPath();
    for (var ri2 = 0; ri2 <= G; ri2++) {
      var pt2 = _bilerp(W, H, ci2/G, vs[ri2]);
      ri2 === 0 ? ctx.moveTo(pt2.x,pt2.y) : ctx.lineTo(pt2.x,pt2.y);
    }
    ctx.stroke();
  }

  /* Selected borders */
  ctx.strokeStyle = '#6dcea0';
  ctx.lineWidth   = 2.5;
  Object.keys(selectedTiles).forEach(function(k2) {
    var rc2 = k2.split(','), p2 = _corners(+rc2[0], +rc2[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p2.bl.x,p2.bl.y); ctx.lineTo(p2.br.x,p2.br.y);
    ctx.lineTo(p2.tr.x,p2.tr.y); ctx.lineTo(p2.tl.x,p2.tl.y);
    ctx.closePath();
    ctx.stroke();
  });
}

/* gridClear()  — reset selection + redraw.                                 */
function gridClear() {
  selectedTiles = {};
  gridDraw();
}

/* gridHitTile(px, py)
   px, py in canvas-pixel space (relative to canvas top-left, pre-transform).
   Returns {row, col} 0-based or null.                                       */
function gridHitTile(px, py) {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return null;
  var W = canvas.width, H = canvas.height;
  var vs = _vBounds();

  function cross(ax,ay,bx,by) { return ax*by - ay*bx; }
  function inQuad(px,py,p) {
    var pts = [p.bl,p.tl,p.tr,p.br];
    for (var i=0;i<4;i++){
      var a=pts[i],b=pts[(i+1)%4];
      if(cross(b.x-a.x,b.y-a.y,px-a.x,py-a.y)<0) return false;
    }
    return true;
  }
  for (var r=0;r<G;r++)
    for (var c=0;c<G;c++)
      if(inQuad(px,py,_corners(r,c,W,H,vs)))
        return {row:r, col:c};
  return null;
}
