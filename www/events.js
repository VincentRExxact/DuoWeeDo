/* ─────────────────────────────────────────────────────────────────────────────
   events.js  —  PhotoBrowser lifecycle + tile tap interaction
   Depends on: grid.js  (selectedTiles, hitTile, drawGrid, notifyShiny)

   Responsibilities:
     1. Show/hide the canvas overlay when PhotoBrowser opens/closes
     2. Detect PhotoBrowser's internal slide change → notify R of new image index
     3. Detect PhotoBrowser close → notify R
     4. Handle tap on canvas → toggle tile (grid.js hit-test)

   NOT needed here (PhotoBrowser owns it natively):
     • Swipe left/right between images — Framework7 handles this
     • Image loading — PhotoBrowser loads images from the urls R provided
───────────────────────────────────────────────────────────────────────────── */

/* ── State ───────────────────────────────────────────────────────────────── */
var browserIsOpen = false;
var f7PhotoBrowserInstance = null;

/* ─────────────────────────────────────────────────────────────────────────────
   R → JS: PhotoBrowser has been opened by the server
   msg: { urls: [...], idx: 0-based current index }
───────────────────────────────────────────────────────────────────────────── */
Shiny.addCustomMessageHandler('browser_opened', function(msg) {
  selectedTiles = {};

  /* Wait one tick for Framework7 to finish mounting the PhotoBrowser DOM */
  setTimeout(function() {
    attachPhotoBrowserHooks();
    showCanvas();
  }, 300);
});

/* ─────────────────────────────────────────────────────────────────────────────
   R → JS: PhotoBrowser has been closed
───────────────────────────────────────────────────────────────────────────── */
Shiny.addCustomMessageHandler('browser_closed', function(_msg) {
  hideCanvas();
});

/* ─────────────────────────────────────────────────────────────────────────────
   FRAMEWORK7 PHOTOBROWSER HOOKS
   Framework7 exposes its instances on window.f7.photoBrowser.
   We hook into the swiper inside the PhotoBrowser to detect slide changes,
   and into the PhotoBrowser's close event to notify R.
───────────────────────────────────────────────────────────────────────────── */
function attachPhotoBrowserHooks() {
  /* Framework7 v6+: active instances are accessible via the app object */
  var app = window.app || (window.f7 && window.f7.app);
  if (!app) return;

  /* Find the most recently opened PhotoBrowser instance */
  var pb = app.photoBrowser && app.photoBrowser.instance;
  if (!pb) {
    /* Fallback: try grabbing it from the DOM swiper instance */
    var swiperEl = document.querySelector('.photo-browser-swiper-container .swiper');
    if (swiperEl && swiperEl.swiper) {
      hookSwiper(swiperEl.swiper);
    }
    return;
  }

  f7PhotoBrowserInstance = pb;
  browserIsOpen = true;

  /* Slide change → clear selection + tell R new index */
  if (pb.swiper) hookSwiper(pb.swiper);

  /* PhotoBrowser close */
  pb.on('close', function() {
    browserIsOpen = false;
    hideCanvas();
    Shiny.setInputValue('browser_closed', Date.now(), { priority: 'event' });
  });
}

function hookSwiper(swiper) {
  swiper.on('slideChange', function() {
    selectedTiles = {};
    drawGrid();
    notifyShiny();
    Shiny.setInputValue(
      'photo_index_changed',
      swiper.activeIndex,
      { priority: 'event' }
    );
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   CANVAS OVERLAY  show / hide / size
───────────────────────────────────────────────────────────────────────────── */
function showCanvas() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  canvas.style.display = 'block';
  canvas.style.pointerEvents = 'auto';   /* enable touch events */
  browserIsOpen = true;

  sizeCanvas();
  drawGrid();
}

function hideCanvas() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  canvas.style.display = 'none';
  canvas.style.pointerEvents = 'none';
  browserIsOpen = false;

  /* Clear state */
  selectedTiles = {};
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function sizeCanvas() {
  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', function() {
  if (browserIsOpen) { sizeCanvas(); drawGrid(); }
});

/* ─────────────────────────────────────────────────────────────────────────────
   TAP → TILE TOGGLE
   The canvas sits above the PhotoBrowser; we capture taps here and pass
   pixel coords to hitTile() from grid.js.
   We do NOT consume the event (no preventDefault) so Framework7 can still
   handle its own tap gestures (double-tap to zoom etc.) underneath.
───────────────────────────────────────────────────────────────────────────── */

/* Desktop click */
document.addEventListener('click', function(e) {
  if (!browserIsOpen) return;
  var canvas = document.getElementById('grid-canvas');
  if (!canvas || e.target !== canvas) return;
  toggleTile(e.clientX, e.clientY);
});

/* Mobile tap — distinguish from swipe by checking touch travel distance */
var tapStartX = null, tapStartY = null;
var TAP_MAX_TRAVEL = 10;   /* px — anything larger is a swipe, not a tap */

document.addEventListener('touchstart', function(e) {
  if (!browserIsOpen) return;
  tapStartX = e.touches[0].clientX;
  tapStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', function(e) {
  if (!browserIsOpen || tapStartX === null) return;

  var touch = e.changedTouches[0];
  var dx = touch.clientX - tapStartX;
  var dy = touch.clientY - tapStartY;
  tapStartX = tapStartY = null;

  /* Only treat as a tap if finger barely moved */
  if (Math.sqrt(dx*dx + dy*dy) > TAP_MAX_TRAVEL) return;

  var canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  toggleTile(touch.clientX, touch.clientY);
}, { passive: true });

/* ─────────────────────────────────────────────────────────────────────────────
   TOGGLE TILE  (shared by click and tap)
───────────────────────────────────────────────────────────────────────────── */
function toggleTile(px, py) {
  var hit = hitTile(px, py);
  if (!hit) return;

  var key = hit.row + ',' + hit.col;
  if (selectedTiles[key]) {
    delete selectedTiles[key];
  } else {
    selectedTiles[key] = true;
  }

  drawGrid();
  notifyShiny();
}
