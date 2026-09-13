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
    <div class="demo-panel__video-wrap">
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
        <button type="button" data-action="fullscreen" aria-label="Full screen">
          <svg><use href="#icon-maximize"></use></svg>
        </button>
      </div>
    </div>
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
});
