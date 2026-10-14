/* HTML-to-JS Converter: interface. All work happens in the browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = { raw: null, name: '', analysis: null, excluded: {}, result: null, filter: 'all', downloaded: false };

  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      kids.forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    }
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }

  /* ---------------- progress rail ---------------- */
  var STAGES = ['Upload', 'Analyse', 'Convert', 'Validate', 'Export'];
  function setStage(current) {
    var rail = clear($('stages'));
    STAGES.forEach(function (name, i) {
      var st = i < current ? 'done' : (i === current ? 'current' : 'todo');
      rail.appendChild(h('li', { 'data-state': st, 'aria-current': st === 'current' ? 'step' : null },
        h('span', { class: 'dot', 'aria-hidden': 'true', text: st === 'done' ? '✓' : String(i + 1) }), name));
    });
  }

  /* ---------------- reading a ZIP ---------------- */
  function setUploadStatus(msg, isErr) {
    var s = $('upload-status'); s.textContent = msg; s.className = 'status' + (isErr ? ' err' : '');
  }
  function readZip(file) {
    setUploadStatus('Reading ' + file.name + '…');
    if (!/\.zip$/i.test(file.name) && file.type.indexOf('zip') < 0) { setUploadStatus('That does not look like a ZIP file. Compress your site folder into a .zip and try again.', true); return; }
    JSZip.loadAsync(file).then(function (zip) {
      var raw = {}, jobs = [];
      zip.forEach(function (path, entry) {
        if (entry.dir) return;
        jobs.push(entry.async('uint8array').then(function (b) { raw[path] = b; }));
      });
      return Promise.all(jobs).then(function () { return raw; });
    }).then(function (raw) {
      if (!Object.keys(raw).length) { setUploadStatus('The ZIP is empty.', true); return; }
      load(raw, file.name.replace(/\.zip$/i, ''));
    }).catch(function (err) {
      setUploadStatus('Could not open that ZIP: ' + (err && err.message ? err.message : err), true);
    });
  }

  function load(raw, name) {
    state.raw = raw; state.name = name || 'website'; state.excluded = {}; state.result = null; state.downloaded = false;
    state.analysis = Html2Js.analyze(raw);
    setUploadStatus('');
    $('panel-result').hidden = true;
    renderAnalysis();
    $('panel-analyse').hidden = false;
    setStage(1);
    $('panel-analyse').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- analysis view ---------------- */
  function renderAnalysis() {
    var a = state.analysis;
    $('analyse-name').textContent = state.name;
    var s = clear($('summary'));
    [['page', 'pages', a.counts.html], ['stylesheet', 'stylesheets', a.counts.css], ['script file', 'script files', a.counts.js],
      ['image', 'images', a.counts.image], ['other file', 'other files', a.counts.font + a.counts.media + a.counts.other]].forEach(function (x) {
      s.appendChild(h('li', null, h('b', { text: String(x[2]) }), ' ' + (x[2] === 1 ? x[0] : x[1])));
    });
    s.appendChild(h('li', null, h('b', { text: Html2Js.formatBytes(a.bytes) }), ' in total'));

    var rows = clear($('page-rows'));
    a.pages.forEach(function (p) {
      var locked = p.path === 'index.html';
      var cb = h('input', { type: 'checkbox', class: 'check', checked: !state.excluded[p.path], disabled: locked, 'aria-label': 'Convert ' + p.path,
        onchange: function () { state.excluded[p.path] = !cb.checked; syncConvert(); } });
      rows.appendChild(h('tr', null,
        h('td', null, cb),
        h('td', { class: 'path' }, p.path, p.frameset ? h('span', { class: 'tag warn', text: 'frameset' }) : null, locked ? h('span', { class: 'tag js', text: 'entry' }) : null),
        h('td', { class: 'title', text: p.title || '(no title)' }),
        h('td', { class: 'num', text: String(p.links) }), h('td', { class: 'num', text: String(p.scripts) }),
        h('td', { class: 'num', text: Html2Js.formatBytes(p.size) })));
    });
    if (!a.pages.length) rows.appendChild(h('tr', null, h('td', { colspan: '6', text: 'No .html or .htm files were found in this ZIP.' })));

    var notes = clear($('analyse-notes'));
    a.notes.forEach(function (n) { notes.appendChild(findingRow(n)); });
    syncConvert();
  }
  function syncConvert() {
    var a = state.analysis, n = a.pages.filter(function (p) { return !state.excluded[p.path]; }).length;
    $('btn-convert').textContent = n ? 'Convert ' + plural(n, 'page') : 'Convert pages';
    $('btn-convert').disabled = n === 0;
    var all = $('check-all');
    all.checked = n === a.pages.length; all.indeterminate = n > 0 && n < a.pages.length;
  }

  /* ---------------- conversion ---------------- */
  function runConvert() {
    var btn = $('btn-convert');
    btn.disabled = true; btn.textContent = 'Converting…';
    setTimeout(function () {
      var exclude = Object.keys(state.excluded).filter(function (p) { return state.excluded[p]; });
      var res;
      try {
        res = Html2Js.convert(state.raw, { pagesDir: $('opt-dir').value.trim() || 'pages', rewriteJsLiterals: $('opt-literals').checked, exclude: exclude });
      } catch (err) {
        btn.disabled = false; syncConvert();
        toast('Conversion failed: ' + (err && err.message ? err.message : err));
        return;
      }
      state.result = res; state.filter = 'all'; state.downloaded = false;
      frame.removeAttribute('data-loaded-for');
      $('runtime-note').textContent = '';
      syncConvert();
      renderResult();
      $('panel-result').hidden = false;
      setStage(res.stats.pages ? 4 : 2);
      selectTab('report');
      $('panel-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }

  /* ---------------- result: banner and report ---------------- */
  var RANK = { error: 0, warn: 1, info: 2 };
  function resort(entries) {
    var idx = entries.map(function (e, i) { return { e: e, i: i }; });
    idx.sort(function (a, b) { return (RANK[a.e.level] - RANK[b.e.level]) || (a.i - b.i); });
    return idx.map(function (x) { return x.e; });
  }
  function recount() {
    var c = { error: 0, warn: 0, info: 0 };
    state.result.report.entries.forEach(function (e) { c[e.level]++; });
    state.result.report.counts = c; state.result.ok = c.error === 0;
  }
  function renderResult() {
    var r = state.result, c = r.report.counts, banner = $('banner');
    var kind = !r.stats.pages ? 'err' : c.error ? 'err' : c.warn ? 'warn' : 'ok';
    banner.className = 'banner ' + kind;
    $('h-result').textContent = !r.stats.pages ? 'Nothing could be converted'
      : c.error ? 'Converted, with ' + plural(c.error, 'problem') + ' to fix'
      : c.warn ? 'Converted. ' + plural(c.warn, 'thing') + ' to review'
      : 'Converted cleanly';
    $('banner-stats').textContent = plural(r.stats.pages, 'page') + ' converted · ' + plural(r.stats.linksRewritten, 'page link') + ' and ' +
      plural(r.stats.resourcesRewritten, 'file reference') + ' updated · ' + plural(r.stats.scriptsMoved, 'script') + ' moved into the renderer';
    $('btn-download').disabled = !r.stats.pages;
    renderChips(); renderFindings(); renderPreviewControls(); renderFiles();
  }
  function findingRow(e) {
    return h('div', { class: 'finding' },
      h('span', { class: 'badge ' + e.level, text: e.level === 'warn' ? 'Warning' : e.level === 'error' ? 'Error' : 'Note' }),
      h('div', null, e.file ? h('div', { class: 'file', text: e.file }) : null, h('div', { class: 'msg', text: e.message })));
  }
  function renderChips() {
    var c = state.result.report.counts, total = c.error + c.warn + c.info, box = clear($('chips'));
    [['all', 'All', total], ['error', 'Errors', c.error], ['warn', 'Warnings', c.warn], ['info', 'Notes', c.info]].forEach(function (x) {
      box.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': state.filter === x[0] ? 'true' : 'false',
        onclick: function () { state.filter = x[0]; renderChips(); renderFindings(); } }, x[1] + ' ' + x[2]));
    });
    box.appendChild(h('span', { class: 'spacer' }));
    box.appendChild(h('button', { class: 'btn secondary small', type: 'button', id: 'btn-runtime', onclick: runtimeCheck }, 'Run browser check on every page'));
  }
  function renderFindings() {
    var entries = state.result.report.entries.filter(function (e) { return state.filter === 'all' || e.level === state.filter; });
    var box = clear($('findings'));
    if (!entries.length) {
      var anyProblems = state.result.report.counts.error + state.result.report.counts.warn;
      box.appendChild(h('div', { class: 'empty', text: state.filter === 'all' || !anyProblems
        ? 'No problems found. Every link, file reference and script passed the checks.' : 'Nothing in this category.' }));
      return;
    }
    var list = h('div', { class: 'findings' });
    entries.forEach(function (e) { list.appendChild(findingRow(e)); });
    box.appendChild(list);
  }

  /* ---------------- preview ---------------- */
  var frame, watchers = [];
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string' || d.type.indexOf('h2j-') !== 0) return;
    watchers.forEach(function (w) { if (w.win === e.source) w.fn(d); });
  });
  function pageIdFromHref(href) {
    var m = /^(?:\.\/)?render\.html\?page=([^&#]+)/.exec(href);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    if (/^(?:\.\/)?index\.html(?:[?#]|$)/.test(href)) return state.result.defaultId;
    return null;
  }
  function logLine(cls, text) {
    var c = $('console'); c.appendChild(h('div', { class: cls, text: text })); c.scrollTop = c.scrollHeight;
  }
  function describeRuntime(d) {
    var msg = String(d.message || '').replace(/h2j-missing:/g, '');
    var sandbox = /SecurityError|localStorage|sessionStorage|indexedDB|document\.cookie|Access is denied/i.test(msg);
    var external = /https?:\/\//i.test(msg) && d.kind === 'resource';
    if (sandbox) return { level: 'info', code: 'runtime-sandbox', message: msg + ' (The preview sandbox blocks browser storage. This is expected here and works on a real server.)' };
    if (external) return { level: 'warn', code: 'runtime-external', message: msg + ' (An outside resource did not load in the preview. Check your connection or the address.)' };
    if (d.kind === 'resource') return { level: 'error', code: 'runtime-resource', message: msg };
    if (d.kind === 'console') return { level: 'warn', code: 'runtime-console', message: 'console.error: ' + msg };
    return { level: 'error', code: 'runtime-script', message: 'JavaScript error: ' + msg };
  }
  function previewSource(id) {
    var p = Html2Js.buildPreview(state.result, id);
    return p;
  }
  function loadPreview(id) {
    if (!state.result.pages[id]) return;
    $('preview-page').value = id;
    clear($('console'));
    var p;
    try { p = previewSource(id); } catch (err) { logLine('err', 'Could not build the preview: ' + err.message); return; }
    p.notes.forEach(function (n) { logLine('warn', n); });
    watchers = watchers.filter(function (w) { return w.win !== frame.contentWindow; });
    frame.srcdoc = p.srcdoc;
    var win = frame.contentWindow;
    watchers.push({ win: win, fn: function (d) {
      if (d.type === 'h2j-ready') logLine('ok', 'Rendered ' + id);
      else if (d.type === 'h2j-error') logLine(describeRuntime(d).level === 'info' ? 'info' : 'err', String(d.message).replace(/h2j-missing:/g, ''));
      else if (d.type === 'h2j-nav') {
        var target = pageIdFromHref(d.href);
        if (target && state.result.pages[target]) loadPreview(target);
        else toast('This link opens a file or another site (' + d.href + '). It works in the downloaded site.');
      }
    } });
  }
  function renderPreviewControls() {
    var sel = clear($('preview-page'));
    state.result.pageList.forEach(function (p) { sel.appendChild(h('option', { value: p.id, text: p.source + ' → ' + p.url })); });
  }

  /* run each page in a hidden frame and collect what the browser reports */
  function checkOne(id) {
    return new Promise(function (resolve) {
      var f = h('iframe', { sandbox: 'allow-scripts allow-forms', title: 'Checking ' + id, 'aria-hidden': 'true', tabindex: '-1',
        style: 'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;visibility:hidden' });
      var found = [], done = false, p;
      function finish(extra) {
        if (done) return; done = true;
        watchers = watchers.filter(function (w) { return w.win !== f.contentWindow; });
        if (f.parentNode) f.parentNode.removeChild(f);
        resolve(found.concat(extra || []));
      }
      try { p = previewSource(id); } catch (err) { resolve([{ level: 'error', code: 'runtime-build', file: state.result.pages[id].source, message: 'Could not build this page for checking: ' + err.message }]); return; }
      document.body.appendChild(f);
      var win = f.contentWindow, file = state.result.pages[id].source;
      watchers.push({ win: win, fn: function (d) {
        if (d.type === 'h2j-error') { var x = describeRuntime(d); x.file = file; found.push(x); }
        if (d.type === 'h2j-ready') setTimeout(function () { finish(); }, 700);
      } });
      setTimeout(function () { finish([{ level: 'error', code: 'runtime-timeout', file: file, message: 'The page did not finish rendering within 8 seconds.' }]); }, 8000);
      f.srcdoc = p.srcdoc;
    });
  }
  function runtimeCheck() {
    var btn = $('btn-runtime'), ids = state.result.pageList.map(function (p) { return p.id; }), i = 0, added = 0, seen = {};
    state.result.report.entries.forEach(function (e) { seen[e.code + '|' + e.file + '|' + e.message] = 1; });
    btn.disabled = true;
    (function next() {
      if (i >= ids.length) {
        state.result.report.entries = resort(state.result.report.entries); recount();
        renderResult(); selectTab('report');
        $('runtime-note').textContent = added
          ? 'Browser check finished: ' + plural(added, 'new finding') + ' from ' + plural(ids.length, 'page') + '.'
          : 'Browser check finished: all ' + plural(ids.length, 'page') + ' rendered without script errors or missing files.';
        return;
      }
      btn.textContent = 'Checking page ' + (i + 1) + ' of ' + ids.length + '…';
      checkOne(ids[i++]).then(function (list) {
        list.forEach(function (e) {
          var key = e.code + '|' + e.file + '|' + e.message;
          if (seen[key]) return; seen[key] = 1; added++;
          state.result.report.entries.push(e);
        });
        next();
      });
    })();
  }

  /* ---------------- files tab ---------------- */
  function renderFiles() {
    var r = state.result, rows = clear($('map-rows'));
    r.pageList.forEach(function (p) {
      rows.appendChild(h('tr', null, h('td', { class: 'path', text: p.source }), h('td', { class: 'path', text: p.out }), h('td', { class: 'path', text: p.url })));
    });
    var generated = {}; r.pageList.forEach(function (p) { generated[p.out] = 1; });
    generated[r.rendererPath] = 1;
    var shells = { 'index.html': 1, 'render.html': 1 };
    var paths = Object.keys(r.files).sort(), LIMIT = 300;
    var tree = clear($('tree'));
    tree.appendChild(document.createTextNode((state.name || 'website') + '-converted/\n'));
    var shown = paths.slice(0, LIMIT);
    shown.forEach(function (p) {
      var line = document.createDocumentFragment();
      line.appendChild(document.createTextNode('  '));
      if (shells[p]) line.appendChild(h('span', { class: 'shell', text: p }));
      else if (generated[p]) line.appendChild(h('span', { class: 'gen', text: p }));
      else line.appendChild(document.createTextNode(p));
      line.appendChild(h('span', { class: 'dim', text: '   ' + Html2Js.formatBytes(r.files[p].length) }));
      line.appendChild(document.createTextNode('\n'));
      tree.appendChild(line);
    });
    $('tree-note').textContent = (paths.length > LIMIT ? 'Showing the first ' + LIMIT + ' of ' + paths.length + ' files. ' : '') +
      'Orange files are the two HTML entry points. Yellow files are generated. Everything else is copied unchanged.' +
      (r.keptHtml && r.keptHtml.length ? ' Kept as .html: ' + r.keptHtml.join(', ') + '.' : '');
  }

  /* ---------------- tabs ---------------- */
  var TABS = ['report', 'preview', 'files'];
  function selectTab(name) {
    TABS.forEach(function (t) {
      var on = t === name;
      $('tab-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + t).tabIndex = on ? 0 : -1;
      $('view-' + t).hidden = !on;
    });
    if (name === 'preview' && state.result && !frame.getAttribute('data-loaded-for')) {
      frame.setAttribute('data-loaded-for', '1');
      loadPreview(state.result.defaultId);
    }
  }

  /* ---------------- downloads ---------------- */
  function save(blob, name) {
    var url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function downloadZip() {
    var r = state.result, btn = $('btn-download');
    btn.disabled = true; btn.textContent = 'Building ZIP…';
    var zip = new JSZip();
    Object.keys(r.files).forEach(function (p) { zip.file(p, r.files[p], { binary: true }); });
    zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then(function (blob) {
      save(blob, (state.name || 'website').replace(/[^\w.\-]+/g, '-') + '-converted.zip');
      state.downloaded = true; setStage(5);
      toast('Downloaded ' + Html2Js.formatBytes(blob.size) + '. Serve it from any static host.');
    }).catch(function (err) { toast('Could not build the ZIP: ' + err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Download converted ZIP'; });
  }
  function downloadReport() {
    save(new Blob([Html2Js.reportToText(state.result)], { type: 'text/plain;charset=utf-8' }), (state.name || 'website').replace(/[^\w.\-]+/g, '-') + '-conversion-report.txt');
  }

  /* ---------------- wiring ---------------- */
  function reset() {
    state.raw = null; state.analysis = null; state.result = null;
    $('panel-analyse').hidden = true; $('panel-result').hidden = true;
    $('zip-input').value = ''; setUploadStatus(''); setStage(0);
    if (frame) { frame.removeAttribute('srcdoc'); frame.removeAttribute('data-loaded-for'); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function init() {
    frame = $('preview-frame');
    setStage(0);
    var input = $('zip-input'), drop = $('drop');
    input.addEventListener('change', function () { if (input.files[0]) readZip(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) readZip(f); });
    ['dragover', 'drop'].forEach(function (t) { window.addEventListener(t, function (e) { if (e.target !== drop && !drop.contains(e.target)) e.preventDefault(); }); });

    $('btn-sample').addEventListener('click', function () { load(SampleSite.build(), SampleSite.name); });
    $('btn-reset').addEventListener('click', reset);
    $('btn-convert').addEventListener('click', runConvert);
    $('check-all').addEventListener('change', function (e) {
      state.analysis.pages.forEach(function (p) { if (p.path !== 'index.html') state.excluded[p.path] = !e.target.checked; });
      renderAnalysis();
    });
    $('btn-download').addEventListener('click', downloadZip);
    $('btn-report').addEventListener('click', downloadReport);
    $('btn-reload').addEventListener('click', function () { loadPreview($('preview-page').value); });
    $('preview-page').addEventListener('change', function () { loadPreview($('preview-page').value); });
    Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.seg button'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $('stage').setAttribute('data-device', b.getAttribute('data-device'));
      });
    });
    TABS.forEach(function (t, i) {
      var btn = $('tab-' + t);
      btn.addEventListener('click', function () { selectTab(t); });
      btn.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        selectTab(next); $('tab-' + next).focus();
      });
    });
  }
  init();
})();
