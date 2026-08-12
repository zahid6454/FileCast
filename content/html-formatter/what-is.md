## What Is HTML Formatting?

Browsers don't care about whitespace in HTML — a page's markup can be minified to one dense line by a build tool or a CMS and still render identically. But minified markup is nearly impossible to read: nested `div`s, `span`s, and lists all run together with no visual structure.

Formatting adds consistent indentation so the element hierarchy is easy to follow by eye, without changing what the page renders.

### Why Format HTML?

Minified HTML is common — production builds strip whitespace to shave page weight, and copying markup from "View Source" or a browser's dev tools often loses its original indentation. When you need to actually read the structure, debug a layout issue, or document a snippet, formatting turns it back into something scannable.

### How This Tool Works

This formatter runs entirely in your browser. Paste your HTML into the text area, click Format, and get properly indented output instantly. Your data is never uploaded to any server — formatting happens locally on your device.
