import { describe, expect, it, vi } from 'vitest';
import { createDom, evalScript } from './helpers.js';

// demo-video.js lazy-loads the homepage "See It In Action" panel: no <source>
// in the initial markup (build.py/home.html), just a data-src the script
// promotes to the real src once the panel scrolls into view, skipping
// autoplay/loop under prefers-reduced-motion. It also wires up the 3-button
// control bar (rewind 5s / play-pause / forward 5s) added for WCAG 2.2.2
// (Pause, Stop, Hide) — a real mechanism to stop the autoplaying, looping,
// >5s video, independent of prefers-reduced-motion (which only helps
// visitors who've set that OS-level flag).
//
// jsdom implements neither IntersectionObserver, window.matchMedia, nor a
// spec-compliant (Promise-returning, state-tracking) HTMLMediaElement, so
// all three are stood in for here — same pattern shared-page-grid.test.js
// uses for the browser APIs jsdom doesn't implement.

function panelHtml() {
  return `
    <video class="demo-panel__video" muted playsinline preload="none" data-src="/videos/docx-to-pdf-demo.mp4"></video>
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
    </div>
  `;
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
function mockVideoPlayback(win) {
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
  return { play, pause };
}

describe('demo-video.js (homepage lazy-loaded demo panel)', () => {
  it('does nothing if the panel is not on the page', () => {
    const dom = createDom('');
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, false);
    expect(() => evalScript(dom, 'demo-video.js')).not.toThrow();
  });

  it('sets the real src and autoplays+loops once visible, motion allowed', async () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, false);
    const { play } = mockVideoPlayback(dom.window);

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
    expect(video.loop).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sets the src but skips autoplay/loop under prefers-reduced-motion', async () => {
    const dom = createDom(panelHtml());
    mockIntersectionObserver(dom.window);
    mockMatchMedia(dom.window, true);
    const { play } = mockVideoPlayback(dom.window);

    evalScript(dom, 'demo-video.js');

    const video = dom.window.document.querySelector('.demo-panel__video');
    expect(video.src).toContain('/videos/docx-to-pdf-demo.mp4');
    expect(video.loop).toBe(false);
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
    mockVideoPlayback(dom.window);

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
});
