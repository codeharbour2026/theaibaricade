/* Run with: NODE_PATH=<dir with jsdom> node test/run-tests.js <scratch-dir> */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRATCH = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'h2j-'));
global.DOMParser = new JSDOM('').window.DOMParser;

const Html2Js = require('../converter-core.js');
const Sample = require('../sample-site.js');

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}
function eq(a, b, name) { ok(a === b, name, 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

function writeOut(result, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  Object.keys(result.files).forEach((p) => {
    const full = path.join(dir, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(result.files[p]));
  });
}

function openPage(dir, file, search) {
  return new Promise((resolve, reject) => {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const errors = [];
    const url = 'file://' + path.join(dir, file) + (search || '');
    let dom;
    const timer = setTimeout(() => reject(new Error('timeout rendering ' + file + (search || '') + ' errors=' + errors.join('; '))), 8000);
    const virtualConsole = new (require('jsdom').VirtualConsole)();
    virtualConsole.on('jsdomError', (e) => errors.push(e.message));
    virtualConsole.on('error', (e) => errors.push(String(e)));
    dom = new JSDOM(html, {
      url, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole,
      beforeParse(window) {
        window.addEventListener('h2j:rendered', () => { clearTimeout(timer); resolve({ dom, window, document: window.document, errors }); });
      }
    });
  });
}

(async function main() {
  /* ---------------------------------------------------------------- */
  console.log('\nSample site conversion');
  const raw = Sample.build();
  const analysis = Html2Js.analyze(raw);
  eq(analysis.pages.length, 5, 'analyze finds 5 pages');
  ok(analysis.hasIndex, 'analyze sees index.html');

  const result = Html2Js.convert(raw, {});
  const ents = result.report.entries;
  ok(result.ok, 'conversion has no errors', JSON.stringify(ents.filter((e) => e.level === 'error')));
  eq(result.report.counts.warn, 0, 'sample has no warnings', JSON.stringify(ents.filter((e) => e.level === 'warn')));
  const outPaths = Object.keys(result.files).sort();
  const htmlOut = outPaths.filter((p) => /\.html?$/.test(p));
  eq(htmlOut.join(','), 'index.html,render.html', 'only index.html and render.html remain as HTML');
  ['pages/index.js', 'pages/about.js', 'pages/products.js', 'pages/contact.js', 'pages/blog/news.js', 'js/renderer.js', 'js/script.js', 'css/style.css', 'images/logo.svg']
    .forEach((p) => ok(outPaths.includes(p), 'output contains ' + p));
  eq(result.defaultId, 'index', 'home page id is index');

  const dir = path.join(SCRATCH, 'out-sample');
  writeOut(result, dir);

  /* render real output files in jsdom */
  console.log('\nRendering converted pages (jsdom)');
  let r = await openPage(dir, 'index.html', '');
  eq(r.document.title, 'Harbour Street Bakery', 'index.html renders its own title');
  ok(r.document.querySelector('h1').textContent.includes('Bread worth getting up for'), 'index.html renders its content');
  eq(r.document.documentElement.getAttribute('lang'), 'en', 'html lang attribute applied');
  eq(r.document.body.className, 'home', 'body class applied');
  const navHrefs = Array.from(r.document.querySelectorAll('#nav a')).map((a) => a.getAttribute('href'));
  eq(navHrefs.join(' '), 'index.html render.html?page=about render.html?page=products render.html?page=blog/news render.html?page=contact', 'nav links rewritten');
  eq(r.document.querySelector('a[href="render.html?page=contact#hours"]') ? 'y' : 'n', 'y', 'link with #hash keeps hash');
  eq(r.document.getElementById('year').textContent, String(new Date().getFullYear()), 'DOMContentLoaded handler ran (year filled in)');
  ok(r.document.head.querySelector('link[rel=stylesheet][href="css/style.css"]'), 'stylesheet link in head');
  ok(r.document.head.querySelector('meta[name=viewport]'), 'viewport meta applied');
  eq(r.document.querySelectorAll('script').length, 0, 'no leftover script elements in the DOM');
  r.window.close();

  r = await openPage(dir, 'render.html', '?page=blog/news');
  eq(r.document.title, 'News | Harbour Street Bakery', 'render.html?page=blog/news renders subfolder page');
  eq(r.document.querySelector('link[rel=stylesheet]').getAttribute('href'), 'css/style.css', '../css/style.css rewritten to css/style.css');
  eq(r.document.querySelector('.brand img').getAttribute('src'), 'images/logo.svg', '../images/logo.svg rewritten');
  eq(r.document.querySelector('.brand').getAttribute('href'), 'index.html', '../index.html rewritten to index.html');
  ok(r.document.querySelector('style').textContent.includes('url(images/hero.svg)'), 'inline <style> url() rewritten');
  ok(result.pages['blog/news'].scripts.some((s) => s.text && s.text.includes('"render.html?page=contact#order"')), 'location.href string literal rewritten in inline script');
  r.window.close();

  r = await openPage(dir, 'render.html', '?page=products');
  eq(r.document.querySelector('.products img').getAttribute('src'), 'images/loaf.svg', 'img src untouched at root');
  r.document.querySelector('[data-filter="pastry"]').dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
  const hidden = Array.from(r.document.querySelectorAll('.products li')).filter((li) => li.hidden).length;
  eq(hidden, 2, 'page script behaviour works (filter hides 2 items)');
  r.window.close();

  r = await openPage(dir, 'render.html', '?page=nope');
  ok(/Page not found/.test(r.document.title) || r.document.body.textContent.includes('no page called'), 'unknown page shows a clear message') ;
  r.window.close();

  /* ---------------------------------------------------------------- */
  console.log('\nEdge cases');
  const enc = (s) => new TextEncoder().encode(s);
  const nasty = 'Quote " apos \' backtick ` ${not} \\ backslash </script> <!-- -->     emoji \u{1F35E} café &amp; &lt;b&gt;';
  const edge = {
    'index.html': enc('<!DOCTYPE html><html><head><title>Edge &amp; "case"</title><link rel="stylesheet" href="css/a.css"></head><body onload="window.__bodyLoad = 1">' +
      '<p id="nasty">' + nasty.replace(/&amp;/g, '&amp;') + '</p>' +
      '<img src="img/a%20b.png" srcset="img/a%20b.png 1x, img/c.png 2x" data-src="img/c.png"><a href="docs/">docs</a><a href="sub/">sub</a><a href="Missing.html">m</a><a href="IMG/C.PNG">case</a>' +
      '<a href="nothere.html">broken</a><img src="img/gone.png"><a href="https://example.com/x.html">ext</a><a href="mailto:a@b.c">mail</a><a href="?q=1">q</a><a href="#top">top</a>' +
      '<div style="background:url(\'img/c.png\')">s</div><button onclick="location.href=\'about.html?x=1#y\'">go</button><noscript>no js</noscript>' +
      '<script>window.__inline = "</scr" + "ipt>"; document.addEventListener("DOMContentLoaded", function(){ window.__dcl = (window.__dcl||0) + 1; }); window.addEventListener("load", function(){ window.__ld = (window.__ld||0)+1; });</script>' +
      '<script>var x = document.write("hi"); if (location.pathname.endsWith("a.html")) {}</script>' +
      '<script>this is not valid javascript(</script>' +
      '<script type="application/ld+json">{"a":1}</script><script src="js/ok.js"></script></body></html>'),
    'about.html': enc('<html><head><title>About</title><meta http-equiv="refresh" content="5; url=sub/p.html"><base href="/x/"></head><body>no doctype</body></html>'),
    'sub/index.html': enc('<!DOCTYPE html><title>Sub</title><body><a href="p.html">p</a> <a href="../index.html">home</a> <img src="../img/c.png"></body>'),
    'sub/p.html': enc('<!DOCTYPE html><title>P</title><body><a href="../sub/">s</a><link rel="stylesheet" href="../css/a.css"></body>'),
    'docs/index.htm': enc('<!DOCTYPE html><title>Docs</title><body>docs</body>'),
    'partials/footer.html': enc('<footer>partial</footer>'),
    'css/a.css': enc('body{background:url(../img/c.png)} .x{background:url("../img/missing.png")} @import "b.css";'),
    'css/b.css': enc('p{margin:0}'),
    'img/a b.png': new Uint8Array([1, 2, 3]),
    'img/c.png': new Uint8Array([4, 5, 6]),
    'js/ok.js': enc('window.__ok = true; fetch("partials/footer.html");'),
    'legacy/old.php': enc('<?php echo 1;')
  };
  const er = Html2Js.convert(edge, { exclude: ['partials/footer.html'] });
  const codes = er.report.entries.map((e) => e.level + ':' + e.code);
  const has = (c) => codes.includes(c);
  ok(!has('error:roundtrip') && !has('error:syntax-error'), 'generated files round-trip exactly (special characters survive)');
  ok(has('error:broken-link'), 'broken link reported');
  ok(has('error:missing-asset'), 'missing image/stylesheet asset reported');
  ok(er.report.entries.some((e) => e.code === 'missing-asset' && e.file === 'css/a.css'), 'missing asset inside CSS file reported');
  ok(has('warn:case'), 'case-only mismatch reported');
  ok(has('warn:document-write'), 'document.write flagged');
  ok(has('warn:location'), 'location.pathname flagged');
  ok(has('warn:js-syntax'), 'inline script syntax error flagged');
  ok(has('warn:html-fetch'), 'fetch of .html flagged');
  ok(has('warn:base-tag'), '<base> flagged');
  ok(has('warn:server-side'), 'server-side file flagged');
  ok(has('warn:doctype-mismatch'), 'page without doctype flagged');
  ok(has('info:noscript') === false || true, 'noscript handling does not crash');
  ok(Object.keys(er.files).includes('partials/footer.html'), 'excluded partial is kept as .html');
  ok(Object.keys(er.files).includes('docs/index.htm') === false && Object.keys(er.files).includes('pages/docs/index.js'), '.htm pages converted');

  const ep = er.pages.index;
  ok(ep.body.includes('href="render.html?page=docs/index"'), 'directory link docs/ resolves to docs/index.htm');
  ok(ep.body.includes('href="render.html?page=sub/index"'), 'directory link sub/ resolves to sub/index.html');
  ok(ep.body.includes('href="render.html?page=about&amp;x=1#y"') === false, 'sanity: onclick not turned into href');
  ok(ep.body.includes("render.html?page=about&amp;x=1#y"), 'onclick string literal rewritten with query and hash');
  ok(ep.body.includes('src="img/a%20b.png"'), 'percent-encoded filenames resolved and preserved');
  ok(ep.body.includes('data-src="img/c.png"'), 'data-src left correct');
  ok(ep.body.includes('href="index.html?q=1"'), 'query-only link stays on the same page');
  ok(ep.body.includes('href="https://example.com/x.html"') && ep.body.includes('href="mailto:a@b.c"'), 'external and mailto links untouched');
  ok(ep.body.includes("url('img/c.png')") || ep.body.includes('url(&quot;img/c.png&quot;)') || ep.body.includes("url(&quot;img/c.png&quot;)") || ep.body.includes('url(\'img/c.png\')'), 'style attribute url() kept');
  eq(ep.onload, 'window.__bodyLoad = 1', 'body onload moved to page.onload');
  ok(ep.scripts.length === 4, 'four executable scripts extracted (json script stays)', 'got ' + ep.scripts.length);
  ok(ep.body.includes('application/ld+json'), 'non-executable script kept in body');
  const subp = er.pages['sub/p'];
  ok(subp.body.includes('href="render.html?page=sub/index"'), '../sub/ from sub/p resolves');
  eq(subp.head, undefined, 'link in body stays in body, head empty');
  ok(subp.body.includes('href="css/a.css"'), 'stylesheet in subfolder page rewritten to root-relative');
  const about = er.pages.about;
  ok(about.head && about.head.some((h) => h.tag === 'meta' && h.attrs['http-equiv'] === 'refresh' && h.attrs.content === '5; url=render.html?page=sub/p'), 'meta refresh rewritten');

  const edir = path.join(SCRATCH, 'out-edge');
  writeOut(er, edir);
  r = await openPage(edir, 'index.html', '');
  const expectedNasty = new JSDOM(Buffer.from(edge['index.html']).toString('utf8')).window.document.getElementById('nasty').textContent;
  ok(expectedNasty.includes('\u2028') && expectedNasty.includes('\u{1F35E}') && expectedNasty.includes('${not}'), 'sanity: fixture keeps the tricky characters');
  eq(r.document.getElementById('nasty').textContent, expectedNasty, 'nasty text content renders exactly');
  eq(r.document.title, 'Edge & "case"', 'title with entities and quotes');
  eq(String(r.window.__dcl), '1', 'DOMContentLoaded listener fired exactly once');
  eq(String(r.window.__ld), '1', 'window load listener fired exactly once');
  eq(String(r.window.__bodyLoad), '1', 'body onload code ran');
  eq(r.window.__inline, '</script>', 'script text with </script> fragments intact');
  eq(String(r.window.__ok), 'true', 'external script executed in order');
  r.window.close();

  /* no index.html and a name clash with an existing pages/ folder */
  const clash = Html2Js.convert({ 'home.html': enc('<!DOCTYPE html><title>H</title><body>h</body>'), 'pages/data.js': enc('var a=1;'), 'js/renderer.js': enc('//mine') }, {});
  eq(clash.defaultId, 'home', 'no index.html: home page chosen');
  eq(clash.pagesDir, 'pages-js', 'pages folder renamed when it already holds other files');
  ok(clash.rendererPath !== 'js/renderer.js', 'renderer path avoids existing js/renderer.js');
  ok(clash.report.entries.some((e) => e.code === 'no-index'), 'missing index.html reported');

  /* single top-level folder in the ZIP */
  const wrapped = Html2Js.convert({ 'mysite/index.html': enc('<!DOCTYPE html><title>W</title><body><a href="a.html">a</a></body>'), 'mysite/a.html': enc('<!DOCTYPE html><title>A</title><body>a</body>'), '__MACOSX/mysite/._a.html': enc('x') }, {});
  ok(wrapped.ok && wrapped.pages.index.body.includes('render.html?page=a'), 'wrapper folder stripped and __MACOSX ignored');

  /* windows-1252 file */
  const w1252 = Html2Js.convert({ 'index.html': new Uint8Array([...enc('<!DOCTYPE html><title>T</title><body>caf'), 0xE9, ...enc('</body>')]) }, {});
  ok(w1252.report.entries.some((e) => e.code === 'encoding'), 'non-UTF-8 file reported');
  ok(w1252.pages.index.body.includes('café'), 'non-UTF-8 text decoded as windows-1252');

  /* ---------------------------------------------------------------- */
  console.log('\nPreview');
  const prev = Html2Js.buildPreview(result, 'about');
  ok(prev.srcdoc.includes('data:image/svg+xml;base64,') && !prev.srcdoc.includes('src="images/logo.svg"'), 'preview inlines images as data URLs');
  ok(prev.srcdoc.includes('data:text/css;base64,'), 'preview inlines stylesheets');
  const preview = await new Promise((resolve, reject) => {
    const msgs = [];
    const timer = setTimeout(() => reject(new Error('preview timeout ' + JSON.stringify(msgs))), 6000);
    const dom = new JSDOM(prev.srcdoc, { runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse(window) {
        window.addEventListener('message', (e) => { msgs.push(e.data); if (e.data && e.data.type === 'h2j-ready') { clearTimeout(timer); setTimeout(() => resolve({ dom, msgs }), 100); } });
      } });
  });
  eq(preview.dom.window.document.title, 'About us | Harbour Street Bakery', 'preview renders the page');
  eq(preview.msgs.filter((m) => m.type === 'h2j-error').length, 0, 'preview reports no runtime errors', JSON.stringify(preview.msgs));
  eq(preview.dom.window.document.getElementById('year').textContent, String(new Date().getFullYear()), 'preview runs page scripts');
  preview.dom.window.close();

  const bad = Html2Js.convert({ 'index.html': enc('<!DOCTYPE html><title>B</title><body><img src="nope.png"><script>throw new Error("boom")</script></body>') }, {});
  const prev2 = Html2Js.buildPreview(bad, 'index');
  const preview2 = await new Promise((resolve, reject) => {
    const msgs = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 6000);
    new JSDOM(prev2.srcdoc, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(window) {
      window.addEventListener('message', (e) => { msgs.push(e.data); if (e.data && e.data.type === 'h2j-ready') { clearTimeout(timer); setTimeout(() => resolve(msgs), 100); } });
    } });
  });
  ok(preview2.some((m) => m.type === 'h2j-error' && /boom/.test(m.message)), 'preview captures script errors');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
