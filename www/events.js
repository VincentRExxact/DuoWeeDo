/* ─────────────────────────────────────────────────────────────────────────────
   events.js  —  Event management layer

   Depends on: grid.js  (gridAttach, gridDraw, gridRemove, gridClear,
                          gridHitTile, selectedTiles)

   Mobile tap fix (two parts):
     1. _lastSlideIndex guard — Swiper fires slideChange even on tap snap-back
        (finger lifts without actually changing slide). We compare the new
        index to the last known one and ignore if equal.
     2. Canvas-direct touch listeners with capture:true — we attach touchstart
        and touchend directly on the canvas element (not document) so we
        intercept before Swiper's own handlers consume the event.

   Shiny inputs fired:
     selected_tiles       → current tile selection (1-based row/col)
     photo_index_changed  → new slide index (0-based) on real swipe
     browser_closed       → PhotoBrowser dismissed
───────────────────────────────────────────────────────────────────────────── */

var _browserIsOpen  = false;
var _tapStartX      = null;
var _tapStartY      = null;
var _lastSlideIndex = -1;   /* guard: only reset tiles on a real slide change */
var TAP_MAX_TRAVEL  = 10;   /* px — finger travel above which we treat as swipe */

/* ─────────────────────────────────────────────────────────────────────────────
   SHINY → JS
───────────────────────────────────────────────────────────────────────────── */

Shiny.addCustomMessageHandler('browser_opened', function(_msg) {
  _browserIsOpen  = true;
  _lastSlideIndex = 0;
  selectedTiles   = {};
  _pollUntilReady();
});

Shiny.addCustomMessageHandler('clear_tiles', function(_msg) {
  gridClear();
  _notifyTiles();
});

/* ─────────────────────────────────────────────────────────────────────────────
   PHOTOBROWSER LIFECYCLE
───────────────────────────────────────────────────────────────────────────── */

/* Poll every 50 ms until the active slide img is rendered.
   Then draw the grid, attach canvas touch listeners, hook F7 events.        */
function _pollUntilReady() {
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (gridAttach()) {
      clearInterval(timer);
      gridDraw();
      _attachCanvasTouchListeners();
      _hookPhotoBrowserEvents();
    }
    if (attempts > 40) clearInterval(timer);   /* give up after ~2 s */
  }, 50);
}

function _hookPhotoBrowserEvents() {
  var pbEl = document.querySelector('.photo-browser');
  if (!pbEl) return;

  /* Hook Swiper slideChange for real slide navigation                       */
  var swiperEl = pbEl.querySelector('.swiper');
  if (swiperEl && swiperEl.swiper) {
    swiperEl.swiper.on('slideChange', _onSlideChange);
  }

  /* PhotoBrowser close                                                       */
  pbEl.addEventListener('popup:close', _onBrowserClose);

  /* MutationObserver fallback in case popup:close doesn't fire              */
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.removedNodes.forEach(function(n) {
        if (n === pbEl || (n.querySelector && n.querySelector('.photo-browser'))) {
          _onBrowserClose();
          observer.disconnect();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* FIX 1 — guard against Swiper slideChange firing on tap snap-back.
   Swiper fires slideChange even when the user taps (finger down → up)
   without moving. The slide index stays the same — that's our signal.       */
function _onSlideChange() {
  var swiper = _getSwiper();
  var newIdx = swiper ? swiper.activeIndex : _lastSlideIndex;

  if (newIdx === _lastSlideIndex) return;   /* same index = snap-back, ignore */

  _lastSlideIndex = newIdx;
  selectedTiles   = {};

  setTimeout(function() {
    if (gridAttach()) {
      gridDraw();
      _attachCanvasTouchListeners();   /* re-attach on new slide's canvas     */
    }
    _notifyTiles();
    Shiny.setInputValue('photo_index_changed', newIdx, { priority: 'event' });
  }, 80);
}

function _onBrowserClose() {
  if (!_browserIsOpen) return;
  _browserIsOpen  = false;
  _lastSlideIndex = -1;
  gridRemove();
  Shiny.setInputValue('browser_closed', Date.now(), { priority: 'event' });
}

function _getSwiper() {
  var el = document.querySelector('.photo-browser .swiper');
  return (el && el.swiper) ? el.swiper : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAP → TILE TOGGLE

   FIX 2 — attach listeners directly on the canvas with capture:true.
   Listening on document means Swiper's handlers (also on document) may run
   first and stop propagation. Attaching on the canvas element with capture
   puts us first in the event chain, before Swiper sees the touch.
   We re-attach after each slide change (new canvas element each time).      */
function _attachCanvasTouchListeners() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas || canvas._tapListenersAttached) return;

  canvas.addEventListener('touchstart', function(e) {
    _tapStartX = e.touches[0].clientX;
    _tapStartY = e.touches[0].clientY;
  }, { passive: true, capture: true });

  canvas.addEventListener('touchend', function(e) {
    if (_tapStartX === null) return;

    var touch = e.changedTouches[0];
    var dx    = touch.clientX - _tapStartX;
    var dy    = touch.clientY - _tapStartY;
    _tapStartX = _tapStartY = null;

    if (Math.sqrt(dx*dx + dy*dy) > TAP_MAX_TRAVEL) return;  /* real swipe */

    /* Coordinates relative to canvas top-left (matches canvas pixel buffer) */
    var rect = canvas.getBoundingClientRect();
    var px   = touch.clientX - rect.left;
    var py   = touch.clientY - rect.top;

    _toggleTile(px, py);
  }, { passive: true, capture: true });

  /* Desktop fallback                                                         */
  canvas.addEventListener('click', function(e) {
    var rect = canvas.getBoundingClientRect();
    _toggleTile(e.clientX - rect.left, e.clientY - rect.top);
  });

  canvas._tapListenersAttached = true;   /* prevent duplicate attachment     */
}

/* ─────────────────────────────────────────────────────────────────────────────
   INTERNAL HELPERS
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
      return { row: +p[0] + 1, col: +p[1] + 1 };
    }),
    { priority: 'event' }
  );
}