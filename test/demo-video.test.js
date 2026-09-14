import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// demo-video.js drives the homepage "See It In Action" carousel: one <video>
// element re-used across six tools, badge/caption/step-label swapped in
// place from a JSON data island (home.html's #demo-carousel-data, build.py's
// demo_tools). No <source> in the initial markup — a data-src the script
// promotes to the real src once the panel scrolls into view, skipping
// autoplay under prefers-reduced-motion. It also wires up the play/pause and
// fullscreen buttons — play/pause is the WCAG 2.2.2 (Pause, Stop, Hide)
// mechanism to stop the autoplaying video, independent of
// prefers-reduced-motion (which only helps visitors who've set that OS-level
// flag).
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
          <button type="button" data-action="toggle" aria-label="Play">
            <svg><use href="#icon-play"></use></svg>
          </button>
          <button type="button" data-action="fullscreen" aria-label="Full screen">
            <svg><use href="#icon-maximize"></use></svg>
          </button>
        </div>
      </div>
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
// actually exercised.
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

    it('jumping "next" repeatedly lands on the right slide each time', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, false);
      mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js');
      const nextBtn = dom.window.document.querySelector('[data-action="next"]');
      const video = dom.window.document.querySelector('.demo-panel__video');

      nextBtn.click(); // slide 0 -> 1
      nextBtn.click(); // slide 1 -> 2

      expect(video.src).toContain('/videos/heic-to-jpg-demo.mp4');
    });

    it('under motion allowed, a switch applies immediately and fades .demo-panel__content back in afterward', () => {
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
        // Applies synchronously — no pending/half-switched state to race against.
        expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
        contentEls.forEach((el) => {
          expect(el.classList.contains('is-switching')).toBe(true);
        });

        vi.advanceTimersByTime(0);

        contentEls.forEach((el) => {
          expect(el.classList.contains('is-switching')).toBe(false);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('the video ending auto-advances to the next slide and plays it, motion allowed', () => {
      const dom = createDom(panelHtml());
      mockIntersectionObserver(dom.window);
      mockMatchMedia(dom.window, false);
      const { play } = mockVideoPlayback(dom.window);

      evalScript(dom, 'demo-video.js'); // scrolled into view: loads + plays slide 0
      play.mockClear();

      const video = dom.window.document.querySelector('.demo-panel__video');
      video.dispatchEvent(new dom.window.Event('ended'));

      expect(video.src).toContain('/videos/csv-to-json-demo.mp4');
      expect(play).toHaveBeenCalledTimes(1);
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
  });
});
