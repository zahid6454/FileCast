(function () {
  'use strict';
  var video = document.querySelector('.demo-panel__video');
  if (!video || !video.dataset.src) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var loaded = false;

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    video.src = video.dataset.src;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        ensureLoaded();
        if (reduceMotion) return;
        video.loop = true;
        video.play().catch(function () {});
      });
    },
    { rootMargin: '200px' }
  );
  observer.observe(video);

  // Real, focusable, non-hidden pause/rewind/forward buttons — WCAG 2.2.2
  // (Pause, Stop, Hide) needs a mechanism to stop an autoplaying loop that
  // runs past 5 seconds, and prefers-reduced-motion above only helps
  // visitors who've set that OS-level flag, not everyone.
  var controls = document.querySelector('.demo-panel__controls');
  if (!controls) return;

  var playBtn = controls.querySelector('[data-action="toggle"]');
  var backBtn = controls.querySelector('[data-action="back"]');
  var forwardBtn = controls.querySelector('[data-action="forward"]');
  var fullscreenBtn = controls.querySelector('[data-action="fullscreen"]');

  function setPlayIcon(isPlaying) {
    if (!playBtn) return;
    var use = playBtn.querySelector('use');
    var label = isPlaying ? 'Pause' : 'Play';
    if (use) use.setAttribute('href', '#icon-' + (isPlaying ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', label);
    playBtn.setAttribute('title', label);
  }

  video.addEventListener('play', function () {
    setPlayIcon(true);
  });
  video.addEventListener('pause', function () {
    setPlayIcon(false);
  });

  if (playBtn) {
    playBtn.addEventListener('click', function () {
      ensureLoaded();
      if (video.paused) {
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    });
  }
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      ensureLoaded();
      video.currentTime = Math.max(0, (video.currentTime || 0) - 5);
    });
  }
  if (forwardBtn) {
    forwardBtn.addEventListener('click', function () {
      ensureLoaded();
      var duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.min(duration, (video.currentTime || 0) + 5);
    });
  }
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function () {
      if (video.requestFullscreen) video.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iOS Safari
    });
  }
})();
