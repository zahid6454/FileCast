(function () {
  'use strict';
  var video = document.querySelector('.demo-panel__video');
  if (!video) return;

  var dataEl = document.getElementById('demo-carousel-data');
  var slides = [];
  try {
    slides = dataEl ? JSON.parse(dataEl.textContent) : [];
  } catch (e) {
    slides = [];
  }
  if (!video.dataset.src || !slides.length) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var loaded = false;
  // idx is the ONLY index: which slide is targeted, loaded, and (once
  // metadata/play catch up) playing. goTo() below applies it synchronously,
  // so there's never a "pending" window where idx and what's actually in
  // the <video> element disagree.
  var idx = 0;

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    // The poster attribute isn't covered by preload="none" — browsers fetch
    // it eagerly regardless of scroll position, so the initial slide's
    // poster is deferred here via data-poster instead, applied only if
    // nothing has already set one (a goTo() before this ever runs — e.g. a
    // very fast click — already applied the TARGET slide's poster via
    // applySlide(), which this must not clobber back to slide 0's).
    if (!video.poster && video.dataset.poster) video.poster = video.dataset.poster;
    video.src = video.dataset.src;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        ensureLoaded();
        if (reduceMotion) return;
        video.play().catch(function () {});
      });
    },
    { rootMargin: '200px' }
  );
  observer.observe(video);

  // ---- Carousel: badge/caption swap in place around the one <video>
  // element above, driven by the JSON data island home.html embeds
  // (id/name/badgeHtml/video/poster/caption per tool, in display order).
  // badgeHtml is processing_pill(t) pre-rendered at build time by the same
  // macro the server-rendered first slide calls directly (see home.html),
  // so there's no second copy of that markup to keep in sync here. The
  // steps row's first label is a static "Upload" in the markup and never
  // changes per slide, so there's nothing here to keep in sync with it either.
  var contentEls = document.querySelectorAll('.demo-panel__content');
  var titleEl = document.querySelector('.demo-panel__title');
  var badgeRow = document.querySelector('.demo-panel__badge-row');
  var caption = document.querySelector('.demo-panel__caption');
  var prevBtn = document.querySelector('[data-action="prev"]');
  var nextBtn = document.querySelector('[data-action="next"]');

  // Swaps text/badge/step-label and points the video at the new clip —
  // playback itself (ensureLoaded + play) is the caller's job, since an
  // auto-advance under prefers-reduced-motion applies the slide without
  // starting it.
  function applySlide(i) {
    var s = slides[i];
    if (titleEl) titleEl.textContent = s.name;
    if (badgeRow) badgeRow.innerHTML = s.badgeHtml;
    if (caption) caption.textContent = s.caption;
    video.poster = s.poster;
    video.dataset.src = s.video;
    loaded = false;
  }

  // Manual navigation (prev/next) always restarts the target clip at 0 and
  // plays immediately, regardless of prefers-reduced-motion — same as the
  // existing play button already ignoring it for a direct user action. An
  // 'ended'-triggered advance (nobody asked for this one) instead respects
  // prefers-reduced-motion: the slide still changes, but nothing starts
  // playing on its own.
  //
  // Applies synchronously — idx, the content, and the loaded video src all
  // change together in one tick, so a click can never land on a half-applied
  // state. The fade is purely cosmetic (fade the new content IN over the
  // next couple of frames) and gates no logic; skipped entirely under
  // prefers-reduced-motion.
  function goTo(next, userInitiated) {
    idx = ((next % slides.length) + slides.length) % slides.length;
    var shouldPlay = userInitiated || !reduceMotion;

    if (!reduceMotion) {
      contentEls.forEach(function (el) {
        el.classList.add('is-switching');
      });
    }
    applySlide(idx);
    ensureLoaded();
    video.currentTime = 0;
    if (shouldPlay) video.play().catch(function () {});
    if (reduceMotion) return;
    // A macrotask, not the same tick: the class needs to actually paint at
    // opacity 0 (alongside the new content) before removing it, or the
    // add+remove collapses into one frame and the opacity transition never
    // has anything to animate from.
    window.setTimeout(function () {
      contentEls.forEach(function (el) {
        el.classList.remove('is-switching');
      });
    }, 0);
  }

  video.addEventListener('ended', function () {
    goTo(idx + 1, false);
  });

  if (prevBtn)
    prevBtn.addEventListener('click', function () {
      goTo(idx - 1, true);
    });
  if (nextBtn)
    nextBtn.addEventListener('click', function () {
      goTo(idx + 1, true);
    });

  // Real, focusable, non-hidden play/pause button — WCAG 2.2.2 (Pause, Stop,
  // Hide) needs a mechanism to stop an autoplaying loop that runs past 5
  // seconds, and prefers-reduced-motion above only helps visitors who've set
  // that OS-level flag, not everyone.
  var controls = document.querySelector('.demo-panel__controls');
  if (!controls) return;
  // Fullscreen target is the wrap (video + controls), not the bare video —
  // requestFullscreen() only carries the target element's own subtree into
  // fullscreen, and .demo-panel__controls is a sibling of <video>, not a
  // descendant. Fullscreening the video alone would strand the viewer with
  // no play/pause/exit UI at all once in fullscreen.
  var videoWrap = video.closest('.demo-panel__video-wrap') || video.parentElement;

  var playBtn = controls.querySelector('[data-action="toggle"]');
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
  if (fullscreenBtn) {
    function setFullscreenIcon(isFullscreen) {
      var use = fullscreenBtn.querySelector('use');
      var label = isFullscreen ? 'Exit full screen' : 'Full screen';
      if (use) use.setAttribute('href', '#icon-' + (isFullscreen ? 'minimize' : 'maximize'));
      fullscreenBtn.setAttribute('aria-label', label);
      fullscreenBtn.setAttribute('title', label);
    }
    // Driven by fullscreenchange, not set inline in the click handler below —
    // exiting via Esc (or the browser's own UI) never runs our click handler
    // at all, so that's the only reliable place to catch every way fullscreen
    // state can change and keep the icon/label honest.
    function onFullscreenChange() {
      var current = document.fullscreenElement || document.webkitFullscreenElement;
      setFullscreenIcon(current === videoWrap);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    fullscreenBtn.addEventListener('click', function () {
      // Toggle: a second click while already fullscreen must exit, not call
      // requestFullscreen() again (a no-op that leaves it stuck fullscreen —
      // the button otherwise only ever had an "enter" branch).
      var current = document.fullscreenElement || document.webkitFullscreenElement;
      if (current) {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
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
