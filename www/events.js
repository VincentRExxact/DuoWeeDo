/* ─────────────────────────────────────────────────────────────────────────────
   events.js  —  PhotoBrowser lifecycle + tile tap
   Depends on: grid.js

   Key design:
     • Canvas is injected INSIDE the active slide img's container.
     • This means it overlays only the photo area — not the whole app.
     • Shiny buttons outside the PhotoBrowser remain fully accessible.
     • On slide change: canvas moves to the new active slide.
     • On close: canvas is removed from DOM entirely.
───────────────────────────────────────────────────────────────────────────── */

var browserIsOpen  = false;
var TAP_MAX_TRAVEL = 10;   /* px — above this it's a swipe, not a tap */
var tapStartX = null, tapStartY = null;

/* ─────────────────────────────────────────────────────────────────────────────
   R → JS: PhotoBrowser just opened
   We poll for the active slide img — it may take a few frames to appear.
───────────────────────────────────────────────────────────────────────────── */
Shiny.addCustomMessageHandler('browser_opened', function(_msg) {
  selectedTiles  = {};
  browserIsOpen  = true;
  waitForSlideAndAttach();
});

/* Poll until the active slide img is rendered, then attach canvas. */
function waitForSlideAndAttach() {
  var attempts = 0;
  var timer = setInterval(function() {
    attempts++;
    var ok = attachCanvasToSlide();
    if (ok) {
      clearInterval(timer);
      drawGrid();
      hookPhotoBrowserEvents();
    }
    if (attempts > 40) clearInterval(timer);  /* give up after ~2 s */
  }, 50);
}

/* ─────────────────────────────────────────────────────────────────────────────
   HOOK INTO FRAMEWORK7 PHOTOBROWSER EVENTS
   We listen directly on the DOM for Framework7's custom events, which are
   more reliable than trying to access the app instance programmatically.
───────────────────────────────────────────────────────────────────────────── */
function hookPhotoBrowserEvents() {
  /* The PhotoBrowser popup/standalone element */
  var pbEl = document.querySelector('.photo-browser');
  if (!pbEl) return;

  /* Slide changed — move canvas to new active slide */
  pbEl.addEventListener('slidechange', onSlideChange);
  pbEl.addEventListener('swiperslidechange', onSlideChange);

  /* Also hook the inner swiper element directly */
  var swiperEl = pbEl.querySelector('.swiper');
  if (swiperEl && swiperEl.swiper) {
    swiperEl.swiper.on('slideChange', onSlideChange);
  }

  /* PhotoBrowser closed */
  pbEl.addEventListener('popup:close',     onBrowserClose);
  pbEl.addEventListener('photobrowser:close', onBrowserClose);

  /* Fallback: watch for PhotoBrowser disappearing from DOM */
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.removedNodes.forEach(function(n) {
        if (n === pbEl || (n.querySelector && n.querySelector('.photo-browser'))) {
          onBrowserClose();
          observer.disconnect();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function onSlideChange() {
  selectedTiles = {};
  /* Small delay so Framework7 finishes moving the active slide class */
  setTimeout(function() {
    var ok = attachCanvasToSlide();
    if (ok) {
      drawGrid();
      notifyShiny();

      /* Report new index to R */
      var swiper = getSwiperInstance();
      if (swiper) {
        Shiny.setInputValue('photo_index_changed', swiper.activeIndex, { priority: 'event' });
      }
    }
  }, 80);
}

function onBrowserClose() {
  browserIsOpen = false;
  removeCanvas();
  Shiny.setInputValue('browser_closed', Date.now(), { priority: 'event' });
}

function getSwiperInstance() {
  var swiperEl = document.querySelector('.photo-browser .swiper, .photo-browser-swiper');
  return (swiperEl && swiperEl.swiper) ? swiperEl.swiper : null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAP → TILE TOGGLE
   Coordinates are relative to the canvas element (already positioned over img).
───────────────────────────────────────────────────────────────────────────── */

/* Desktop click — only on the canvas itself */
document.addEventListener('click', function(e) {
  if (!browserIsOpen || !_canvas) return;
  if (e.target !== _canvas) return;
  var rect = _canvas.getBoundingClientRect();
  toggleTile(e.clientX - rect.left, e.clientY - rect.top);
});

/* Mobile: touchstart records start position */
document.addEventListener('touchstart', function(e) {
  if (!browserIsOpen) return;
  tapStartX = e.touches[0].clientX;
  tapStartY = e.touches[0].clientY;
}, { passive: true });

/* Mobile: touchend — if travel small enough, treat as tap on canvas */
document.addEventListener('touchend', function(e) {
  if (!browserIsOpen || tapStartX === null) return;
  var touch = e.changedTouches[0];
  var dx = touch.clientX - tapStartX;
  var dy = touch.clientY - tapStartY;
  tapStartX = tapStartY = null;

  if (Math.sqrt(dx*dx + dy*dy) > TAP_MAX_TRAVEL) return;  /* was a swipe */
  if (!_canvas) return;

  /* Only act if touch landed on the canvas */
  var rect = _canvas.getBoundingClientRect();
  var px   = touch.clientX - rect.left;
  var py   = touch.clientY - rect.top;
  if (px < 0 || py < 0 || px > rect.width || py > rect.height) return;

  toggleTile(px, py);
}, { passive: true });

/* ─────────────────────────────────────────────────────────────────────────────
   TOGGLE TILE
───────────────────────────────────────────────────────────────────────────── */
function toggleTile(px, py) {
  var hit = hitTile(px, py);
  if (!hit) return;
  var key = hit.row + ',' + hit.col;
  selectedTiles[key] ? delete selectedTiles[key] : (selectedTiles[key] = true);
  drawGrid();
  notifyShiny();
}
