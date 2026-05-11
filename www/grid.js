/* ─────────────────────────────────────────────────────────────────────────────
   grid.js  —  Perspective trapezoid grid

   Référentiel unique :
     Le canvas est positionné en position:absolute sur l'img du slide.
     Son buffer pixel (canvas.width / canvas.height) est toujours égal
     à la taille rendue de l'img (rect.width / rect.height).
     Le CSS NE redimensionne PAS le canvas — aucun width/height en CSS.
     → dessin et hit-test utilisent tous les deux le même espace pixel.

   Géométrie :
     • Grille 8×8 fixe
     • Bord supérieur rétréci de TOP_MARGIN de chaque côté
     • Hauteur des lignes : série géométrique de ratio ROW_RATIO (bas→haut)
───────────────────────────────────────────────────────────────────────────── */

var G          = 8;
var TOP_MARGIN = 0.22;
var ROW_RATIO  = 0.9;

var selectedTiles = {};   /* "r,c" (0-based) → true */

/* ─────────────────────────────────────────────────────────────────────────────
   GÉOMÉTRIE
───────────────────────────────────────────────────────────────────────────── */

function computeVBoundaries() {
  var h0 = (1 - ROW_RATIO) / (1 - Math.pow(ROW_RATIO, G));
  var vs = [0];
  for (var r = 0; r < G; r++)
    vs.push(vs[r] + h0 * Math.pow(ROW_RATIO, r));
  return vs;
}

/* Interpolation bilinéaire dans le trapèze.
   u ∈ [0,1] gauche→droite,  v ∈ [0,1] bas→haut.
   Retourne {x, y} en pixels canvas.                                         */
function bilerp(W, H, u, v) {
  /* Coins du trapèze en pixels :
       bl (bas-gauche)  : (0,       H)
       br (bas-droite)  : (W,       H)
       tl (haut-gauche) : (W*m,     0)    m = TOP_MARGIN
       tr (haut-droite) : (W*(1-m), 0)                                       */
  var m = TOP_MARGIN;
  return {
    x: (1-u)*(1-v)*0     + u*(1-v)*W     + (1-u)*v*(W*m)     + u*v*(W*(1-m)),
    y: (1-u)*(1-v)*H     + u*(1-v)*H     + (1-u)*v*0         + u*v*0
  };
}

function tilePixelCorners(row, col, W, H, vs) {
  return {
    bl: bilerp(W, H, col/G,       vs[row]),
    br: bilerp(W, H, (col+1)/G,   vs[row]),
    tl: bilerp(W, H, col/G,       vs[row+1]),
    tr: bilerp(W, H, (col+1)/G,   vs[row+1])
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   GESTION DU CANVAS
───────────────────────────────────────────────────────────────────────────── */

var _canvas = null;

function getOrCreateCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.id = 'grid-canvas';
    /* IMPORTANT : PAS de width/height en CSS.
       Le buffer pixel défini par canvas.width/height dicte tout.
       position:absolute + top/left:0 aligne sur le coin de l'img.          */
    _canvas.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'z-index:9999',
      'touch-action:none',
      'pointer-events:auto'
    ].join(';');
  }
  return _canvas;
}

/* Trouve l'<img> dans le slide actif du PhotoBrowser. */
function getActiveSlideImg() {
  return document.querySelector(
    '.photo-browser .swiper-slide-active img,' +
    '.photo-browser-swiper .swiper-slide-active img'
  ) || null;
}

/* Attache le canvas au slide actif et le dimensionne sur l'img rendue.
   Retourne true seulement si l'img a une taille réelle > 0.                 */
function attachCanvasToSlide() {
  var img = getActiveSlideImg();
  if (!img) return false;

  /* Vérification clé : l'img doit être réellement rendue */
  var rect = img.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  var canvas = getOrCreateCanvas();

  /* Le parent de l'img doit être position:relative pour que
     notre canvas position:absolute s'aligne dessus.                         */
  var parent = img.parentElement;
  if (parent && getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  /* Placer le canvas dans le même parent que l'img */
  if (canvas.parentElement !== parent) {
    if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
    if (parent) parent.appendChild(canvas);
  }

  /* === RÉFÉRENTIEL UNIQUE ===
     canvas.width  et canvas.height = taille pixel rendue de l'img.
     Le CSS ne touche pas à la taille → buffer pixel = taille affichée.
     Tous les calculs (dessin + hit-test) utilisent ces dimensions.         */
  canvas.width  = Math.round(rect.width);
  canvas.height = Math.round(rect.height);

  /* Positionner le canvas exactement sur l'img (au cas où img n'est pas
     en top:0 left:0 dans son parent, ex: object-fit center)                */
  var parentRect = parent.getBoundingClientRect();
  canvas.style.left = Math.round(rect.left - parentRect.left) + 'px';
  canvas.style.top  = Math.round(rect.top  - parentRect.top)  + 'px';

  return true;
}

function removeCanvas() {
  if (_canvas && _canvas.parentElement) {
    _canvas.parentElement.removeChild(_canvas);
  }
  /* Pas de _canvas = null : on réutilise l'élément au prochain open */
}

/* ─────────────────────────────────────────────────────────────────────────────
   DESSIN
   W et H = canvas.width / canvas.height = référentiel pixel unique.
───────────────────────────────────────────────────────────────────────────── */

function drawGrid() {
  if (!_canvas) return;
  var W = _canvas.width;
  var H = _canvas.height;
  if (!W || !H) return;

  var ctx = _canvas.getContext('2d');
  var vs  = computeVBoundaries();
  ctx.clearRect(0, 0, W, H);

  /* 1 — Remplissage des tuiles sélectionnées */
  Object.keys(selectedTiles).forEach(function(key) {
    var rc = key.split(',');
    var p  = tilePixelCorners(+rc[0], +rc[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p.bl.x, p.bl.y); ctx.lineTo(p.br.x, p.br.y);
    ctx.lineTo(p.tr.x, p.tr.y); ctx.lineTo(p.tl.x, p.tl.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(109,206,160,0.35)';
    ctx.fill();
  });

  /* 2 — Lignes horizontales */
  ctx.strokeStyle = 'rgba(80,200,130,0.9)';
  ctx.lineWidth   = 1.5;
  for (var ri = 0; ri <= G; ri++) {
    ctx.beginPath();
    for (var ci = 0; ci <= G; ci++) {
      var pt = bilerp(W, H, ci/G, vs[ri]);
      ci === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }

  /* 3 — Lignes verticales */
  for (var ci2 = 0; ci2 <= G; ci2++) {
    ctx.beginPath();
    for (var ri2 = 0; ri2 <= G; ri2++) {
      var pt2 = bilerp(W, H, ci2/G, vs[ri2]);
      ri2 === 0 ? ctx.moveTo(pt2.x, pt2.y) : ctx.lineTo(pt2.x, pt2.y);
    }
    ctx.stroke();
  }

  /* 4 — Bordures des tuiles sélectionnées */
  ctx.strokeStyle = '#6dcea0';
  ctx.lineWidth   = 2.5;
  Object.keys(selectedTiles).forEach(function(key2) {
    var rc2 = key2.split(',');
    var p2  = tilePixelCorners(+rc2[0], +rc2[1], W, H, vs);
    ctx.beginPath();
    ctx.moveTo(p2.bl.x, p2.bl.y); ctx.lineTo(p2.br.x, p2.br.y);
    ctx.lineTo(p2.tr.x, p2.tr.y); ctx.lineTo(p2.tl.x, p2.tl.y);
    ctx.closePath();
    ctx.stroke();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   HIT-TEST
   px, py viennent de getBoundingClientRect() du canvas → même référentiel.
───────────────────────────────────────────────────────────────────────────── */

function cross2D(ax, ay, bx, by) { return ax * by - ay * bx; }

function pointInQuad(px, py, p) {
  var pts = [p.bl, p.tl, p.tr, p.br];   /* ordre CCW */
  for (var i = 0; i < 4; i++) {
    var a = pts[i], b = pts[(i+1)%4];
    if (cross2D(b.x-a.x, b.y-a.y, px-a.x, py-a.y) < 0) return false;
  }
  return true;
}

function hitTile(px, py) {
  if (!_canvas) return null;
  var W  = _canvas.width;
  var H  = _canvas.height;
  var vs = computeVBoundaries();
  for (var r = 0; r < G; r++)
    for (var c = 0; c < G; c++)
      if (pointInQuad(px, py, tilePixelCorners(r, c, W, H, vs)))
        return { row: r, col: c };
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   COMMUNICATION SHINY
───────────────────────────────────────────────────────────────────────────── */

function notifyShiny() {
  Shiny.setInputValue('selected_tiles',
    Object.keys(selectedTiles).map(function(k) {
      var p = k.split(',');
      return { row: +p[0]+1, col: +p[1]+1 };   /* 1-based pour R */
    }),
    { priority: 'event' }
  );
}

Shiny.addCustomMessageHandler('clear_tiles', function(_msg) {
  selectedTiles = {};
  drawGrid();
  notifyShiny();
});