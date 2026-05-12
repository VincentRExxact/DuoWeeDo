/* ─────────────────────────────────────────────────────────────────────────────
   events.js  —  Event management layer

   Depends on: grid.js  (gridAttach, gridDraw, gridRemove, gridClear,
                          gridHitTile, selectedTiles)

   Responsibilities:
     • Listen to Shiny messages from R (browser_opened, clear_tiles)
     • Detect PhotoBrowser slide changes and close
     • Detect tap on canvas → toggle tile → notify Shiny
     • Send events back to R via Shiny.setInputValue:
         photo_index_changed  → new slide index (0-based)
         browser_closed       → PhotoBrowser was dismissed
         selected_tiles       → current tile selection (1-based row/col)

   NO geometry here. NO drawing here. NO DOM canvas management here.
───────────────────────────────────────────────────────────────────────────── */

var _browserIsOpen = false;
var _tapStartX     = null;
var _tapStartY     = null;
var TAP_MAX_TRAVEL = 10;   /* px — above this it's a swipe, not a tap */

/* ─────────────────────────────────────────────────────────────────────────────
   SHINY → JS  (inbound messages from R)
───────────────────────────────────────────────────────────────────────────── */

/* R signals that the PhotoBrowser has been opened.
   Poll until the active slide img is painted, then attach and draw.         */
Shiny.addCustomMessageHandler('browser_opened', function(_msg) {
  _browserIsOpen = true;
  selectedTiles  = {};
  _pollUntilReady();
});

/* R asks to clear the tile selection.                                       */
Shiny.addCustomMessageHandler('clear_tiles', function(_msg) {
  gridClear();
  _notifyTiles();
});

/* ─────────────────────────────────────────────────────────────────────────────
   PHOTOBROWSER LIFECYCLE
───────────────────────────────────────────────────────────────────────────── */

/* Poll every 50 ms until gridAttach() succeeds (img is rendered),
   then draw the grid and hook PhotoBrowser DOM events.                      */
function _pollUntilReady() {
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    if (gridAttach()) {
      clearInterval(timer);
      gridDraw();
      _hookPhotoBrowserEvents();
    }
    if (attempts > 40) clearInterval(timer);   /* give up after ~2 s */
  }, 50);
}

/* Hook slide-change and close events on the PhotoBrowser DOM element.       */
function _hookPhotoBrowserEvents() {
  var pbEl = document.querySelector('.photo-browser');
  if (!pbEl) return;

  /* Slide changed: delegate to swiper instance for reliability */
  var swiperEl = pbEl.querySelector('.swiper');
  if (swiperEl && swiperEl.swiper) {
    swiperEl.swiper.on('slideChange', _onSlideChange);
  }

  /* PhotoBrowser closed: Framework7 fires popup:close on the element */
  pbEl.addEventListener('popup:close', _onBrowserClose);

  /* MutationObserver fallback — catches close even if the event name varies */
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

/* Called when the user swipes to a new slide.                               */
function _onSlideChange() {
  selectedTiles = {};
  /* Small delay so Framework7 finishes updating .swiper-slide-active       */
  setTimeout(function() {
    if (gridAttach()) gridDraw();
    _notifyTiles();

    var swiper = _getSwiper();
    if (swiper)
      Shiny.setInputValue('photo_index_changed', swiper.activeIndex, { priority: 'event' });
  }, 80);
}

/* Called when the PhotoBrowser is dismissed.                                */
function _onBrowserClose() {
  if (!_browserIsOpen) return;   /* guard against double-firing */
  _browserIsOpen = false;
  gridRemove();
  Shiny.setInputValue('browser_closed', Date.now(), { priority: 'event' });
}

function _getSwiper() {
  var el = document.querySelector('.photo-browser .swiper');
  return (el && el.swiper) ? el.swiper : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAP → TILE TOGGLE
───────────────────────────────────────────────────────────────────────────── */

/* Desktop click on the canvas */
document.addEventListener('click', function(e) {
  if (!_browserIsOpen || !e.target || e.target.id !== 'grid-canvas') return;
  var rect = e.target.getBoundingClientRect();
  _toggleTile(e.clientX - rect.left, e.clientY - rect.top);
});

/* Mobile touch — record start */
document.addEventListener('touchstart', function(e) {
  if (!_browserIsOpen) return;
  _tapStartX = e.touches[0].clientX;
  _tapStartY = e.touches[0].clientY;
}, { passive: true });

/* Mobile touch — on end, dispatch as tap if travel is small */
document.addEventListener('touchend', function(e) {
  if (!_browserIsOpen || _tapStartX === null) return;

  var touch = e.changedTouches[0];
  var dx    = touch.clientX - _tapStartX;
  var dy    = touch.clientY - _tapStartY;
  _tapStartX = _tapStartY = null;

  if (Math.sqrt(dx*dx + dy*dy) > TAP_MAX_TRAVEL) return;  /* was a swipe */

  /* Check the touch landed on the canvas */
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var px   = touch.clientX - rect.left;
  var py   = touch.clientY - rect.top;
  if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;

  _toggleTile(px, py);
}, { passive: true });

/* ─────────────────────────────────────────────────────────────────────────────
   INTERNAL HELPERS
───────────────────────────────────────────────────────────────────────────── */

/* Toggle the tile at canvas-pixel (px, py) and notify Shiny.               */
function _toggleTile(px, py) {
  var hit = gridHitTile(px, py);
  if (!hit) return;

  var key = hit.row + ',' + hit.col;
  if (selectedTiles[key]) delete selectedTiles[key];
  else selectedTiles[key] = true;

  gridDraw();
  _notifyTiles();
}

/* Push current selectedTiles to R (converts to 1-based row/col).           */
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
