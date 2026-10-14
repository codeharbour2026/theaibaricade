/*!
 * HTML-to-JS Converter: core engine.
 *
 * Environment-agnostic (browser or Node + jsdom). Needs a global DOMParser,
 * TextDecoder and TextEncoder. It never touches the network or the disk:
 * it takes a { "path/in/site": Uint8Array } map and returns a new one.
 *
 * Public API (window.Html2Js / module.exports):
 *   analyze(rawFiles)               -> quick scan used before converting
 *   convert(rawFiles, options)      -> { files, pages, report, ... }
 *   buildPreview(result, pageId)    -> { srcdoc, notes } for a sandboxed iframe
 *   reportToText(result)            -> plain-text report
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Html2Js = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var PAGE_EXT = /\.html?$/i;
  var SKIP_DIRS = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)/;
  var SKIP_FILES = /(^|\/)(\.DS_Store|Thumbs\.db)$/i;
  var SERVER_EXT = /\.(php\d?|phtml|asp|aspx|jsp|cgi|pl|shtml|ejs|hbs|njk|twig|erb)$/i;
  var VENDOR_JS = /(\.min\.js$|(^|\/)(vendor|vendors|lib|libs|node_modules)\/)/i;
  var LINK_TAGS = { a: 1, area: 1, iframe: 1, frame: 1, form: 1 };

  var URL_ATTRS = {
    a: ['href'], area: ['href'], link: ['href', 'imagesrcset'],
    script: ['src'], img: ['src', 'srcset'], source: ['src', 'srcset'],
    video: ['src', 'poster'], audio: ['src'], track: ['src'],
    iframe: ['src'], frame: ['src'], embed: ['src'], object: ['data'],
    input: ['src', 'formaction'], button: ['formaction'], form: ['action'],
    use: ['href', 'xlink:href'], image: ['href', 'xlink:href'],
    body: ['background'], table: ['background'], td: ['background'], th: ['background'],
    blockquote: ['cite'], q: ['cite'], del: ['cite'], ins: ['cite']
  };
  var DATA_ATTRS = ['data-src', 'data-srcset', 'data-original', 'data-lazy-src',
    'data-bg', 'data-background', 'data-poster', 'data-image', 'data-href'];
  var SRCSET_ATTRS = { srcset: 1, imagesrcset: 1, 'data-srcset': 1 };

  var MIME = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    json: 'application/json', txt: 'text/plain', xml: 'application/xml', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', mp4: 'video/mp4',
    webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
    pdf: 'application/pdf'
  };

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                     */
  /* ------------------------------------------------------------------ */

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function extOf(p) { var m = /\.([A-Za-z0-9]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; }
  function dirname(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function encodePath(p) {
    return p.split('/').map(function (seg) {
      return encodeURIComponent(seg).replace(/[()']/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
    }).join('/');
  }
  function normalizePath(p) {
    var out = [], escapes = false;
    p.split('/').forEach(function (seg) {
      if (seg === '' || seg === '.') return;
      if (seg === '..') { if (out.length) out.pop(); else escapes = true; }
      else out.push(seg);
    });
    return { path: out.join('/'), escapes: escapes };
  }
  function isExternal(ref) { return /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(ref) || ref.slice(0, 2) === '//'; }
  function splitRef(ref) {
    var h = ref.indexOf('#'), hash = h >= 0 ? ref.slice(h) : '', rest = h >= 0 ? ref.slice(0, h) : ref;
    var q = rest.indexOf('?'), query = q >= 0 ? rest.slice(q) : '', path = q >= 0 ? rest.slice(0, q) : rest;
    return { path: path, query: query, hash: hash };
  }
  function attrsOf(el) {
    var o = {};
    for (var i = 0; i < el.attributes.length; i++) o[el.attributes[i].name] = el.attributes[i].value;
    return o;
  }
  function isEmpty(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) return false; return true; }
  function toArray(list) { return Array.prototype.slice.call(list); }
  function toBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s);
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function decodeText(bytes, report, file) {
    var text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(bytes);
      if (report) report.add('warn', 'encoding', file, 'This file is not valid UTF-8, so it was read as Windows-1252. The converted output is UTF-8. Check accented characters and symbols.');
    }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }

  /* ------------------------------------------------------------------ */
  /* Report                                                              */
  /* ------------------------------------------------------------------ */

  function Report() { this.entries = []; this._seen = {}; }
  Report.prototype.add = function (level, code, file, message) {
    var key = level + '|' + code + '|' + file + '|' + message;
    if (this._seen[key]) return;
    this._seen[key] = 1;
    this.entries.push({ level: level, code: code, file: file || '', message: message });
  };
  Report.prototype.finish = function () {
    var rank = { error: 0, warn: 1, info: 2 };
    var indexed = this.entries.map(function (e, i) { return { e: e, i: i }; });
    indexed.sort(function (a, b) { return (rank[a.e.level] - rank[b.e.level]) || (a.i - b.i); });
    this.entries = indexed.map(function (x) { return x.e; });
    return this.counts();
  };
  Report.prototype.counts = function () {
    var c = { error: 0, warn: 0, info: 0 };
    this.entries.forEach(function (e) { c[e.level]++; });
    return c;
  };

  /* ------------------------------------------------------------------ */
  /* Input normalisation                                                 */
  /* ------------------------------------------------------------------ */

  function normalizeFiles(raw, report) {
    var out = {}, skipped = 0, serverFiles = [];
    Object.keys(raw).forEach(function (name) {
      var p = name.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
      if (!p || /\/$/.test(p)) return;
      if (SKIP_DIRS.test(p) || SKIP_FILES.test(p)) { skipped++; return; }
      out[p] = raw[name];
    });

    var keys = Object.keys(out), stripped = '';
    if (keys.length) {
      var firsts = {};
      keys.forEach(function (k) { var i = k.indexOf('/'); firsts[i < 0 ? '' : k.slice(0, i)] = 1; });
      var names = Object.keys(firsts);
      if (names.length === 1 && names[0] !== '' && keys.some(function (k) { return PAGE_EXT.test(k); })) {
        var top = names[0], moved = {};
        keys.forEach(function (k) { moved[k.slice(top.length + 1)] = out[k]; });
        out = moved; stripped = top;
        report.add('info', 'root', '', 'The ZIP has a single top-level folder ("' + top + '"). Its contents were treated as the website root.');
      }
    }
    if (skipped) report.add('info', 'skipped', '', skipped + ' system or tooling file(s) were left out (.git, node_modules, __MACOSX, .DS_Store, Thumbs.db).');
    Object.keys(out).forEach(function (p) { if (SERVER_EXT.test(p)) serverFiles.push(p); });
    if (serverFiles.length) {
      report.add('warn', 'server-side', serverFiles[0],
        serverFiles.length + ' server-side or template file(s) found (' + serverFiles.slice(0, 4).join(', ') + (serverFiles.length > 4 ? ', ...' : '') +
        '). They are copied unchanged and cannot run on a static website. Links to them are not converted.');
    }
    return { files: out, stripped: stripped };
  }

  /* ------------------------------------------------------------------ */
  /* CSS and URL rewriting helpers                                       */
  /* ------------------------------------------------------------------ */

  var CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/gi;
  var CSS_IMPORT_RE = /@import\s+(["'])(.*?)\1/gi;

  function rewriteCss(css, mapRef) {
    css = css.replace(CSS_URL_RE, function (m, dq, sq, bare) {
      var ref = dq !== undefined ? dq : (sq !== undefined ? sq : bare);
      if (!ref || ref.charAt(0) === '#' || isExternal(ref)) return m;
      var next = mapRef(ref);
      if (next === ref) return m;
      var q = dq !== undefined ? '"' : (sq !== undefined ? "'" : '');
      return 'url(' + q + next + q + ')';
    });
    return css.replace(CSS_IMPORT_RE, function (m, q, ref) {
      if (!ref || isExternal(ref)) return m;
      var next = mapRef(ref);
      return next === ref ? m : '@import ' + q + next + q;
    });
  }

  function mapSrcset(value, fn) {
    if (value.indexOf('data:') >= 0) return value;
    return value.split(',').map(function (part) {
      var m = /^(\s*)(\S+)([\s\S]*)$/.exec(part);
      if (!m) return part;
      return m[1] + fn(m[2]) + m[3];
    }).join(',');
  }

  /**
   * Visits every URL-bearing attribute, inline style and <style> block in a document.
   * mapUrl(value, tag, attr) -> new value.  mapJs(code) -> new code (for on* handlers).
   */
  function walkUrls(doc, mapUrl, mapJs) {
    var all = doc.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], tag = el.tagName.toLowerCase(), j;
      var list = URL_ATTRS[tag];
      if (list) for (j = 0; j < list.length; j++) mapAttr(el, tag, list[j], mapUrl);
      for (j = 0; j < DATA_ATTRS.length; j++) if (el.hasAttribute(DATA_ATTRS[j])) mapAttr(el, tag, DATA_ATTRS[j], mapUrl);

      if (tag === 'meta') {
        var key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        var http = (el.getAttribute('http-equiv') || '').toLowerCase();
        var content = el.getAttribute('content');
        if (content && http === 'refresh') {
          var next = content.replace(/(url\s*=\s*)(['"]?)([^'";]+)\2/i, function (m, pre, q, ref) { return pre + q + mapUrl(ref.trim(), 'meta', 'content') + q; });
          if (next !== content) el.setAttribute('content', next);
        } else if (content && /^(og:image|og:video|og:audio|twitter:image)/.test(key) && !isExternal(content)) {
          var n2 = mapUrl(content, 'meta', 'content');
          if (n2 !== content) el.setAttribute('content', n2);
        }
      }
      var st = el.getAttribute('style');
      if (st && st.indexOf('url(') >= 0) {
        var ns = rewriteCss(st, function (r) { return mapUrl(r, 'css', 'style'); });
        if (ns !== st) el.setAttribute('style', ns);
      }
      if (tag === 'style') {
        var css = el.textContent;
        if (css.indexOf('url(') >= 0 || css.indexOf('@import') >= 0) {
          var nc = rewriteCss(css, function (r) { return mapUrl(r, 'css', 'style'); });
          if (nc !== css) el.textContent = nc;
        }
      }
      if (mapJs) {
        for (j = 0; j < el.attributes.length; j++) {
          var a = el.attributes[j];
          if (a.name.length > 2 && a.name.slice(0, 2) === 'on') {
            var nj = mapJs(a.value, a.name);
            if (nj !== a.value) el.setAttribute(a.name, nj);
          }
        }
      }
    }
  }
  function mapAttr(el, tag, attr, mapUrl) {
    var v = el.getAttribute(attr);
    if (v == null || !v.trim()) return;
    var nv = SRCSET_ATTRS[attr] ? mapSrcset(v, function (r) { return (isExternal(r) || r.charAt(0) === '#') ? r : mapUrl(r, tag, attr); }) : mapUrl(v, tag, attr);
    if (nv !== v) el.setAttribute(attr, nv);
  }

  var JS_PAGE_LITERAL = /(["'])((?:(?!\1)[^\\\r\n])+?\.html?(?:[?#](?:(?!\1)[^\\\r\n])*)?)\1/gi;

  function isExecScript(el) {
    var t = (el.getAttribute('type') || '').trim().toLowerCase();
    return !t || t === 'text/javascript' || t === 'application/javascript' || t === 'module' ||
      t === 'text/ecmascript' || t === 'application/ecmascript' || t === 'application/x-javascript' || t === 'text/jscript';
  }

  /* ------------------------------------------------------------------ */
  /* Output serialisation                                                */
  /* ------------------------------------------------------------------ */

  function jsStr(s) {
    return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029').replace(/<\//g, '<\\/');
  }
  function emitValue(v, depth, key) {
    var pad = new Array(depth + 1).join('  '), pad1 = pad + '  ';
    if (typeof v === 'string') {
      if ((key === 'body' || key === 'text') && v.indexOf('\n') >= 0) {
        return '[\n' + v.split('\n').map(function (l) { return pad1 + jsStr(l); }).join(',\n') + '\n' + pad + '].join("\\n")';
      }
      return jsStr(v);
    }
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[\n' + v.map(function (x) { return pad1 + emitValue(x, depth + 1, null); }).join(',\n') + '\n' + pad + ']';
    }
    if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      if (!keys.length) return '{}';
      var flat = keys.every(function (k) { return typeof v[k] === 'string'; });
      if (flat) {
        var one = '{ ' + keys.map(function (k) { return jsStr(k) + ': ' + jsStr(v[k]); }).join(', ') + ' }';
        if (one.length <= 110) return one;
      }
      return '{\n' + keys.map(function (k) { return pad1 + jsStr(k) + ': ' + emitValue(v[k], depth + 1, k); }).join(',\n') + '\n' + pad + '}';
    }
    return JSON.stringify(v);
  }
  function emitPageFile(id, page) {
    return '/* Generated by HTML-to-JS Converter from ' + JSON.stringify(page.source).replace(/\*\//g, '*\\/') + '. */\n' +
      '(window.__pages = window.__pages || {})[' + jsStr(id) + '] = ' + emitValue(page, 0, null) + ';\n';
  }

  /* ------------------------------------------------------------------ */
  /* Runtime that ships inside the converted site (js/renderer.js)       */
  /* Written as a real function so it is syntax-checked with this file.  */
  /* ------------------------------------------------------------------ */

  function rendererRuntime(PAGES_DIR) {
    'use strict';
    var currentScript = document.currentScript;
    var ID_RE = /^[A-Za-z0-9_\-]+(?:\/[A-Za-z0-9_\-]+)*$/;
    var registry = (window.__pages = window.__pages || {});

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function showError(title, detail) {
      document.title = title;
      document.body.innerHTML = '<div style="font:16px/1.55 system-ui,sans-serif;max-width:40rem;margin:12vh auto;padding:0 1rem">' +
        '<h1 style="font-size:1.4rem;margin:0 0 .5rem">' + esc(title) + '</h1><p>' + esc(detail) +
        '</p><p><a href="index.html">Back to the home page</a></p></div>';
      try { window.dispatchEvent(new CustomEvent('h2j:rendered', { detail: { page: '', error: true } })); } catch (e) { /* ignore */ }
    }
    function getPageId() {
      var forced = currentScript && currentScript.getAttribute('data-page');
      if (forced) return forced;
      if (window.__PAGE__) return String(window.__PAGE__);
      var m = /[?&]page=([^&#]*)/.exec(window.location.search);
      if (!m) return '';
      try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; }
    }
    function loadPageFile(id, cb) {
      if (registry[id]) { cb(null, registry[id]); return; }
      var s = document.createElement('script'), src = PAGES_DIR + '/' + id + '.js';
      s.src = src;
      function drop() { if (s.parentNode) s.parentNode.removeChild(s); }
      s.onload = function () {
        drop();
        if (registry[id]) cb(null, registry[id]);
        else cb(new Error('"' + src + '" loaded but did not define the page "' + id + '".'));
      };
      s.onerror = function () { drop(); cb(new Error('There is no page called "' + id + '" (could not load ' + src + ').')); };
      document.head.appendChild(s);
    }
    function setAttrs(el, attrs) {
      if (!attrs) return;
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) { try { el.setAttribute(k, attrs[k]); } catch (e) { /* ignore invalid attribute names */ } }
      }
    }
    function applyHead(items, done) {
      var pending = 1, finished = false, timer;
      function finish() { if (!finished) { finished = true; clearTimeout(timer); done(); } }
      function dec() { pending--; if (pending <= 0) finish(); }
      timer = setTimeout(finish, 4000);
      for (var i = 0; i < items.length; i++) {
        var h = items[i], a = h.attrs || {};
        if (h.tag === 'meta' && a.name) {
          var metas = document.head.getElementsByTagName('meta');
          for (var m = metas.length - 1; m >= 0; m--) {
            if (metas[m].getAttribute('name') === a.name) metas[m].parentNode.removeChild(metas[m]);
          }
        }
        var el = document.createElement(h.tag);
        setAttrs(el, a);
        if (h.text != null) el.textContent = h.text;
        if (h.tag === 'link' && a.href && /(^|\s)stylesheet(\s|$)/i.test(a.rel || '')) {
          pending++;
          el.addEventListener('load', dec);
          el.addEventListener('error', dec);
        }
        document.head.appendChild(el);
      }
      dec();
    }
    /* Page scripts expect DOMContentLoaded / load to still be ahead of them. */
    function shimLifecycle(queue) {
      var origDoc = document.addEventListener, origWin = window.addEventListener;
      var desc = Object.getOwnPropertyDescriptor(window, 'onload');
      function wrap(orig, target) {
        return function (type, fn) {
          if ((type === 'DOMContentLoaded' || (type === 'load' && target === window)) && fn) { queue.push({ type: type, fn: fn, target: target }); return; }
          return orig.apply(this, arguments);
        };
      }
      document.addEventListener = wrap(origDoc, document);
      window.addEventListener = wrap(origWin, window);
      try {
        Object.defineProperty(window, 'onload', {
          configurable: true,
          get: function () { return null; },
          set: function (fn) { if (typeof fn === 'function') queue.push({ type: 'load', fn: fn, target: window }); }
        });
      } catch (e) { /* ignore */ }
      return function restore() {
        delete document.addEventListener;
        delete window.addEventListener;
        try { if (desc) Object.defineProperty(window, 'onload', desc); else delete window.onload; } catch (e) { /* ignore */ }
      };
    }
    function fire(item) {
      var ev;
      try { ev = new Event(item.type); } catch (e) { ev = document.createEvent('Event'); ev.initEvent(item.type, false, false); }
      try {
        if (typeof item.fn === 'function') item.fn.call(item.target, ev);
        else if (item.fn && typeof item.fn.handleEvent === 'function') item.fn.handleEvent(ev);
      } catch (err) { console.error(err); }
    }
    function runScripts(list, onloadCode, done) {
      var queue = [], restore = shimLifecycle(queue), i = 0;
      function after() {
        restore();
        var j;
        for (j = 0; j < queue.length; j++) if (queue[j].type === 'DOMContentLoaded') fire(queue[j]);
        for (j = 0; j < queue.length; j++) if (queue[j].type === 'load') fire(queue[j]);
        if (onloadCode) {
          var el = document.createElement('script');
          el.text = onloadCode;
          document.body.appendChild(el);
          document.body.removeChild(el);
        }
        done();
      }
      function next() {
        if (i >= list.length) { setTimeout(after, 0); return; }
        var s = list[i++], el = document.createElement('script'), a = s.attrs || {};
        for (var k in a) {
          if (!Object.prototype.hasOwnProperty.call(a, k) || k === 'async' || k === 'defer') continue;
          try { el.setAttribute(k, a[k]); } catch (e) { /* ignore */ }
        }
        function cleanup() { if (el.parentNode) el.parentNode.removeChild(el); }
        if (a.src) {
          el.async = false;
          el.onload = function () { cleanup(); next(); };
          el.onerror = function () { console.error('[html-to-js] Could not load script: ' + a.src); cleanup(); next(); };
          document.body.appendChild(el);
        } else {
          el.text = s.text || '';
          document.body.appendChild(el);
          cleanup();
          next();
        }
      }
      next();
    }
    function scrollToHash() {
      var h = window.location.hash;
      if (!h || h.length < 2) return;
      var id; try { id = decodeURIComponent(h.slice(1)); } catch (e) { id = h.slice(1); }
      var el = document.getElementById(id) || document.getElementsByName(id)[0];
      if (el && el.scrollIntoView) el.scrollIntoView();
    }
    function render(page, id) {
      document.title = page.title || '';
      setAttrs(document.documentElement, page.htmlAttrs);
      applyHead(page.head || [], function () {
        setAttrs(document.body, page.bodyAttrs);
        document.body.innerHTML = page.body || '';
        scrollToHash();
        runScripts(page.scripts || [], page.onload, function () {
          try { window.dispatchEvent(new CustomEvent('h2j:rendered', { detail: { page: id } })); } catch (e) { /* ignore */ }
        });
      });
    }

    var id = getPageId();
    if (!id) { window.location.replace('index.html'); return; }
    if (!ID_RE.test(id)) { showError('Page not found', 'The page name "' + id + '" is not valid.'); return; }
    window.__PAGE__ = id;
    loadPageFile(id, function (err, page) {
      if (err) { showError('Page not found', err.message); return; }
      window.__PAGE_SOURCE__ = page.source || '';
      render(page, id);
    });
  }

  function rendererSource(pagesDir) {
    return '(' + rendererRuntime.toString() + ')(' + JSON.stringify(pagesDir) + ');\n';
  }
  function rendererFile(pagesDir) {
    return '/* Page renderer generated by HTML-to-JS Converter.\n' +
      ' * index.html and render.html load this file. It reads the page name\n' +
      ' * (render.html?page=about), loads ' + pagesDir + '/about.js, then builds the page.\n' +
      ' * Globals available to page scripts: window.__PAGE__ (page name),\n' +
      ' * window.__PAGE_SOURCE__ (original file name). A "h2j:rendered" event fires when done. */\n' +
      rendererSource(pagesDir);
  }
  function shellHtml(o) {
    return (o.doctype ? '<!doctype html>\n' : '') +
      '<html>\n<head>\n<meta charset="utf-8">\n<title>Loading\u2026</title>\n</head>\n<body>\n' +
      '<noscript>This website needs JavaScript to display its pages.</noscript>\n' +
      '<script src="' + o.rendererPath + '"' + (o.pageId ? ' data-page="' + o.pageId + '"' : '') + '></script>\n</body>\n</html>\n';
  }

  /* ------------------------------------------------------------------ */
  /* Page scanning (warnings about behaviour that may not survive)       */
  /* ------------------------------------------------------------------ */

  function scanScript(code, label, file, report) {
    if (/document\.(?:write|writeln)\s*\(/.test(code)) {
      report.add('warn', 'document-write', file, label + ' calls document.write(). That cannot add content once the page has loaded, so it will not work in a converted page.');
    }
    if (/document\.currentScript/.test(code)) {
      report.add('warn', 'current-script', file, label + ' uses document.currentScript. Scripts now run from the renderer, so check that it still behaves the same.');
    }
    if (/location\.(?:pathname|href)\b(?!\s*=(?!=))|document\.(?:URL|documentURI)\b/.test(code)) {
      report.add('warn', 'location', file, label + ' reads the page address (location.pathname or href). Pages are now served from render.html?page=<name>, so checks against "about.html" will no longer match. Use window.__PAGE__ (page name) or window.__PAGE_SOURCE__ (original file name) instead.');
    }
    if (/(?:fetch|\.open|\.get|\.getJSON|\.load|\.ajax|import)\s*\(\s*[^)]*?\.html?\b/i.test(code)) {
      report.add('warn', 'html-fetch', file, label + ' requests an HTML file at runtime. If that file was converted to a page script, the request will fail. Leave it out of conversion in the page list to keep it as .html.');
    }
    if (/serviceWorker\s*\.\s*register/.test(code)) {
      report.add('warn', 'service-worker', file, label + ' registers a service worker. Cached .html URLs and its scope will not match the new structure.');
    }
  }
  function checkSyntax(code, label, file, report) {
    if (/^\s*(?:import|export)\b/m.test(code)) return;
    try { new Function(code); } catch (e) {
      if (e && e.name === 'SyntaxError') report.add('warn', 'js-syntax', file, label + ' may contain a syntax error: ' + e.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* analyze()                                                           */
  /* ------------------------------------------------------------------ */

  function fileKind(p) {
    var e = extOf(p);
    if (PAGE_EXT.test(p)) return 'html';
    if (e === 'css') return 'css';
    if (e === 'js' || e === 'mjs') return 'js';
    if (/^(png|jpe?g|gif|svg|webp|avif|ico|bmp)$/.test(e)) return 'image';
    if (/^(woff2?|ttf|otf|eot)$/.test(e)) return 'font';
    if (/^(mp4|webm|mp3|wav|ogg|m4a)$/.test(e)) return 'media';
    return 'other';
  }

  function analyze(rawFiles) {
    var report = new Report();
    var norm = normalizeFiles(rawFiles, report);
    var files = norm.files, counts = { html: 0, css: 0, js: 0, image: 0, font: 0, media: 0, other: 0 }, bytes = 0;
    var pages = [];
    Object.keys(files).sort().forEach(function (p) {
      var kind = fileKind(p);
      counts[kind]++;
      bytes += files[p].length;
      if (kind !== 'html') return;
      var info = { path: p, size: files[p].length, title: '', links: 0, images: 0, scripts: 0, styles: 0, quirks: false, frameset: false };
      try {
        var doc = new DOMParser().parseFromString(decodeText(files[p], report, p), 'text/html');
        info.title = (doc.title || '').trim();
        info.links = doc.querySelectorAll('a[href]').length;
        info.images = doc.querySelectorAll('img, picture source, video').length;
        info.scripts = toArray(doc.querySelectorAll('script')).filter(isExecScript).length;
        info.styles = doc.querySelectorAll('link[rel~="stylesheet"], style').length;
        info.quirks = doc.compatMode ? doc.compatMode === 'BackCompat' : !doc.doctype;
        info.frameset = !!doc.querySelector('frameset');
      } catch (e) { info.error = e.message; }
      pages.push(info);
    });
    report.finish();
    return {
      pages: pages, counts: counts, fileCount: Object.keys(files).length, bytes: bytes,
      hasIndex: pages.some(function (p) { return p.path === 'index.html' || p.path === 'index.htm'; }),
      stripped: norm.stripped, notes: report.entries
    };
  }

  /* ------------------------------------------------------------------ */
  /* convert()                                                           */
  /* ------------------------------------------------------------------ */

  function convert(rawFiles, options) {
    var opt = assign({ pagesDir: 'pages', rewriteJsLiterals: true, exclude: [] }, options || {});
    var report = new Report();
    var norm = normalizeFiles(rawFiles, report);
    var files = norm.files;
    var paths = Object.keys(files).sort();
    var lower = {};
    paths.forEach(function (p) { var l = p.toLowerCase(); if (!(l in lower)) lower[l] = p; });

    var excluded = {};
    (opt.exclude || []).forEach(function (p) {
      if (p === 'index.html' || p === 'render.html') report.add('warn', 'excluded-entry', p, p + ' is part of the new structure and is always converted, so it cannot be kept as .html.');
      else excluded[p] = true;
    });
    var pagePaths = paths.filter(function (p) { return PAGE_EXT.test(p) && !excluded[p]; });
    var keptHtml = paths.filter(function (p) { return PAGE_EXT.test(p) && excluded[p]; });
    keptHtml.forEach(function (p) {
      report.add('info', 'kept-html', p, 'Kept as an .html file at your request. It is not part of the rendered site structure.');
    });

    var empty = {
      ok: false, files: {}, pages: {}, pageList: [], defaultId: '', pagesDir: opt.pagesDir, rendererPath: '',
      report: null, stats: { pages: 0, linksRewritten: 0, resourcesRewritten: 0, scriptsMoved: 0, literalsRewritten: 0, files: paths.length }
    };
    if (!pagePaths.length) {
      report.add('error', 'no-pages', '', 'No HTML pages were found to convert.');
      empty.report = { entries: report.entries, counts: report.finish() };
      return empty;
    }

    /* page ids */
    var ids = {}, usedIds = {}, pageByPath = {};
    pagePaths.forEach(function (p) {
      var base = p.replace(PAGE_EXT, '').split('/').map(function (seg) {
        return seg.replace(/[^A-Za-z0-9_\-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
      }).join('/');
      var id = base, n = 2;
      while (usedIds[id.toLowerCase()]) id = base + '-' + (n++);
      usedIds[id.toLowerCase()] = true;
      ids[p] = id; pageByPath[p] = id;
    });

    var defaultId = '';
    ['index.html', 'index.htm'].forEach(function (p) { if (!defaultId && pageByPath[p]) defaultId = pageByPath[p]; });
    if (!defaultId) {
      ['home', 'main', 'default', 'start'].forEach(function (name) {
        pagePaths.forEach(function (p) { if (!defaultId && ids[p].toLowerCase() === name) defaultId = ids[p]; });
      });
      if (!defaultId) defaultId = ids[pagePaths[0]];
      report.add('warn', 'no-index', '', 'The site has no index.html. The new index.html shows "' + defaultId + '" as the home page.');
    }

    /* output locations */
    var nonPage = paths.filter(function (p) { return pageByPath[p] === undefined; });
    function pick(first, taken) {
      var c = first, n = 1;
      while (taken(c)) { c = first + '-js' + (n > 1 ? '-' + n : ''); n++; }
      return c;
    }
    var pagesDir = String(opt.pagesDir || 'pages').replace(/^\/+|\/+$/g, '').replace(/[^A-Za-z0-9_\-\/]/g, '-') || 'pages';
    var wantedDir = pagesDir;
    pagesDir = pick(pagesDir, function (d) { return nonPage.some(function (p) { return p.indexOf(d + '/') === 0; }); });
    if (pagesDir !== wantedDir) report.add('info', 'pages-dir', pagesDir + '/', 'The folder "' + wantedDir + '/" already holds other files, so converted pages go in "' + pagesDir + '/".');
    var rendererPath = 'js/renderer.js', rn = 1;
    while (files[rendererPath]) { rn++; rendererPath = 'js/html2js-renderer' + (rn > 2 ? '-' + rn : '') + '.js'; }

    /* ---------------- reference resolution ---------------- */

    function pageUrl(id, query, hash) {
      if (id === defaultId) return 'index.html' + query + hash;
      return 'render.html?page=' + id + (query ? '&' + query.slice(1) : '') + hash;
    }
    function lookup(rawRef, baseDir, self) {
      /* returns { kind, key, real } without reporting anything */
      var ref = rawRef.trim().replace(/\\/g, '/');
      var parts = splitRef(ref);
      var pth = safeDecode(parts.path);
      var absolute = pth.charAt(0) === '/';
      var np = normalizePath(absolute ? pth : (baseDir ? baseDir + '/' + pth : pth));
      var key = np.path, trailing = pth === '' || /\/$/.test(pth);
      var r = { parts: parts, key: key, absolute: absolute, escapes: np.escapes, kind: 'missing', caseFix: '' };
      if (np.escapes) return r;
      /* "?x=1" with no path means the same page again */
      if (pth === '' && self && pageByPath[self] !== undefined) { r.kind = 'page'; r.id = pageByPath[self]; return r; }
      if (!trailing && key) {
        if (pageByPath[key] !== undefined) { r.kind = 'page'; r.id = pageByPath[key]; return r; }
        if (files[key] !== undefined) { r.kind = 'asset'; r.real = key; return r; }
        var real = lower[key.toLowerCase()];
        if (real) {
          r.caseFix = real; r.real = real;
          if (pageByPath[real] !== undefined) { r.kind = 'page'; r.id = pageByPath[real]; } else r.kind = 'asset';
          return r;
        }
      }
      var cands = [key ? key + '/index.html' : 'index.html', key ? key + '/index.htm' : 'index.htm'];
      for (var i = 0; i < cands.length; i++) {
        if (pageByPath[cands[i]] !== undefined) { r.kind = 'page'; r.id = pageByPath[cands[i]]; return r; }
      }
      return r;
    }
    var stats = { pages: 0, linksRewritten: 0, resourcesRewritten: 0, scriptsMoved: 0, literalsRewritten: 0, files: paths.length };

    function resolve(rawRef, baseDir, fromFile, tag) {
      var trimmed = rawRef.trim();
      if (!trimmed || trimmed.charAt(0) === '#' || isExternal(trimmed)) return { out: rawRef, kind: 'skip' };
      var r = lookup(rawRef, baseDir, fromFile);
      if (r.escapes) {
        report.add('warn', 'outside-root', fromFile, '"' + rawRef + '" points outside the project folder and was left unchanged.');
        return { out: rawRef, kind: 'skip' };
      }
      if (r.caseFix) report.add('warn', 'case', fromFile, '"' + rawRef + '" only matches "' + r.caseFix + '" when letter case is ignored. That works on Windows and macOS but fails on most web servers.');
      var out;
      if (r.kind === 'page') {
        out = pageUrl(r.id, r.parts.query, r.parts.hash);
      } else {
        var target = r.real || r.key;
        var unchanged = baseDir === '' && !r.absolute && !/^\.\//.test(rawRef.trim()) && !r.caseFix && target === safeDecode(r.parts.path);
        out = unchanged ? rawRef : encodePath(target) + r.parts.query + r.parts.hash;
        if (r.kind === 'missing') {
          var isLink = !!LINK_TAGS[tag];
          report.add('error', isLink ? 'broken-link' : 'missing-asset', fromFile,
            (isLink ? 'Broken link: "' : 'Missing file: "') + rawRef.trim() + '" does not match any file in the project.');
          if (baseDir === '' && !r.absolute) out = rawRef;
        }
      }
      return { out: out, kind: r.kind };
    }

    function rewriteJsLiterals(code, baseDir, file) {
      var n = 0;
      var next = code.replace(JS_PAGE_LITERAL, function (m, q, body) {
        if (isExternal(body)) return m;
        var r = lookup(body, baseDir, file);
        if (r.kind === 'page' && !r.escapes) { n++; return q + pageUrl(r.id, r.parts.query, r.parts.hash) + q; }
        report.add('warn', 'js-html-reference', file, 'Script mentions "' + body + '", which is not a converted page. It was left unchanged.');
        return m;
      });
      if (n) { stats.literalsRewritten += n; report.add('info', 'js-links', file, 'Updated ' + n + ' page link(s) written as text inside scripts or event attributes.'); }
      return next;
    }

    /* ---------------- convert each page ---------------- */

    var pages = {}, quirksPages = [];
    function convertPage(path, id) {
      var text = decodeText(files[path], report, path);
      var doc = new DOMParser().parseFromString(text, 'text/html');
      var baseDir = dirname(path);
      var quirks = doc.compatMode ? doc.compatMode === 'BackCompat' : !doc.doctype;
      if (quirks) quirksPages.push(path);
      if (doc.querySelector('frameset')) report.add('error', 'frameset', path, 'This page uses <frameset>, which cannot be rebuilt by the renderer. Keep it as .html by turning it off in the page list.');

      toArray(doc.querySelectorAll('base')).forEach(function (b) {
        report.add('warn', 'base-tag', path, 'A <base> tag was removed. All pages now share one address, so a base URL would change every link. Check that links still point to the right place.');
        b.parentNode.removeChild(b);
      });

      var linkCount = 0, resCount = 0;
      walkUrls(doc, function (value, tag) {
        var r = resolve(value, baseDir, path, tag);
        if (r.out !== value) { if (r.kind === 'page') linkCount++; else resCount++; }
        return r.out;
      }, function (code, attr) {
        scanScript(code, 'The "' + attr + '" attribute', path, report);
        return opt.rewriteJsLiterals ? rewriteJsLiterals(code, baseDir, path) : code;
      });
      stats.linksRewritten += linkCount; stats.resourcesRewritten += resCount;

      /* scripts */
      var scripts = [];
      toArray(doc.querySelectorAll('script')).forEach(function (el) {
        if (!isExecScript(el)) return;
        var entry = { attrs: attrsOf(el) };
        if (el.hasAttribute('src')) {
          var src = el.getAttribute('src');
          if (!isExternal(src) && /\.html?([?#]|$)/i.test(src)) report.add('warn', 'html-script', path, 'Script source "' + src + '" is an HTML file.');
        } else {
          var code = el.textContent;
          var isModule = (el.getAttribute('type') || '').toLowerCase() === 'module';
          scanScript(code, 'An inline script', path, report);
          if (!isModule) checkSyntax(code, 'An inline script', path, report);
          if (opt.rewriteJsLiterals) code = rewriteJsLiterals(code, baseDir, path);
          entry.text = code;
          if (isModule && /\bDOMContentLoaded\b/.test(code)) report.add('warn', 'module-ready', path, 'An inline module script waits for DOMContentLoaded. Modules start after the renderer finishes, so that listener may never run.');
        }
        scripts.push(entry);
        el.parentNode.removeChild(el);
      });
      stats.scriptsMoved += scripts.length;

      /* head */
      var head = [];
      toArray(doc.head.children).forEach(function (el) {
        var tag = el.tagName.toLowerCase();
        if (tag === 'title' || tag === 'base') return;
        if (tag === 'meta' && el.hasAttribute('charset')) return;
        if (tag === 'meta' && /content-type/i.test(el.getAttribute('http-equiv') || '')) return;
        if (tag === 'noscript') { report.add('info', 'noscript', path, 'A <noscript> block in <head> was dropped. Converted pages need JavaScript to display.'); return; }
        var item = { tag: tag, attrs: attrsOf(el) };
        if (tag === 'style' || tag === 'script' || tag === 'template') item.text = el.textContent;
        head.push(item);
      });

      var htmlAttrs = attrsOf(doc.documentElement), bodyAttrs = attrsOf(doc.body), onload = '';
      if (bodyAttrs.onload !== undefined) { onload = bodyAttrs.onload; delete bodyAttrs.onload; }
      var page = { source: path, title: doc.title || '' };
      if (!isEmpty(htmlAttrs)) page.htmlAttrs = htmlAttrs;
      if (!isEmpty(bodyAttrs)) page.bodyAttrs = bodyAttrs;
      if (head.length) page.head = head;
      page.body = doc.body.innerHTML;
      if (scripts.length) page.scripts = scripts;
      if (onload) page.onload = onload;
      return page;
    }

    pagePaths.forEach(function (path) {
      try { pages[ids[path]] = convertPage(path, ids[path]); stats.pages++; }
      catch (e) { report.add('error', 'convert-failed', path, 'This page could not be converted: ' + e.message); }
    });

    /* quirks vs standards mode */
    var useDoctype = quirksPages.length * 2 <= pagePaths.length;
    if (!useDoctype) report.add('info', 'quirks-shell', 'index.html', 'Most pages had no standards-mode doctype, so index.html and render.html also omit it to keep the original layout rules.');
    pagePaths.forEach(function (p) {
      var isQuirks = quirksPages.indexOf(p) >= 0;
      if (isQuirks === useDoctype) {
        report.add('warn', 'doctype-mismatch', p, isQuirks
          ? 'This page was written without a standards-mode doctype but will now render in standards mode. Spacing and sizing may shift slightly.'
          : 'This page used standards mode but will now render in quirks mode, because most pages in the site did not. Spacing and sizing may shift slightly.');
      }
    });

    /* ---------------- scan the rest of the project ---------------- */

    paths.forEach(function (p) {
      var kind = fileKind(p);
      if (kind === 'css' && files[p].length < 3e6) {
        var css = decodeText(files[p], report, p), base = dirname(p);
        rewriteCss(css, function (ref) {
          var t = ref.trim();
          if (!t || t.charAt(0) === '#' || isExternal(t)) return ref;
          var r = lookup(ref, base);
          if (r.escapes) return ref;
          if (r.kind === 'missing') report.add('error', 'missing-asset', p, 'Missing file: "' + t + '" (referenced from this stylesheet) does not match any file in the project.');
          else if (r.caseFix) report.add('warn', 'case', p, '"' + t + '" only matches "' + r.caseFix + '" when letter case is ignored.');
          return ref;
        });
      }
      if (kind === 'js' && files[p].length < 3e6 && !VENDOR_JS.test(p)) {
        var js = decodeText(files[p], report, p);
        scanScript(js, 'This script', p, report);
        checkSyntax(js, 'This script', p, report);
        var seen = {}, lits = [];
        js.replace(JS_PAGE_LITERAL, function (m, q, body) { if (!isExternal(body) && !seen[body]) { seen[body] = 1; lits.push(body); } return m; });
        if (lits.length) {
          report.add('warn', 'js-html-reference', p, 'This script mentions HTML files (' + lits.slice(0, 4).join(', ') + (lits.length > 4 ? ', ...' : '') +
            '). Links to converted pages must be changed to render.html?page=<name> by hand. Only scripts inside HTML pages are updated automatically.');
        }
      }
    });

    /* ---------------- assemble output ---------------- */

    var out = {};
    nonPage.forEach(function (p) { out[p] = files[p]; });
    var pageList = [];
    var jsCheck = typeof Function === 'function';
    Object.keys(pages).forEach(function (id) {
      var page = pages[id];
      var code = emitPageFile(id, page);
      var outPath = pagesDir + '/' + id + '.js';
      out[outPath] = utf8(code);
      pageList.push({ id: id, source: page.source, out: outPath, title: page.title, url: pageUrl(id, '', ''), size: code.length });
      /* verify the generated file: it must parse and reproduce the page exactly */
      if (jsCheck) {
        try {
          var fake = {};
          new Function('window', code)(fake);
          var back = fake.__pages && fake.__pages[id];
          if (!back || JSON.stringify(back) !== JSON.stringify(page)) {
            report.add('error', 'roundtrip', outPath, 'The generated file does not reproduce the original page exactly. Please report this page.');
          }
        } catch (e) {
          if (e && e.name === 'SyntaxError') report.add('error', 'syntax-error', outPath, 'The generated file has a syntax error: ' + e.message);
        }
      }
    });
    pageList.sort(function (a, b) { return a.source < b.source ? -1 : 1; });
    out[rendererPath] = utf8(rendererFile(pagesDir));
    out['index.html'] = utf8(shellHtml({ doctype: useDoctype, rendererPath: rendererPath, pageId: defaultId }));
    out['render.html'] = utf8(shellHtml({ doctype: useDoctype, rendererPath: rendererPath, pageId: '' }));

    var counts = report.finish();
    return {
      ok: counts.error === 0, files: out, pages: pages, pageList: pageList, defaultId: defaultId,
      pagesDir: pagesDir, rendererPath: rendererPath, keptHtml: keptHtml, quirks: !useDoctype,
      report: { entries: report.entries, counts: counts }, stats: stats, stripped: norm.stripped, options: opt
    };
  }

  /* ------------------------------------------------------------------ */
  /* Preview (self-contained srcdoc for a sandboxed iframe)              */
  /* ------------------------------------------------------------------ */

  function previewPreamble() {
    function send(m) { try { parent.postMessage(m, '*'); } catch (e) { /* ignore */ } }
    window.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t !== window && t.tagName) {
        send({ type: 'h2j-error', kind: 'resource', message: 'Failed to load <' + t.tagName.toLowerCase() + '> ' + (t.getAttribute('src') || t.getAttribute('href') || '') });
        return;
      }
      send({ type: 'h2j-error', kind: 'script', message: (e.message || 'Script error') + (e.lineno ? ' (line ' + e.lineno + ')' : '') });
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      send({ type: 'h2j-error', kind: 'script', message: 'Unhandled promise rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason) });
    });
    var ce = console.error;
    console.error = function () {
      send({ type: 'h2j-error', kind: 'console', message: Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : String(a); }).join(' ') });
      return ce.apply(console, arguments);
    };
    window.addEventListener('h2j:rendered', function (e) { send({ type: 'h2j-ready', page: e.detail && e.detail.page }); });
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href], area[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:|^\/\//.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); return; }
      e.preventDefault();
      send({ type: 'h2j-nav', href: href });
    }, true);
    document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  }

  function buildPreview(result, id, options) {
    var page = result.pages[id];
    if (!page) throw new Error('Unknown page: ' + id);
    var LIMIT = (options && options.maxAssetBytes) || 12 * 1024 * 1024;
    var files = result.files, cache = {}, busy = {}, notes = [];
    var reserved = {}; reserved['index.html'] = 1; reserved['render.html'] = 1; reserved[result.rendererPath] = 1;

    function mimeOf(path) { return MIME[extOf(path)] || 'application/octet-stream'; }
    function resolveKey(ref, baseDir) {
      var parts = splitRef(ref.trim().replace(/\\/g, '/'));
      var pth = safeDecode(parts.path);
      var np = normalizePath(pth.charAt(0) === '/' ? pth : (baseDir ? baseDir + '/' + pth : pth));
      return np.escapes ? '' : np.path;
    }
    function dataUrl(path, depth) {
      if (cache[path] !== undefined) return cache[path];
      var bytes = files[path];
      if (!bytes) return null;
      if (bytes.length > LIMIT) { notes.push(path + ' is larger than ' + formatBytes(LIMIT) + ' and is not shown in the preview.'); return null; }
      if (busy[path] || depth > 6) return null;
      busy[path] = true;
      var url;
      if (extOf(path) === 'css') {
        var css = rewriteCss(decodeText(bytes), function (ref) { return mapRef(ref, dirname(path), 'css', depth + 1); });
        url = 'data:text/css;base64,' + toBase64(utf8(css));
      } else {
        url = 'data:' + mimeOf(path) + ';base64,' + toBase64(bytes);
      }
      busy[path] = false;
      cache[path] = url;
      return url;
    }
    function mapRef(ref, baseDir, tag, depth) {
      var t = ref.trim();
      if (!t || t.charAt(0) === '#' || isExternal(t)) return ref;
      if (LINK_TAGS[tag] && tag !== 'iframe' && tag !== 'frame') return ref;
      var parts = splitRef(t.replace(/\\/g, '/'));
      var key = resolveKey(t, baseDir);
      if (reserved[key]) return ref;
      var url = key ? dataUrl(key, depth || 0) : null;
      if (url) return url;
      return key && files[key] ? ref : 'h2j-missing:' + (key || parts.path);
    }

    var bodyDoc = new DOMParser().parseFromString('<!doctype html><html><body>' + page.body + '</body></html>', 'text/html');
    walkUrls(bodyDoc, function (value, tag) { return mapRef(value, '', tag, 0); });

    var p = {
      source: page.source, title: page.title, htmlAttrs: page.htmlAttrs, bodyAttrs: page.bodyAttrs,
      body: bodyDoc.body.innerHTML, onload: page.onload
    };
    p.head = (page.head || []).map(function (h) {
      var attrs = assign({}, h.attrs);
      if (h.tag === 'link' && attrs.href) attrs.href = mapRef(attrs.href, '', 'link', 0);
      if (h.tag === 'meta' && attrs.content && /^(og:image|twitter:image)/i.test(attrs.property || attrs.name || '')) attrs.content = mapRef(attrs.content, '', 'meta', 0);
      var item = { tag: h.tag, attrs: attrs };
      if (h.text != null) item.text = h.tag === 'style' ? rewriteCss(h.text, function (r) { return mapRef(r, '', 'css', 0); }) : h.text;
      return item;
    });
    p.scripts = (page.scripts || []).map(function (s) {
      var attrs = assign({}, s.attrs), src = attrs.src;
      if (src && !isExternal(src)) {
        var key = resolveKey(src, '');
        if (files[key]) {
          delete attrs.src;
          return { attrs: attrs, text: decodeText(files[key]) };
        }
        attrs.src = 'h2j-missing:' + key;
      }
      return { attrs: attrs, text: s.text };
    });
    ['htmlAttrs', 'bodyAttrs', 'onload'].forEach(function (k) { if (p[k] === undefined) delete p[k]; });

    var registry = {}; registry[id] = p;
    function inlineJson(o) {
      return JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }
    function inlineCode(src) { return src.replace(/<\/script/gi, '<\\/script'); }
    var srcdoc = (result.quirks ? '' : '<!doctype html>\n') +
      '<html><head><meta charset="utf-8"><script>(' + inlineCode(previewPreamble.toString()) + ')();</script></head><body>' +
      '<script>window.__pages = ' + inlineJson(registry) + '; window.__PAGE__ = ' + inlineJson(id) + ';</script>' +
      '<script>' + inlineCode(rendererSource(result.pagesDir)) + '</script></body></html>';
    return { srcdoc: srcdoc, notes: notes };
  }

  /* ------------------------------------------------------------------ */
  /* Text report                                                         */
  /* ------------------------------------------------------------------ */

  function reportToText(result) {
    var c = result.report.counts, lines = [];
    lines.push('HTML-to-JS Converter report (v' + VERSION + ')');
    lines.push('Pages converted: ' + result.stats.pages + '   Errors: ' + c.error + '   Warnings: ' + c.warn + '   Notes: ' + c.info);
    lines.push('Page links rewritten: ' + result.stats.linksRewritten + '   Resource references rewritten: ' + result.stats.resourcesRewritten +
      '   Scripts moved into the renderer: ' + result.stats.scriptsMoved);
    lines.push('Pages folder: ' + result.pagesDir + '/   Renderer: ' + result.rendererPath + '   Home page: ' + result.defaultId);
    lines.push('');
    lines.push('Converted pages');
    result.pageList.forEach(function (p) { lines.push('  ' + p.source + '  ->  ' + p.out + '   (' + p.url + ')'); });
    lines.push('');
    lines.push('Findings');
    if (!result.report.entries.length) lines.push('  None.');
    result.report.entries.forEach(function (e) {
      lines.push('  [' + e.level.toUpperCase() + '] ' + (e.file ? e.file + ': ' : '') + e.message);
    });
    return lines.join('\n') + '\n';
  }

  return {
    version: VERSION, analyze: analyze, convert: convert, buildPreview: buildPreview, reportToText: reportToText,
    formatBytes: formatBytes, fileKind: fileKind, rendererSource: rendererSource
  };
});
