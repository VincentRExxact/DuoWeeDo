/* ─────────────────────────────────────────────────────────────────────────────
   events.js  —  Gesture & event layer

   Depends on: grid.js  (gridInit, gridDraw, gridClear, gridHitTile,
                          gridApplyTransform, gridResetTransform, selectedTiles)

   Gestures handled (all on #img-wrap):
     TAP          → toggle tile (if not zoomed past threshold)
     SWIPE LEFT   → next image  → Shiny: swipe_next
     SWIPE RIGHT  → prev image  → Shiny: swipe_prev
     PINCH ZOOM   → scale img + canvas tracks via CSS transform
     DOUBLE-TAP   → reset zoom

   Shiny inputs fired:
     swipe_next       → navigate to next image
     swipe_prev       → navigate to previous image
     selected_tiles   → current tile selection (1-based row/col)

   R → JS messages:
     set_image  { url, index, total } → update img.src, reset grid + zoom
───────────────────────────────────────────────────────────────────────────── */

/* ── Gesture thresholds ──────────────────────────────────────────────────── */
var SWIPE_MIN_X   = 50;   /* px horizontal travel to trigger swipe           */
var SWIPE_MAX_Y   = 80;   /* px vertical drift allowed during swipe           */
var TAP_MAX_MOVE  = 10;   /* px total finger travel to count as a tap         */
var ZOOM_MIN      = 1.0;  /* minimum scale (no zoom-out below natural size)   */
var ZOOM_MAX      = 5.0;  /* maximum scale                                    */
var DBLTAP_MS     = 280;  /* ms between taps to count as double-tap           */

/* ── Zoom/pan state ──────────────────────────────────────────────────────── */
var _scale      = 1.0;
var _dx         = 0;      /* current pan offset X                             */
var _dy         = 0;      /* current pan offset Y                             */
var _originX    = 0;      /* transform-origin X (pinch midpoint)              */
var _originY    = 0;      /* transform-origin Y                               */

/* ── Touch tracking ──────────────────────────────────────────────────────── */
var _t1 = null, _t2 = null;          /* active touch points                  */
var _startDist  = 0;                 /* initial pinch distance                */
var _startScale = 1.0;               /* scale at pinch start                  */
var _startMidX  = 0, _startMidY = 0;/* pinch midpoint at start               */
var _startDx    = 0, _startDy   = 0;/* pan offset at gesture start           */
var _tapStartX  = 0, _tapStartY = 0;
var _lastTapMs  = 0;                 /* timestamp of previous tap end         */

/* ─────────────────────────────────────────────────────────────────────────────
   R → JS
───────────────────────────────────────────────────────────────────────────── */

Shiny.addCustomMessageHandler('set_image', function(msg) {
  var img = document.getElementById('bg-image');
  selectedTiles = {};
  _resetZoom();

  img.src = msg.url + '?t=' + Date.now();
  img.onload = function() {
    /* Poll until the img has a rendered size (flexbox may need a frame)    */
    _pollInit();
  };
});

function _pollInit() {
  var attempts = 0;
  var t = setInterval(function() {
    attempts++;
    if (gridInit()) clearInterval(t);
    if (attempts > 40) clearInterval(t);
  }, 50);
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOUCH EVENTS  — all attached to #img-wrap
───────────────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
  var wrap = document.getElementById('img-wrap');
  if (!wrap) return;

  wrap.addEventListener('touchstart',  _onTouchStart,  { passive: false });
  wrap.addEventListener('touchmove',   _onTouchMove,   { passive: false });
  wrap.addEventListener('touchend',    _onTouchEnd,    { passive: false });
  wrap.addEventListener('touchcancel', _onTouchCancel, { passive: true  });

  /* Desktop fallback */
  wrap.addEventListener('click', _onDesktopClick);

  /* Resize: re-init canvas position (img may have reflowed)               */
  window.addEventListener('resize', function() {
    _resetZoom();
    _pollInit();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   TOUCH START
───────────────────────────────────────────────────────────────────────────── */

function _onTouchStart(e) {
  if (e.touches.length === 1) {
    _t1 = e.touches[0];
    _t2 = null;
    _tapStartX = _t1.clientX;
    _tapStartY = _t1.clientY;
    _startDx   = _dx;
    _startDy   = _dy;
  }

  if (e.touches.length === 2) {
    _t1 = e.touches[0];
    _t2 = e.touches[1];
    _startDist  = _pinchDist(_t1, _t2);
    _startScale = _scale;
    _startDx    = _dx;
    _startDy    = _dy;

    /* Pinch midpoint in img-wrap coordinates                               */
    var wrap     = document.getElementById('img-wrap');
    var wRect    = wrap.getBoundingClientRect();
    _startMidX   = ((_t1.clientX + _t2.clientX) / 2) - wRect.left;
    _startMidY   = ((_t1.clientY + _t2.clientY) / 2) - wRect.top;
    _originX     = _startMidX;
    _originY     = _startMidY;
    e.preventDefault();   /* stop browser pinch-zoom */
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOUCH MOVE
───────────────────────────────────────────────────────────────────────────── */

function _onTouchMove(e) {
  /* ── Pinch zoom ── */
  if (e.touches.length === 2 && _t2) {
    e.preventDefault();
    var a = e.touches[0], b = e.touches[1];
    var dist = _pinchDist(a, b);
    var newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, _startScale * (dist / _startDist)));

    /* Pan: follow the midpoint movement                                   */
    var wrap  = document.getElementById('img-wrap');
    var wRect = wrap.getBoundingClientRect();
    var midX  = ((a.clientX + b.clientX) / 2) - wRect.left;
    var midY  = ((a.clientY + b.clientY) / 2) - wRect.top;
    var newDx = _startDx + (midX - _startMidX);
    var newDy = _startDy + (midY - _startMidY);

    _scale = newScale;
    _dx    = newDx;
    _dy    = newDy;
    _applyTransform();
    return;
  }

  /* ── Single-finger pan while zoomed ── */
  if (e.touches.length === 1 && _scale > 1.01) {
    e.preventDefault();
    var t   = e.touches[0];
    _dx = _startDx + (t.clientX - _tapStartX);
    _dy = _startDy + (t.clientY - _tapStartY);
    _applyTransform();
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   TOUCH END
───────────────────────────────────────────────────────────────────────────── */

function _onTouchEnd(e) {
  /* Ignore finger-lift during pinch                                        */
  if (_t2 !== null) {
    _t2 = null;
    return;
  }

  var touch  = e.changedTouches[0];
  var dx     = touch.clientX - _tapStartX;
  var dy     = touch.clientY - _tapStartY;
  var travel = Math.sqrt(dx*dx + dy*dy);
  var now    = Date.now();

  /* ── Double-tap → reset zoom ── */
  if (travel < TAP_MAX_MOVE && (now - _lastTapMs) < DBLTAP_MS) {
    _resetZoom();
    _lastTapMs = 0;
    return;
  }

  /* ── Swipe (only at scale ~1, no zoom) ── */
  if (_scale < 1.05 && Math.abs(dx) > SWIPE_MIN_X && Math.abs(dy) < SWIPE_MAX_Y) {
    if (dx < 0) Shiny.setInputValue('swipe_next', Date.now(), { priority: 'event' });
    else        Shiny.setInputValue('swipe_prev', Date.now(), { priority: 'event' });
    _lastTapMs = 0;
    return;
  }

  /* ── Tap → tile toggle ── */
  if (travel < TAP_MAX_MOVE) {
    _lastTapMs = now;
    /* Convert touch position to canvas-pixel space (pre-transform)        */
    var canvas  = document.getElementById('grid-canvas');
    if (!canvas) return;
    var cRect   = canvas.getBoundingClientRect();

    /* cRect gives the VISUAL (post-transform) position of the canvas.
       We need the pre-transform position within the canvas pixel buffer.
       Formula: subtract canvas visual origin, divide by current scale.    */
    var localX  = (touch.clientX - cRect.left)  / _scale;
    var localY  = (touch.clientY - cRect.top)   / _scale;

    _toggleTile(localX, localY);
  }
}

function _onTouchCancel() {
  _t1 = null;
  _t2 = null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   DESKTOP CLICK FALLBACK
───────────────────────────────────────────────────────────────────────────── */

function _onDesktopClick(e) {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  var cRect  = canvas.getBoundingClientRect();
  var localX = (e.clientX - cRect.left) / _scale;
  var localY = (e.clientY - cRect.top)  / _scale;
  _toggleTile(localX, localY);
}

/* ─────────────────────────────────────────────────────────────────────────────
   TRANSFORM HELPERS
───────────────────────────────────────────────────────────────────────────── */

function _applyTransform() {
  var img    = document.getElementById('bg-image');
  var canvas = document.getElementById('grid-canvas');
  if (!img || !canvas) return;

  /* Same transform applied to both img and canvas so they stay in sync.   */
  var t = 'translate(' + _dx + 'px,' + _dy + 'px) scale(' + _scale + ')';
  var o = _originX + 'px ' + _originY + 'px';
  img.style.transformOrigin    = o;
  img.style.transform          = t;
  canvas.style.transformOrigin = o;
  canvas.style.transform       = t;
}

function _resetZoom() {
  _scale = 1.0; _dx = 0; _dy = 0; _originX = 0; _originY = 0;
  var img    = document.getElementById('bg-image');
  var canvas = document.getElementById('grid-canvas');
  if (img)    { img.style.transform = '';    img.style.transformOrigin = ''; }
  if (canvas) { canvas.style.transform = ''; canvas.style.transformOrigin = ''; }
}

function _pinchDist(a, b) {
  var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
  return Math.sqrt(dx*dx + dy*dy);
}

/* ─────────────────────────────────────────────────────────────────────────────
   TILE TOGGLE & SHINY NOTIFY
───────────────────────────────────────────────────────────────────────────── */

function _toggleTile(px, py) {
  var hit = gridHitTile(px, py);
  if (!hit) return;
  var key = hit.row + ',' + hit.col;
  if (selectedTiles[key]) delete selectedTiles[key];
  else selectedTiles[key] = true;
  gridDraw();
  _notifyTiles();
}

function _notifyTiles() {
  Shiny.setInputValue(
    'selected_tiles',
    Object.keys(selectedTiles).map(function(k) {
      var p = k.split(',');
      return { row: +p[0]+1, col: +p[1]+1 };
    }),
    { priority: 'event' }
  );
}
