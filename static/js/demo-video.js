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
  // Fullscreen target is the wrap (video + controls), not the bare video —
  // requestFullscreen() only carries the target element's own subtree into
  // fullscreen, and .demo-panel__controls is a sibling of <video>, not a
  // descendant. Fullscreening the video alone would strand the viewer with
  // no play/pause/rewind/exit UI at all once in fullscreen.
  var videoWrap = video.closest('.demo-panel__video-wrap') || video.parentElement;

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
      ensureLoaded();
      if (videoWrap.requestFullscreen) {
        videoWrap.requestFullscreen().catch(function () {});
      } else if (videoWrap.webkitRequestFullscreen) {
        videoWrap.webkitRequestFullscreen(); // older prefixed Safari/Chrome
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen(); // iOS Safari: video-only native fullscreen, no wrap support
      }
    });
  }
})();
