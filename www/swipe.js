(function () {
  var SWIPE_THRESHOLD = 60;   // px — tune here if needed
  var x0 = null;

  document.addEventListener('touchstart', function (e) {
    x0 = e.touches[0].clientX;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    x0 = null;

    if (dx < -SWIPE_THRESHOLD)
      Shiny.setInputValue('swipe_left',  Date.now(), { priority: 'event' });

    if (dx >  SWIPE_THRESHOLD)
      Shiny.setInputValue('swipe_right', Date.now(), { priority: 'event' });
  }, { passive: true });
})();
