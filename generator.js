/* AI Barricade - Level 1 generator UI. All processing is local to the browser. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var CATS = [
    { key: 'training', title: 'AI training & dataset crawlers', defaultOn: true },
    { key: 'search', title: 'AI search crawlers', defaultOn: false, warn: 'Blocking these can remove you from AI search results.' },
    { key: 'user', title: 'User-triggered AI fetchers', defaultOn: false, warn: 'Triggered when a person asks an AI tool about your page. Operators may not apply robots.txt to these.' }
  ];
  var lastOutput = '';

  /* ---- crawler checklist ---- */
  function renderCrawlers() {
    var box = $('crawler-list');
    box.textContent = '';
    CATS.forEach(function (cat) {
      var items = window.CRAWLERS.filter(function (c) { return c.category === cat.key; });
      var title = document.createElement('div');
      title.className = 'group-title';
      var span = document.createElement('span');
      span.textContent = cat.title;
      title.appendChild(span);
      var tgl = document.createElement('button');
      tgl.type = 'button'; tgl.textContent = 'Toggle all'; tgl.setAttribute('data-cat', cat.key);
      title.appendChild(tgl);
      box.appendChild(title);
      if (cat.warn) { var h = document.createElement('div'); h.className = 'hint'; h.textContent = cat.warn; box.appendChild(h); }
      items.forEach(function (c) {
        var lab = document.createElement('label'); lab.className = 'check';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = c.token; cb.setAttribute('data-cat', c.category);
        cb.checked = cat.defaultOn;
        var txt = document.createElement('span');
        var nm = document.createElement('span'); nm.className = 'name'; nm.textContent = c.token;
        var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'already blocked'; tag.hidden = true; tag.setAttribute('data-tag', c.token);
        nm.appendChild(tag);
        var meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = c.operator + ' · ' + c.note;
        txt.appendChild(nm); txt.appendChild(meta);
        lab.appendChild(cb); lab.appendChild(txt);
        box.appendChild(lab);
      });
    });
  }

  function boxes() { return Array.prototype.slice.call($('crawler-list').querySelectorAll('input[type=checkbox]')); }
  function selectedCrawlers() {
    var on = {};
    boxes().forEach(function (b) { if (b.checked) on[b.value] = true; });
    return window.CRAWLERS.filter(function (c) { return on[c.token]; });
  }

  function markExisting() {
    var text = $('existing').value;
    var tokens = window.CRAWLERS.map(function (c) { return c.token; });
    var det = window.Robots.detectBlocked(text, tokens);
    tokens.forEach(function (t) {
      var el = document.querySelector('[data-tag="' + t + '"]');
      if (el) el.hidden = !det[t];
    });
  }

  /* ---- events ---- */
  $('crawler-list').addEventListener('click', function (e) {
    var cat = e.target && e.target.getAttribute && e.target.getAttribute('data-cat');
    if (!cat || e.target.tagName !== 'BUTTON') return;
    var group = boxes().filter(function (b) { return b.getAttribute('data-cat') === cat; });
    var allOn = group.every(function (b) { return b.checked; });
    group.forEach(function (b) { b.checked = !allOn; });
  });

  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = btn.getAttribute('data-preset');
      boxes().forEach(function (b) {
        b.checked = p === 'all' ? true : p === 'training' ? b.getAttribute('data-cat') === 'training' : false;
      });
    });
  });

  document.querySelectorAll('input[name=mode]').forEach(function (r) {
    r.addEventListener('change', function () {
      $('paths-box').hidden = document.querySelector('input[name=mode]:checked').value !== 'paths';
    });
  });

  $('existing').addEventListener('input', markExisting);

  $('file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    $('existing-err').textContent = '';
    if (!f) return;
    if (f.size > window.Robots.MAX_BYTES) { $('existing-err').textContent = 'That file is larger than 500 KiB, which crawlers ignore beyond. Please trim it first.'; this.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function () { $('existing').value = String(reader.result); markExisting(); };
    reader.onerror = function () { $('existing-err').textContent = 'Could not read that file.'; };
    reader.readAsText(f);
  });

  $('form').addEventListener('submit', function (e) { e.preventDefault(); generate(); });

  /* ---- generate ---- */
  function clearErrors() {
    ['domain-err', 'auth-err', 'existing-err', 'crawler-err', 'paths-err', 'sitemap-err'].forEach(function (id) { $(id).textContent = ''; });
  }

  function generate() {
    clearErrors();
    var ok = true;

    var domainRaw = $('domain').value.trim();
    var domain = domainRaw ? window.Robots.normaliseDomain(domainRaw) : null;
    if (!domainRaw) { $('domain-err').textContent = 'Enter your domain, for example example.com.'; ok = false; }
    else if (!domain) { $('domain-err').textContent = 'That does not look like a valid domain name.'; ok = false; }
    if (!$('auth').checked) { $('auth-err').textContent = 'Please confirm you are authorised to manage this site.'; ok = false; }

    var existing = $('existing').value;
    if (existing.length > window.Robots.MAX_BYTES) { $('existing-err').textContent = 'Existing file is larger than 500 KiB.'; ok = false; }

    var crawlers = selectedCrawlers();
    if (!crawlers.length) { $('crawler-err').textContent = 'Select at least one crawler.'; ok = false; }

    var mode = document.querySelector('input[name=mode]:checked').value;
    var paths = [];
    if (mode === 'paths') {
      var pl = window.Robots.parsePathList($('paths').value);
      paths = pl.paths;
      if (pl.errors.length) { $('paths-err').textContent = pl.errors.slice(0, 3).join(' '); ok = false; }
      else if (!paths.length) { $('paths-err').textContent = 'Add at least one path.'; ok = false; }
    }

    var sitemap = $('sitemap').value.trim();
    if (sitemap && domain) {
      var se = window.Robots.validateSitemap(sitemap, domain);
      if (se) { $('sitemap-err').textContent = se; ok = false; }
    }
    if (!ok) return;

    var r = window.Robots.merge(existing, { crawlers: crawlers, mode: mode, paths: paths, sitemap: sitemap || '', domain: domain });
    if (r.errors.length) { $('crawler-err').textContent = r.errors[0]; return; }
    show(r, existing, domain);
  }

  /* ---- output ---- */
  function show(r, existing, domain) {
    lastOutput = r.text;
    var oldSet = {};
    existing.split(/\r\n|\r|\n/).forEach(function (l) { oldSet[l] = (oldSet[l] || 0) + 1; });

    var pre = $('preview'); pre.textContent = '';
    r.text.replace(/\n$/, '').split('\n').forEach(function (line) {
      var span = document.createElement('span');
      var isOld = oldSet[line] > 0;
      if (isOld) oldSet[line]--;
      var isNew = !isOld && line.trim() !== '';
      span.className = isNew ? 'l-new' : (/^\s*#/.test(line) ? 'l-cm' : '');
      span.textContent = line + '\n';
      pre.appendChild(span);
    });

    var sum = $('summary'); sum.textContent = '';
    var ul = document.createElement('ul'); ul.className = 'summary-list';
    function li(text) { var el = document.createElement('li'); el.textContent = text; ul.appendChild(el); }
    var addedAgents = {};
    r.added.forEach(function (a) { addedAgents[a.agent] = true; });
    var an = Object.keys(addedAgents).length;
    li(an ? 'Added rules for ' + an + ' crawler' + (an === 1 ? '' : 's') + '. Your existing lines were kept unchanged.' : 'Nothing to add: everything selected is already in your file.');
    if (r.skipped.length) li(r.skipped.length + ' rule' + (r.skipped.length === 1 ? '' : 's') + ' skipped because already present.');
    r.warnings.forEach(function (w) { li('Heads-up: ' + w); });
    sum.appendChild(ul);

    $('url-example').textContent = 'https://' + domain + '/robots.txt';
    $('empty').hidden = true;
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('download').addEventListener('click', function () {
    if (!lastOutput) return;
    var blob = new Blob([lastOutput], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'robots.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  $('copy').addEventListener('click', function () {
    var btn = this;
    function done(msg) { var o = btn.textContent; btn.textContent = msg; setTimeout(function () { btn.textContent = o; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastOutput).then(function () { done('Copied'); }, function () { done('Copy failed'); });
    } else { done('Select text manually'); }
  });

  renderCrawlers();
})();
