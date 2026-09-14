import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// demo-video.js drives the homepage "See It In Action" carousel: one <video>
// element re-used across six tools, badge/caption/step-label/story-strip
// swapped in place from a JSON data island (home.html's #demo-carousel-data,
// built.py's demo_tools). No <source> in the initial markup — a data-src the
// script promotes to the real src once the panel scrolls into view, skipping
// autoplay under prefers-reduced-motion. It also wires up the 3-button
// control bar (rewind 5s / play-pause / forward 5s) added for WCAG 2.2.2
// (Pause, Stop, Hide) — a real mechanism to stop the autoplaying video,
// independent of prefers-reduced-motion (which only helps visitors who've
// set that OS-level flag).
//
// jsdom implements neither IntersectionObserver, window.matchMedia, nor a
// spec-compliant (Promise-returning, state-tracking) HTMLMediaElement, so
// all three are stood in for here — same pattern shared-page-grid.test.js
// uses for the browser APIs jsdom doesn't implement.

function slidesJson() {
  return JSON.stringify([
    {
      id: 'docx-to-pdf',
      name: 'DOCX to PDF Converter',
      cloud: true,
      video: '/videos/docx-to-pdf-demo.mp4',
      caption: 'Securely uploaded, converted, and deleted immediately.',
      firstStep: 'Upload'
    },
    {
      id: 'csv-to-json',
      name: 'CSV to JSON Converter',
      cloud: false,
      video: '/videos/csv-to-json-demo.mp4',
      caption: 'Processed entirely in your browser — nothing is uploaded.',
      firstStep: 'Select'
    },
    {
      id: 'heic-to-jpg',
      name: 'HEIC to JPG Converter',
      cloud: false,
      video: '/videos/heic-to-jpg-demo.mp4',
      caption: 'Processed entirely in your browser — nothing is uploaded.',
      firstStep: 'Select'
    }
  ]);
}

function panelHtml({ withData = true } = {}) {
  return `
    <div class="demo-panel__content">
      <p class="demo-panel__title">DOCX to PDF Converter</p>
      <div class="demo-panel__badge-row"><span class="badge--cloud">Cloud</span></div>
      <div class="demo-panel__video-wrap">
        <video class="demo-panel__video" muted playsinline preload="none" data-src="/videos/docx-to-pdf-demo.mp4"></video>
        <button type="button" data-action="prev" aria-label="Previous demo"></button>
        <button type="button" data-action="next" aria-label="Next demo"></button>
        <div class="demo-panel__controls">
          <button type="button" data-action="back" aria-label="Rewind 5 seconds">
            <svg><use href="#icon-rewind-5"></use></svg>
          </button>
          <button type="button" data-action="toggle" aria-label="Play">
            <svg><use href="#icon-play"></use></svg>
          </button>
          <button type="button" data-action="forward" aria-label="Forward 5 seconds">
            <svg><use href="#icon-forward-5"></use></svg>
          </button>
          <button type="button" data-action="fullscreen" aria-label="Full screen">
            <svg><use href="#icon-maximize"></use></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="demo-panel__story">
      <button type="button" class="demo-panel__story-seg is-active" data-index="0"><i></i></button>
      <button type="button" class="demo-panel__story-seg" data-index="1"><i></i></button>
      <button type="button" class="demo-panel__story-seg" data-index="2"><i></i></button>
    </div>
    <div class="demo-panel__content">
      <p class="demo-panel__caption">Securely uploaded, converted, and deleted immediately.</p>
      <div class="demo-panel__steps">
        <div class="demo-panel__step"><span class="demo-panel__step-label">Upload</span></div>
      </div>
    </div>
    ${withData ? `<script type="application/json" id="demo-carousel-data">${slidesJson()}</script>` : ''}
  `;
}

// jsdom's getBoundingClientRect() always returns an all-zero rect (no real
// layout engine) — stand in for a segment's real on-screen box so a seek
// click's (clientX - rect.left) / rect.width math has something to divide.
function mockRect(el, { left = 0, width = 100 } = {}) {
  el.getBoundingClientRect = () => ({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0
  });
}

// jsdom implements neither requestFullscreen nor webkitRequestFullscreen on
// any element — stand in for whichever one is under test.
function mockFullscreen(win, prop) {
  var fn = vi.fn(function () {
    return prop === 'requestFullscreen' ? Promise.resolve() : undefined;
  });
  win.Element.prototype[prop] = fn;
  return fn;
}

// jsdom has neither document.exitFullscreen nor a settable
// fullscreenElement — stands in for both so the toggle-to-exit branch (a
// second click while already fullscreen) is actually exercised. Real
// browsers set fullscreenElement themselves once requestFullscreen()
// resolves; this mock's requestFullscreen (above) doesn't, so a test drives
// it by hand between the "enter" and "exit" clicks.
function mockExitFullscreen(win) {
  var exitFullscreen = vi.fn(function () {
    win.document.__fullscreenElement = null;
    return Promise.resolve();
  });
  win.document.exitFullscreen = exitFullscreen;
  Object.defineProperty(win.document, 'fullscreenElement', {
    configurable: true,
    get: function () {
      return win.document.__fullscreenElement || null;
    }
  });
  return exitFullscreen;
}

// Fires "intersecting" synchronously on observe() — stands in for "the panel
// is already on-screen," the same simplification shared-page-grid.test.js's
// mockIntersectionObserver uses.
function mockIntersectionObserver(win) {
  win.IntersectionObserver = function (callback) {
    this.observe = function (target) {
      callback([{ isIntersecting: true, target: target }]);
    };
    this.disconnect = vi.fn();
  };
}

function mockMatchMedia(win, matches) {
  win.matchMedia = function () {
    return { matches: matches };
  };
}

// jsdom's play()/pause() are stubbed no-ops that never flip `.paused` or
// fire the 'play'/'pause' events real browsers do — this mock does both, so
// the source's setPlayIcon() wiring (which listens for those events) is
// actually exercised. duration defaults to a finite value so timeupdate-
// driven story-bar fill math (currentTime / duration) doesn't divide by NaN.
function mockVideoPlayback(win, { duration = 10 } = {}) {
  const play = vi.fn(function () {
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new win.Event('play'));
    return Promise.resolve();
  });
  const pause = vi.fn(function () {
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
    this.dispatchEvent(new win.Event('pause'));
  });
  win.HTMLMediaElement.prototype.play = play;
  win.HTMLMediaElement.prototype.pause = pause;
  Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: function () {
      return duration;
    }
  });
  return { play, pause };
}

describe('demo-video.js (homepage demo carousel)', () => {
  it('does nothing if the panel is not on the page', () => {
    const dom = createDom('');
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, false);
    expect(() => evalScript(dom, 'demo-video.js')).not.toThrow();
  });

  it('does nothing if there is no carousel data', () => {
    const dom = createDom(panelHtml({ withData: false }));
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, false);
    const { play } = mockVideoPlayback(dom.window);

    expect(() => evalScript(dom, 'demo-video.js')).not.toThrow();

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toBe('');
    expect(play).not.toHaveBeenCalled();
  });

  it('sets the real src and autoplays once visible, motion allowed — no loop, since ending advances instead', async () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, false);
    const { play } = mockVideoPlayback(dom.window);

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
    expect(video.loop).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sets the src but skips autoplay under prefers-reduced-motion', async () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    const { play } = mockVideoPlayback(dom.window);

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
    expect(play).not.toHaveBeenCalled();
  });

  it('play/pause button loads (if needed), plays, then pauses on toggle — updating its icon and label', () => {
    const dom = createDom(panelHtml());
    // Not yet on-screen: observer never fires, so the panel starts unloaded.
    dom.window.IntersectionObserver = function () {
      this.observe = function () {};
      this.disconnect = vi.fn();
    };
    mockMatchMedia(dom.window, false);
    mockVideoPlayback(dom.window);

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    const playBtn = dom.window.document.querySelector('[data-action="toggle"]');
    expect(video.src).toBe(''); // confirms it really was unloaded pre-click

    playBtn.click();
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
    expect(video.paused).toBe(false);
    expect(playBtn.getAttribute('aria-label')).toBe('Pause');
    expect(playBtn.querySelector('use').getAttribute('href')).toBe('#icon-pause');

    playBtn.click();
    expect(video.paused).toBe(true);
    expect(playBtn.getAttribute('aria-label')).toBe('Play');
    expect(playBtn.querySelector('use').getAttribute('href')).toBe('#icon-play');
  });

  it('rewind/forward buttons seek by 5 seconds, clamped at 0', () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true); // reduced motion: starts paused, currentTime 0
    mockVideoPlayback(dom.window, { duration: 20 }); // long enough that neither seek nears the end-margin below

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    const backBtn = dom.window.document.querySelector('[data-action="back"]');
    const forwardBtn = dom.window.document.querySelector('[data-action="forward"]');

    backBtn.click();
    expect(video.currentTime).toBe(0); // already at 0, must not go negative

    forwardBtn.click();
    expect(video.currentTime).toBe(5);

    forwardBtn.click();
    expect(video.currentTime).toBe(10);

    backBtn.click();
    expect(video.currentTime).toBe(5);
  });

  it('forward button stops half a second short of the true end, instead of landing exactly on it', () => {
    // Seeking a PLAYING video to exactly its duration fires 'ended' almost
    // immediately in real browsers — forward-5 must never do that on its
    // own; only actually playing out the clip should.
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    mockVideoPlayback(dom.window, { duration: 10 });

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    video.currentTime = 8;
    dom.window.document.querySelector('[data-action="forward"]').click();

    expect(video.currentTime).toBe(9.5); // 8 + 5 = 13, capped at duration(10) - 0.5
  });

  it('fullscreen button fullscreens the video-wrap (not the bare video), so the controls stay in the fullscreened subtree', () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    mockVideoPlayback(dom.window);
    const requestFullscreen = mockFullscreen(dom.window, 'requestFullscreen');

    evalScript(dom, 'demo-video.js');

    const wrap = dom.window.document.querySelector('.demo-panel__video-wrap');
    const fullscreenBtn = dom.window.document.querySelector('[data-action="fullscreen"]');
    fullscreenBtn.click();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen.mock.instances[0]).toBe(wrap);
  });

  it('a second click while already fullscreen exits instead of re-requesting fullscreen', () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    mockVideoPlayback(dom.window);
    const requestFullscreen = mockFullscreen(dom.window, 'requestFullscreen');
    const exitFullscreen = mockExitFullscreen(dom.window);

    evalScript(dom, 'demo-video.js');

    const wrap = dom.window.document.querySelector('.demo-panel__video-wrap');
    const fullscreenBtn = dom.window.document.querySelector('[data-action="fullscreen"]');

    fullscreenBtn.click();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    dom.window.document.__fullscreenElement = wrap; // simulate the browser having entered fullscreen

    fullscreenBtn.click();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).toHaveBeenCalledTimes(1); // must not be called again
  });

  it('updates its own icon/label on fullscreenchange, including exits the click handler never sees (Esc)', () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    mockVideoPlayback(dom.window);
    mockFullscreen(dom.window, 'requestFullscreen');
    mockExitFullscreen(dom.window);

    evalScript(dom, 'demo-video.js');

    const wrap = dom.window.document.querySelector('.demo-panel__video-wrap');
    const fullscreenBtn = dom.window.document.querySelector('[data-action="fullscreen"]');
    expect(fullscreenBtn.getAttribute('aria-label')).toBe('Full screen');
    expect(fullscreenBtn.querySelector('use').getAttribute('href')).toBe('#icon-maximize');

    // Entering: the click handler itself never touches the icon — only the
    // fullscreenchange listener does — so fire it by hand, same as a real
    // browser would once requestFullscreen() actually takes effect.
    dom.window.document.__fullscreenElement = wrap;
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    expect(fullscreenBtn.getAttribute('aria-label')).toBe('Exit full screen');
    expect(fullscreenBtn.querySelector('use').getAttribute('href')).toBe('#icon-minimize');

    // Exiting via Esc bypasses our click handler entirely (the browser
    // handles Esc itself) — only fullscreenchange firing on its own proves
    // the icon still reverts.
    dom.window.document.__fullscreenElement = null;
    dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
    expect(fullscreenBtn.getAttribute('aria-label')).toBe('Full screen');
    expect(fullscreenBtn.querySelector('use').getAttribute('href')).toBe('#icon-maximize');
  });

  it('fullscreen button loads the video first if it was never scrolled into view', () => {
    const dom = createDom(panelHtml());
    dom.window.IntersectionObserver = function () {
      this.observe = function () {};
      this.disconnect = vi.fn();
    };
    mockMatchMedia(dom.window, false);
    mockVideoPlayback(dom.window);
    mockFullscreen(dom.window, 'requestFullscreen');

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toBe('');

    dom.window.document.querySelector('[data-action="fullscreen"]').click();
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
  });

  it('falls back to prefixed webkitRequestFullscreen when requestFullscreen is unavailable', () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    mockVideoPlayback(dom.window);
    const webkitRequestFullscreen = mockFullscreen(dom.window, 'webkitRequestFullscreen');

    evalScript(dom, 'demo-video.js');

    dom.window.document.querySelector('[data-action="fullscreen"]').click();
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  describe('carousel: switching tools', () => {
    it('clicking "next" swaps badge/caption/step-label and restarts playback at the new clip, under reduced motion (synchronous swap)', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      const { play } = mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js');
      play.mockClear();

      dom.window.document.querySelector('[data-action="next"]').click();

      const video = dom.window.document.querySelector('.demo-panel__video');
      expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
      expect(video.currentTime).toBe(0);
      // Manual navigation always plays, even under reduced motion — a direct
      // user action, same as the play button ignoring it.
      expect(play).toHaveBeenCalledTimes(1);

      const title = dom.window.document.querySelector('.demo-panel__title');
      expect(title.textContent).toBe('CSV to JSON Converter');

      const caption = dom.window.document.querySelector('.demo-panel__caption');
      expect(caption.textContent).toBe('Processed entirely in your browser — nothing is uploaded.');

      const stepLabel = dom.window.document.querySelector('.demo-panel__step-label');
      expect(stepLabel.textContent).toBe('Select');

      const badge = dom.window.document.querySelector('.demo-panel__badge-row');
      expect(badge.innerHTML).toContain('badge--local');

      const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');
      expect(segs[0].classList.contains('is-active')).toBe(false);
      expect(segs[1].classList.contains('is-active')).toBe(true);
    });

    it('wraps prev from the first slide to the last', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js');
      dom.window.document.querySelector('[data-action="prev"]').click();

      const video = dom.window.document.querySelector('.demo-panel__video');
      expect(video.src).toContain('/videos/heic-to-jpg-demo.mp4');
    });

    it('clicking a story segment jumps straight to that slide', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js');
      dom.window.document.querySelectorAll('.demo-panel__story-seg')[1].click();

      const video = dom.window.document.querySelector('.demo-panel__video');
      expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
    });

    it('clicking the segment for the tool already playing seeks within it instead of switching slides', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      mockVideoPlayback(dom.window, { duration: 20 });

      evalScript(dom, 'demo-video.js');

      const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');
      mockRect(segs[0], { left: 0, width: 100 }); // slide 0 (docx-to-pdf) is the active one
      segs[0].dispatchEvent(new dom.window.MouseEvent('click', { clientX: 25, bubbles: true }));

      const video = dom.window.document.querySelector('.demo-panel__video');
      expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4'); // unchanged — no slide switch
      expect(video.currentTime).toBe(5); // 25% across a 20s clip

      const title = dom.window.document.querySelector('.demo-panel__title');
      expect(title.textContent).toBe('DOCX to PDF Converter'); // untouched by applySlide
    });

    it('under motion allowed, a switch fades .demo-panel__content out then back in around the swap', () => {
      vi.useFakeTimers();
      try {
        const dom = createDom(panelHtml());
        mockIntersectionObserver(dom.window);
        mockMatchMedia(dom.window, false);
        mockVideoPlayback(dom.window);

        evalScript(dom, 'demo-video.js');
        dom.window.document.querySelector('[data-action="next"]').click();

        const contentEls = dom.window.document.querySelectorAll('.demo-panel__content');
        const video = dom.window.document.querySelector('.demo-panel__video');
        contentEls.forEach((el) => {
          expect(el.classList.contains('is-switching')).toBe(true);
        });
        expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4'); // not swapped yet

        vi.advanceTimersByTime(180);

        contentEls.forEach((el) => {
          expect(el.classList.contains('is-switching')).toBe(false);
        });
        expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
      } finally {
        vi.useRealTimers();
      }
    });

    it('a timeupdate firing on the still-playing OLD clip during the fade window does not fill the segment being switched to', () => {
      // Regression: idx used to flip to the target immediately in goTo(),
      // before the 180ms fade/swap actually ran — so a 'timeupdate' from the
      // still-playing previous clip would paint the NEW segment with the
      // OLD clip's progress for a moment (reported as the story bar
      // "filling up to that point for a second" on an unrelated jump).
      vi.useFakeTimers();
      try {
        const dom = createDom(panelHtml());
        mockIntersectionObserver(dom.window);
        mockMatchMedia(dom.window, false);
        mockVideoPlayback(dom.window, { duration: 20 });

        evalScript(dom, 'demo-video.js');
        const video = dom.window.document.querySelector('.demo-panel__video');
        video.currentTime = 5; // slide 0 is a quarter through

        dom.window.document.querySelector('[data-action="next"]').click(); // -> slide 1, still mid-fade
        video.dispatchEvent(new dom.window.Event('timeupdate')); // stale event from the OLD (slide 0) clip

        const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');
        expect(segs[1].querySelector('i').style.width).not.toBe('25%'); // slide 0's ratio must not land on segment 1
        expect(segs[1].querySelector('i').style.width).toBe(''); // untouched until the real swap

        vi.advanceTimersByTime(180);
        expect(segs[1].querySelector('i').style.width).toBe('0%'); // swap() resets it properly
      } finally {
        vi.useRealTimers();
      }
    });

    it('jumping again before an in-flight switch lands (1 -> 3 -> 2) applies only the last target, not a flash of the middle one', () => {
      vi.useFakeTimers();
      try {
        const dom = createDom(panelHtml());
        mockIntersectionObserver(dom.window);
        mockMatchMedia(dom.window, false);
        mockVideoPlayback(dom.window);

        evalScript(dom, 'demo-video.js');
        const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');

        segs[1].click(); // slide 0 -> 1, fade starts (180ms pending)
        vi.advanceTimersByTime(90); // still mid-fade
        segs[2].click(); // redirect to slide 2 before slide 1 ever lands

        vi.advanceTimersByTime(90); // slide 1's original 180ms timer would fire around now
        const video = dom.window.document.querySelector('.demo-panel__video');
        expect(video.src).not.toContain('/videos/csv-to-json-demo.mp4'); // slide 1 must never have applied

        vi.advanceTimersByTime(90); // slide 2's own 180ms timer (from its own click) fires
        expect(video.src).toContain('/videos/heic-to-jpg-demo.mp4');
      } finally {
        vi.useRealTimers();
      }
    });

    it('rapid-fire clicks that end back on the slide already showing still register as a real re-jump, not a swallowed no-op', () => {
      // Regression: with only ONE index variable that updated at swap() time
      // (180ms later) instead of immediately, this exact case — settle on
      // slide 2, then jump 0 -> 1 -> 2 again before any of those transitions
      // land — saw its final click (2) mistaken for "already showing this
      // one, so scrub within it" (comparing against the stale, not-yet-
      // updated index), which never called goTo() at all. The truly-last
      // real navigation call ended up being the SECOND-to-last click (1),
      // so it silently landed on slide 1 instead of back on slide 2.
      vi.useFakeTimers();
      try {
        const dom = createDom(panelHtml());
        mockIntersectionObserver(dom.window);
        mockMatchMedia(dom.window, false); // motion allowed -> real 180ms fade window to race against
        mockVideoPlayback(dom.window);

        evalScript(dom, 'demo-video.js');
        const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');
        const video = dom.window.document.querySelector('.demo-panel__video');

        segs[2].click(); // slide 0 -> 2
        vi.advanceTimersByTime(180); // let it fully land: idx === playingIdx === 2 now

        segs[0].click(); // -> 0, pending
        segs[1].click(); // -> 1, pending (redirected before 0 landed)
        segs[2].click(); // -> 2 again, pending (redirected before 1 landed) — the click under test
        vi.advanceTimersByTime(180); // only the LAST of these three should ever actually apply

        expect(video.src).toContain('/videos/heic-to-jpg-demo.mp4'); // back on slide 2, not stuck on slide 1
        expect(video.currentTime).toBe(0); // a real re-jump restarts it, not a no-op
      } finally {
        vi.useRealTimers();
      }
    });

    it('the video ending auto-advances to the next slide and plays it, motion allowed (after the same fade delay a manual switch uses)', () => {
      vi.useFakeTimers();
      try {
        const dom = createDom(panelHtml());
        mockIntersectionObserver(dom.window);
        mockMatchMedia(dom.window, false);
        const { play } = mockVideoPlayback(dom.window);

        evalScript(dom, 'demo-video.js'); // scrolled into view: loads + plays slide 0
        play.mockClear();

        const video = dom.window.document.querySelector('.demo-panel__video');
        video.dispatchEvent(new dom.window.Event('ended'));
        vi.advanceTimersByTime(180);

        expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
        expect(play).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('under reduced motion, the video ending advances the slide but does not autoplay it', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      const { play } = mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js');
      play.mockClear();

      const video = dom.window.document.querySelector('.demo-panel__video');
      video.dispatchEvent(new dom.window.Event('ended'));

      expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
      expect(play).not.toHaveBeenCalled();
    });

    it("timeupdate fills only the active segment, as a fraction of that clip's own duration", () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, true);
      mockVideoPlayback(dom.window, { duration: 10 });

      evalScript(dom, 'demo-video.js');

      const video = dom.window.document.querySelector('.demo-panel__video');
      video.currentTime = 2.5;
      video.dispatchEvent(new dom.window.Event('timeupdate'));

      const segs = dom.window.document.querySelectorAll('.demo-panel__story-seg');
      expect(segs[0].querySelector('i').style.width).toBe('25%');
      // Never touched: it was never the active segment, and CSS (not inline
      // style) is what holds every segment at 0% until JS actively fills one.
      expect(segs[1].querySelector('i').style.width).toBe('');
    });
  });
});
