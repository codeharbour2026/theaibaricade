/* Drives the shipped standalone page in jsdom.
 * Run: NODE_PATH=<dir with jsdom,jszip> node test/ui-test.js <scratch-dir> */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');

const SCRATCH = process.argv[2] || require('os').tmpdir();
const file = path.join(__dirname, '..', 'dist', 'html-to-js-converter.html');
let passed = 0, failed = 0;
const ok = (c, n, x) => { if (c) { passed++; console.log('  ok   ' + n); } else { failed++; console.log('  FAIL ' + n + (x ? '\n         ' + x : '')); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 5000)) { const v = fn(); if (v) return v; await wait(25); }
  throw new Error('timed out waiting for ' + label);
}

(async function () {
  const errors = [];
  const vc = new (require('jsdom').VirtualConsole)();
  vc.on('jsdomError', (e) => errors.push(e.message));
  const blobs = [];
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    url: 'file://' + file, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.Element.prototype.scrollIntoView = function () {};
      w.scrollTo = function () {};
      w.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:test/' + blobs.length; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
      /* jsdom quirks: JSZip's setImmediate shim needs MessageEvent.source, which jsdom omits */
      w.setImmediate = setImmediate; w.clearImmediate = clearImmediate;
      /* jsdom does not run <iframe srcdoc>. Emulate it: boot the document in a nested window whose
         parent.postMessage reaches this window with the iframe as event.source, as browsers do. */
      Object.defineProperty(w.HTMLIFrameElement.prototype, 'srcdoc', {
        configurable: true,
        get() { return this.getAttribute('srcdoc'); },
        set(html) {
          this.setAttribute('srcdoc', html);
          const el = this;
          setTimeout(() => {
            const source = el.contentWindow;
            new JSDOM(html, {
              runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
              beforeParse(iw) {
                Object.defineProperty(iw, 'parent', { configurable: true, value: { postMessage(data) {
                  setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { data, source })), 0);
                } } });
              }
            });
          }, 0);
        }
      });
    }
  });
  const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);

  console.log('\nInterface');
  ok($('panel-upload') && !$('panel-upload').hidden, 'upload panel visible at start');
  ok($('panel-analyse').hidden && $('panel-result').hidden, 'analysis and result hidden at start');
  ok($('stages').children.length === 5 && $('stages').children[0].getAttribute('data-state') === 'current', 'five-stage rail, upload current');

  /* ---- upload a real ZIP built from the sample site ---- */
  const Sample = require('../sample-site.js');
  const zip = new JSZip();
  Object.keys(Sample.files).forEach((p) => zip.file('bakery/' + p, Sample.files[p]));
  zip.file('bakery/.DS_Store', 'x');
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const f = new w.File([buf], 'bakery.zip', { type: 'application/zip' });
  const input = $('zip-input');
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await until(() => !$('panel-analyse').hidden, 8000, 'analysis panel');
  ok($('page-rows').children.length === 5, 'five pages listed after uploading a ZIP', 'rows=' + $('page-rows').children.length);
  ok($('analyse-name').textContent === 'bakery', 'file name shown');
  ok(/5 pages/.test($('summary').textContent), 'summary counts pages', $('summary').textContent);
  ok($('stages').children[1].getAttribute('data-state') === 'current', 'rail moved to Analyse');
  ok($('btn-convert').textContent === 'Convert 5 pages', 'convert button names the page count');

  /* untick a page */
  const cbs = $('page-rows').querySelectorAll('input[type=checkbox]');
  cbs[1].checked = false; cbs[1].dispatchEvent(new w.Event('change'));
  ok($('btn-convert').textContent === 'Convert 4 pages', 'unticking a page updates the count');
  cbs[1].checked = true; cbs[1].dispatchEvent(new w.Event('change'));
  ok($('btn-convert').textContent === 'Convert 5 pages', 'ticking again restores it');
  ok($('page-rows').querySelector('input:disabled'), 'index.html checkbox is locked');

  /* ---- convert ---- */
  $('btn-convert').click();
  await until(() => !$('panel-result').hidden, 5000, 'result panel');
  ok($('banner').className.indexOf('ok') >= 0, 'banner is green for a clean conversion', $('banner').className + ' / ' + $('h-result').textContent);
  ok(/5 pages converted/.test($('banner-stats').textContent), 'stats line', $('banner-stats').textContent);
  ok($('stages').children[4].getAttribute('data-state') === 'current' && $('stages').children[3].getAttribute('data-state') === 'done', 'rail moved to Export');
  ok(!d.querySelector('#findings .badge.error') && !d.querySelector('#findings .badge.warn'), 'validation tab lists no errors or warnings');
  ok(/single top-level folder/.test($('findings').textContent), 'validation tab explains that the wrapper folder was removed');
  ok($('map-rows').children.length === 5, 'files tab lists converted pages');
  ok(/pages\/blog\/news\.js/.test($('tree').textContent) && /index\.html/.test($('tree').textContent), 'output tree shows structure');

  /* ---- preview tab ---- */
  $('tab-preview').click();
  ok(!$('view-preview').hidden && $('view-report').hidden, 'preview tab opens');
  const frame = $('preview-frame');
  ok(frame.getAttribute('srcdoc') && frame.getAttribute('srcdoc').indexOf('window.__pages') > 0, 'preview frame receives a self-contained document');
  ok(frame.getAttribute('sandbox') === 'allow-scripts allow-popups allow-forms', 'preview frame is sandboxed without same-origin');
  ok($('preview-page').options.length === 5, 'preview page picker lists every page');
  $('preview-page').value = 'about'; $('preview-page').dispatchEvent(new w.Event('change'));
  ok(frame.getAttribute('srcdoc').indexOf('About us') > 0, 'choosing a page loads it');
  d.querySelector('.seg button[data-device=phone]').click();
  ok($('stage').getAttribute('data-device') === 'phone', 'device toggle works');

  /* ---- browser check on every page ---- */
  $('tab-report').click();
  $('btn-runtime').click();
  await until(() => /Browser check finished/.test($('runtime-note').textContent), 20000, 'browser check');
  ok(/all 5 pages rendered without script errors/.test($('runtime-note').textContent), 'browser check passes on the sample', $('runtime-note').textContent);

  /* ---- download ---- */
  $('btn-download').click();
  await until(() => blobs.length > 0, 8000, 'zip blob');
  const arr = await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(Buffer.from(fr.result)); fr.readAsArrayBuffer(blobs[0]); });
  const outZip = await JSZip.loadAsync(arr);
  const names = Object.keys(outZip.files).filter((n) => !outZip.files[n].dir).sort();
  ok(names.includes('index.html') && names.includes('render.html') && names.includes('pages/about.js') && names.includes('js/renderer.js'), 'downloaded ZIP has the new structure', names.join(', '));
  ok(!names.some((n) => /\.html$/.test(n) && n !== 'index.html' && n !== 'render.html'), 'downloaded ZIP has no other HTML files');
  ok(!names.some((n) => /DS_Store/.test(n)), 'junk files left out');
  const idx = await outZip.file('index.html').async('string');
  ok(/data-page="index"/.test(idx) && /js\/renderer\.js/.test(idx), 'index.html is the entry shell');
  ok($('stages').children[4].getAttribute('data-state') === 'done', 'rail marks Export done');

  /* ---- reset ---- */
  $('btn-reset').click();
  ok($('panel-analyse').hidden && $('panel-result').hidden, 'start over returns to upload');

  /* ---- sample button ---- */
  $('btn-sample').click();
  await until(() => !$('panel-analyse').hidden, 3000, 'sample analysis');
  ok($('page-rows').children.length === 5, 'sample site loads');

  /* ---- a site with a broken script gets flagged by the browser check ---- */
  $('btn-reset').click();
  const bad = new JSZip();
  bad.file('index.html', '<!doctype html><title>Bad</title><body><h1>Hi</h1><a href="gone.html">gone</a><script>undefinedFunction()</script>');
  const badBuf = await bad.generateAsync({ type: 'nodebuffer' });
  Object.defineProperty(input, 'files', { value: [new w.File([badBuf], 'bad.zip', { type: 'application/zip' })], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await until(() => !$('panel-analyse').hidden, 5000, 'bad site analysis');
  $('btn-convert').click();
  await until(() => !$('panel-result').hidden, 5000, 'bad site result');
  ok($('banner').className.indexOf('err') >= 0 && /problem/.test($('h-result').textContent), 'banner turns red when a link is broken', $('h-result').textContent);
  ok(/Broken link: "gone\.html"/.test($('findings').textContent), 'broken link is listed with its file');
  $('btn-runtime').click();
  await until(() => /Browser check finished/.test($('runtime-note').textContent), 15000, 'bad browser check');
  ok(/JavaScript error/.test($('findings').textContent) && /undefinedFunction/.test($('findings').textContent), 'browser check reports the script error', $('runtime-note').textContent);
  d.querySelector('#chips .chip:nth-child(2)').click();
  ok(d.querySelectorAll('#findings .finding').length >= 2 && !/Note/.test($('findings').textContent), 'Errors filter shows only errors');

  /* ---- bad input ---- */
  $('btn-reset').click();
  const junk = new w.File([Buffer.from('not a zip')], 'x.zip', { type: 'application/zip' });
  Object.defineProperty(input, 'files', { value: [junk], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await until(() => /Could not open/.test($('upload-status').textContent), 4000, 'error message');
  ok($('upload-status').className.indexOf('err') >= 0, 'corrupt ZIP shows a clear error');
  const txt = new w.File([Buffer.from('hi')], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [txt], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  ok(/does not look like a ZIP/.test($('upload-status').textContent), 'non-ZIP file rejected with guidance');

  /* undefinedFunction() is the deliberate fault in the broken-site fixture above */
  const real = errors.filter((e) => !/Could not load|Not implemented|net::|ERR_|undefinedFunction/i.test(e));
  ok(real.length === 0, 'no uncaught script errors in the interface', real.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
