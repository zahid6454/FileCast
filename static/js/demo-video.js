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
  // idx: most recent navigation TARGET — updated the instant a nav action
  // fires, so a rapid run of clicks (1 -> 3 -> 2 ...) always ends up
  // pointed at whichever one the visitor clicked last, even before any of
  // the in-between transitions have actually landed.
  // playingIdx: which slide is ACTUALLY loaded in <video> right now —
  // updated only once its swap() lands. 'timeupdate'/'ended' are tied to
  // the real element, so they must key off this one, not the aspirational
  // idx above (which can be several clicks ahead of what's really playing).
  var idx = 0;
  var playingIdx = 0;

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
        video.play().catch(function () {});
      });
    },
    { rootMargin: '200px' }
  );
  observer.observe(video);

  // ---- Carousel: badge/caption/step-label/story-strip swap in place around
  // the one <video> element above, driven by the JSON data island home.html
  // embeds (id/name/cloud/video/caption/firstStep per tool, in display order).
  var contentEls = document.querySelectorAll('.demo-panel__content');
  var titleEl = document.querySelector('.demo-panel__title');
  var badgeRow = document.querySelector('.demo-panel__badge-row');
  var caption = document.querySelector('.demo-panel__caption');
  var firstStepLabel = document.querySelector('.demo-panel__steps .demo-panel__step-label');
  var storySegs = document.querySelectorAll('.demo-panel__story-seg');
  var prevBtn = document.querySelector('[data-action="prev"]');
  var nextBtn = document.querySelector('[data-action="next"]');

  function badgeHtml(slide) {
    // Mirrors _macros.html's processing_pill(tool) verbatim — that macro
    // only runs at build time, so a slide swap re-creates its markup here.
    return slide.cloud
      ? '<span class="badge--cloud" title="Secure server processing — your file is deleted immediately." aria-label="Cloud processing: secure server processing, your file is deleted immediately."><svg class="badge__icon" aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg>Cloud</span>'
      : '<span class="badge--local" title="Runs entirely in your browser." aria-label="Local processing: runs entirely in your browser."><svg class="badge__icon" aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Local</span>';
  }

  function setStoryFill(i, pct) {
    var fill = storySegs[i] && storySegs[i].querySelector('i');
    if (fill) fill.style.width = pct * 100 + '%';
  }

  // Seeking to (or within a hair of) the clip's real end while playing makes
  // the browser fire 'ended' almost immediately — which is correct once the
  // clip has actually finished, but forward-5 or a story-bar click near the
  // right edge would otherwise trigger the SAME auto-advance from a seek the
  // visitor never meant as "I'm done watching this one," reading as the demo
  // randomly jumping away. Capping every manual seek a beat before the true
  // end leaves the natural, played-through-to-the-end case as the only path
  // to 'ended'.
  var SEEK_END_MARGIN = 0.5;
  function seekTo(t) {
    ensureLoaded();
    var duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    var cap = Number.isFinite(duration) ? Math.max(0, duration - SEEK_END_MARGIN) : Infinity;
    video.currentTime = Math.max(0, Math.min(cap, t));
  }

  // Swaps text/badge/step-label and points the video at the new clip —
  // playback itself (ensureLoaded + play) is the caller's job, since an
  // auto-advance under prefers-reduced-motion applies the slide without
  // starting it.
  function applySlide(i) {
    var s = slides[i];
    if (titleEl) titleEl.textContent = s.name;
    if (badgeRow) badgeRow.innerHTML = badgeHtml(s);
    if (caption) caption.textContent = s.caption;
    if (firstStepLabel) firstStepLabel.textContent = s.firstStep;
    storySegs.forEach(function (seg, j) {
      seg.classList.toggle('is-active', j === i);
      setStoryFill(j, 0);
    });
    video.dataset.src = s.video;
    loaded = false;
  }

  // Manual navigation (prev/next/segment click) always restarts the target
  // clip at 0 and plays immediately, regardless of prefers-reduced-motion —
  // same as the existing play button already ignoring it for a direct user
  // action. An 'ended'-triggered advance (nobody asked for this one) instead
  // respects prefers-reduced-motion: the slide still changes, but nothing
  // starts playing on its own.
  //
  // A switchToken guards the delayed swap(): jumping again (e.g. 1 -> 3 -> 2
  // in quick succession) before an earlier swap fires must skip that stale
  // swap entirely rather than briefly apply slide 3 before slide 2
  // supersedes it.
  var switchToken = 0;
  function goTo(next, userInitiated) {
    idx = ((next % slides.length) + slides.length) % slides.length;
    var target = idx;
    var shouldPlay = userInitiated || !reduceMotion;
    var token = ++switchToken;

    function swap() {
      if (token !== switchToken) return;
      playingIdx = target;
      applySlide(target);
      ensureLoaded();
      video.currentTime = 0;
      if (shouldPlay) video.play().catch(function () {});
      contentEls.forEach(function (el) {
        el.classList.remove('is-switching');
      });
    }

    if (reduceMotion) {
      swap();
      return;
    }
    contentEls.forEach(function (el) {
      el.classList.add('is-switching');
    });
    window.setTimeout(swap, 180);
  }

  video.addEventListener('ended', function () {
    goTo(playingIdx + 1, false);
  });
  video.addEventListener('timeupdate', function () {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    setStoryFill(playingIdx, video.currentTime / video.duration);
  });

  // Clicking the segment for the tool already playing seeks within that clip
  // (click position -> that fraction of its duration), the same as scrubbing
  // a normal video's progress bar. Clicking any other segment jumps straight
  // to that tool instead.
  //
  // The seek branch requires BOTH idx and playingIdx to already agree with
  // the clicked segment — i.e. no transition in flight — not just idx alone.
  // A click landing mid-transition (idx pointing at a still-pending target,
  // playingIdx still the outgoing clip) always falls through to goTo()
  // instead, even when it happens to match one of those two: seeking would
  // otherwise apply to whichever clip is ACTUALLY loaded right then, not the
  // one the click looked like it was aimed at, and worse — with idx alone
  // deciding it, a rapid multi-hop sequence (e.g. 1 -> 3 in quick
  // succession) could have its final click silently swallowed as a no-op
  // seek instead of registering as the intended jump, leaving an earlier,
  // already-superseded target as the one that actually lands.
  storySegs.forEach(function (seg, i) {
    seg.addEventListener('click', function (e) {
      if (i === idx && i === playingIdx) {
        var rect = seg.getBoundingClientRect();
        var pct =
          rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
        var duration = Number.isFinite(video.duration) ? video.duration : 0;
        seekTo(pct * duration);
        return;
      }
      goTo(i, true);
    });
  });
  if (prevBtn)
    prevBtn.addEventListener('click', function () {
      goTo(idx - 1, true);
    });
  if (nextBtn)
    nextBtn.addEventListener('click', function () {
      goTo(idx + 1, true);
    });

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
      seekTo((video.currentTime || 0) - 5);
    });
  }
  if (forwardBtn) {
    forwardBtn.addEventListener('click', function () {
      seekTo((video.currentTime || 0) + 5);
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
