# HTML-to-JS Converter

Converts a static HTML website into a JavaScript-rendered one. Every page becomes a
`.js` file; only `index.html` and `render.html` remain as HTML. Everything runs in the
browser, so uploaded files never leave the computer.

## Using it

Open `html-to-js-converter.html` (standalone, works offline) or `index.html` (the same tool
as separate files). Then:

1. Drop in a ZIP of your site (or press **Try the sample site**).
2. Review the page list. Untick any page that should stay `.html`, such as fragments your
   scripts load with `fetch()`.
3. Press **Convert**. Check the **Validation** tab, use **Preview** to click around, and
   optionally run the **browser check**, which loads every page and reports script errors
   and files that fail to load.
4. **Download converted ZIP** and put it on any static host.

## What comes out

```
converted-website/
├── index.html        entry point; renders the home page
├── render.html       renders render.html?page=<name>
├── pages/            one .js file per original page (subfolders are kept)
│   ├── index.js
│   ├── about.js
│   └── blog/news.js
├── js/
│   ├── renderer.js   the runtime that builds each page
│   └── script.js     your own scripts, untouched
├── css/  images/ …   everything else, copied unchanged
```

A page file registers its content as data, so it loads with a plain `<script>` tag and works
from `file://` as well as from a server:

```js
(window.__pages = window.__pages || {})["about"] = {
  "source": "about.html",
  "title": "About us",
  "head": [ ... ],            // stylesheets, meta tags, inline <style>
  "body": [ "<header>...", "..." ].join("\n"),
  "scripts": [ { "attrs": { "src": "js/script.js" } } ]
};
```

Text is written as JSON strings (with `</`, U+2028 and U+2029 escaped), so quotes, backticks,
`${}`, `</script>` and emoji cannot break the file. Each generated file is evaluated during
conversion and compared with the original page; a mismatch is reported as an error.

## How the renderer works

`render.html?page=about` loads `pages/about.js`, applies the title, `<html>`/`<body>`
attributes and head elements, waits for stylesheets, inserts the body, then runs the
page's scripts in their original order.

- Page scripts that wait for `DOMContentLoaded`, `window.onload` or `<body onload>` still run.
- Anchors such as `#hours` are scrolled to after rendering.
- Globals for your scripts: `window.__PAGE__` (page name), `window.__PAGE_SOURCE__`
  (original file). A `h2j:rendered` event fires when the page is ready.
- An unknown page name shows a plain "Page not found" message with a link home.

## What gets rewritten

All paths now resolve from the site root, because every page is served from `render.html`.

- Links to pages, including `dir/` links that resolve to `dir/index.html`, query strings and `#anchors`:
  `about.html#team` becomes `render.html?page=about#team`; `index.html` stays `index.html`.
- `src`, `href`, `srcset`, `poster`, `data-src` and similar attributes, inline `style` attributes,
  `<style>` blocks, `<meta http-equiv="refresh">`, and Open Graph image tags. Pages in
  subfolders are re-based (`../css/style.css` becomes `css/style.css`).
- Page links written as string literals in inline scripts and event attributes
  (`location.href = "contact.html"`), unless you turn that option off.

## What gets reported (never silently dropped)

Errors: missing files and broken links (in pages and in CSS), framesets, generated-file problems.
Warnings: scripts that read `location.pathname`, use `document.write` or `document.currentScript`,
fetch `.html` files, or register service workers; links that only match when letter case is ignored;
`<base>` tags (removed); quirks-mode versus standards-mode differences; non-UTF-8 files; server-side
files (`.php`, `.asp`, ...); page links inside external `.js` files, which need a manual change.

## Known limits

- Content is delivered by JavaScript: no-JS visitors and many crawlers see an empty shell.
- Converting does not hide or secure the code.
- Preview runs in a sandboxed frame without storage and cannot serve files requested at runtime
  (`fetch`, XHR). Check the downloaded ZIP on a local web server before publishing.
- Inline `type="module"` scripts that wait for `DOMContentLoaded` may not fire (reported).

## Development

```
npm i jsdom jszip
node build.js                               # writes dist/html-to-js-converter.html
node test/run-tests.js <scratch-dir>        # engine: converts, then renders the output in jsdom
node test/ui-test.js <scratch-dir>          # drives dist/html-to-js-converter.html
```

`converter-core.js` has no UI or file-system dependency and also works in Node with jsdom
(`Html2Js.convert({ "index.html": Uint8Array, ... })`).
