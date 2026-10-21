/*
 * AI Barricade - robots.txt parser, merger and validators (Level 1).
 * Works in the browser (global `Robots`) and in Node (module.exports) so the
 * same code can be unit tested.
 *
 * Design rule: never destroy what the customer already has. Every original
 * line (comments, blank lines, Sitemap, unknown directives) is kept in order.
 * We only INSERT lines. Nothing is removed or reworded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Robots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BYTES = 500 * 1024; // Google processes at most 500 KiB of robots.txt.
  var MAX_PATH_LEN = 200;
  var MAX_PATHS = 100;

  /* ---------- validation ---------- */

  // Accepts "example.com", "https://www.example.com/anything"; returns a bare
  // lowercase hostname or null. Rejects IPs, localhost and anything odd.
  function normaliseDomain(input) {
    var s = String(input || '').trim().toLowerCase();
    if (!s) return null;
    s = s.replace(/^https?:\/\//, '').replace(/[\/?#].*$/, '').replace(/:\d+$/, '');
    var ok = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s);
    return ok ? s : null;
  }

  // Robots paths must start with "/" and contain no whitespace, control
  // characters or "#" (which would start a comment and change the meaning).
  function validatePath(p) {
    if (typeof p !== 'string') return 'Path must be text.';
    if (!p.length) return 'Path is empty.';
    if (p.length > MAX_PATH_LEN) return 'Path is longer than ' + MAX_PATH_LEN + ' characters.';
    if (p.charAt(0) !== '/') return 'Path must start with "/".';
    if (/[\s#\u0000-\u001f\u007f]/.test(p)) return 'Path cannot contain spaces, "#" or control characters.';
    return null;
  }

  function parsePathList(text) {
    var out = [], errors = [], seen = {};
    String(text || '').split(/\r\n|\r|\n/).forEach(function (line, i) {
      var p = line.trim();
      if (!p) return;
      var err = validatePath(p);
      if (err) { errors.push('Line ' + (i + 1) + ' (' + p.slice(0, 40) + '): ' + err); return; }
      if (!seen[p]) { seen[p] = true; out.push(p); }
    });
    if (out.length > MAX_PATHS) errors.push('Too many paths (max ' + MAX_PATHS + ').');
    return { paths: out, errors: errors };
  }

  function validateSitemap(url, domain) {
    var u;
    try { u = new URL(String(url || '').trim()); } catch (e) { return 'Sitemap must be a full URL such as https://example.com/sitemap.xml.'; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Sitemap must use http or https.';
    if (/\s/.test(url.trim())) return 'Sitemap URL cannot contain spaces.';
    if (domain && u.hostname.toLowerCase().replace(/^www\./, '') !== domain.replace(/^www\./, '')) {
      return 'Sitemap host (' + u.hostname + ') does not match your domain (' + domain + ').';
    }
    return null;
  }

  /* ---------- parsing ---------- */

  function directive(raw) {
    var s = raw.replace(/#.*$/, '').trim();
    var m = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/.exec(s);
    return m ? { name: m[1].toLowerCase(), value: m[2].trim() } : null;
  }

  function parse(text) {
    var src = String(text || '').replace(/^﻿/, '');
    var raws = src.split(/\r\n|\r|\n/);
    if (raws.length && raws[raws.length - 1] === '') raws.pop();
    if (!src.trim()) raws = [];

    var lines = [], groups = [], cur = null, sitemaps = [];
    raws.forEach(function (raw) {
      var d = directive(raw);
      var entry = { raw: raw, kind: 'other', group: null };
      if (d && d.name === 'user-agent') {
        if (!cur || cur.hasRules) {
          cur = { id: groups.length, agents: [], lastIdx: -1, hasRules: false, disallow: [], allow: [], emptyDisallow: false };
          groups.push(cur);
        }
        cur.agents.push(d.value);
        cur.lastIdx = lines.length;
        entry.kind = 'ua'; entry.group = cur.id;
      } else if (d && d.name === 'sitemap') {
        entry.kind = 'sitemap'; sitemaps.push(d.value);
      } else if (d && cur) {
        cur.hasRules = true; cur.lastIdx = lines.length;
        entry.kind = 'rule'; entry.group = cur.id;
        if (d.name === 'disallow') { if (d.value === '') cur.emptyDisallow = true; else cur.disallow.push(d.value); }
        else if (d.name === 'allow') cur.allow.push(d.value);
      }
      lines.push(entry);
    });
    return { lines: lines, groups: groups, sitemaps: sitemaps };
  }

  function findGroup(parsed, token) {
    var t = token.toLowerCase();
    for (var i = 0; i < parsed.groups.length; i++) {
      var g = parsed.groups[i];
      for (var j = 0; j < g.agents.length; j++) if (g.agents[j].toLowerCase() === t) return g;
    }
    return null;
  }

  // Which of the given tokens are already fully blocked (Disallow: /)?
  function detectBlocked(text, tokens) {
    var parsed = parse(text), out = {};
    tokens.forEach(function (tok) {
      var g = findGroup(parsed, tok);
      out[tok] = !!(g && g.disallow.indexOf('/') !== -1);
    });
    return out;
  }

  /* ---------- merge ---------- */

  /*
   * options: {
   *   crawlers: [{token, operator, category}],
   *   mode: 'full' | 'paths',
   *   paths: ['/private/'],        // used when mode === 'paths'
   *   sitemap: 'https://...',      // optional
   *   domain: 'example.com'        // optional, used in the header comment
   * }
   * returns { text, added: [...], skipped: [...], warnings: [...], errors: [...] }
   */
  function merge(existingText, options) {
    var o = options || {};
    var result = { text: '', added: [], skipped: [], warnings: [], errors: [] };
    var existing = String(existingText || '');

    if (existing.length > MAX_BYTES) {
      result.errors.push('Existing robots.txt is larger than 500 KiB. Crawlers ignore content past that limit, so trim it before merging.');
      return result;
    }
    var crawlers = o.crawlers || [];
    if (!crawlers.length) { result.errors.push('Select at least one crawler.'); return result; }

    var paths;
    if (o.mode === 'paths') {
      paths = (o.paths || []).slice();
      if (!paths.length) { result.errors.push('Add at least one path, or choose "Block the whole site".'); return result; }
      for (var i = 0; i < paths.length; i++) {
        var pe = validatePath(paths[i]);
        if (pe) { result.errors.push(paths[i].slice(0, 40) + ': ' + pe); return result; }
      }
    } else {
      paths = ['/'];
    }
    if (o.sitemap) {
      var se = validateSitemap(o.sitemap, o.domain);
      if (se) { result.errors.push(se); return result; }
    }

    var parsed = parse(existing);
    var lines = parsed.lines.map(function (l) { return l.raw; });
    var inserts = {};      // lastIdx -> [lines]
    var newBlocks = [];
    var warnedGroups = {};

    function warnOnce(g, key, msg) {
      var k = g.id + ':' + key;
      if (!warnedGroups[k]) { warnedGroups[k] = true; result.warnings.push(msg); }
    }

    crawlers.forEach(function (c) {
      var g = findGroup(parsed, c.token);
      if (g) {
        var toAdd = [];
        paths.forEach(function (p) {
          if (g.disallow.indexOf(p) !== -1 || (g.disallow.indexOf('/') !== -1)) {
            result.skipped.push({ agent: c.token, path: p, reason: 'already blocked in your file' });
          } else toAdd.push(p);
        });
        if (toAdd.length) {
          var at = g.lastIdx;
          inserts[at] = (inserts[at] || []).concat(toAdd.map(function (p) { return 'Disallow: ' + p; }));
          toAdd.forEach(function (p) { result.added.push({ agent: c.token, path: p, existingGroup: true }); });
        }
        if (g.agents.length > 1) warnOnce(g, 'shared', c.token + ' shares a rule group with ' + (g.agents.length - 1) + ' other crawler(s) in your file. Added rules apply to all of them.');
        if (g.allow.length) warnOnce(g, 'allow', c.token + ' has Allow rules in your file. Allow can override a Disallow of the same or shorter length, so review the result.');
        if (g.emptyDisallow && toAdd.length) warnOnce(g, 'empty', c.token + ' has an empty "Disallow:" line (allow everything). It is kept; the new Disallow lines take effect alongside it.');
      } else {
        paths.forEach(function (p) { result.added.push({ agent: c.token, path: p, existingGroup: false }); });
        var block = ['# ' + c.token + ' (' + c.operator + ')', 'User-agent: ' + c.token];
        paths.forEach(function (p) { block.push('Disallow: ' + p); });
        newBlocks.push(block);
      }
    });

    // Apply insertions from the bottom up so indexes stay valid.
    Object.keys(inserts).map(Number).sort(function (a, b) { return b - a; }).forEach(function (idx) {
      Array.prototype.splice.apply(lines, [idx + 1, 0].concat(inserts[idx]));
    });

    var star = null;
    parsed.groups.forEach(function (g) { if (g.agents.indexOf('*') !== -1) star = g; });
    if (star && newBlocks.length) {
      result.warnings.push('Your file has a "User-agent: *" group. Crawler-specific groups do not inherit from it, so the crawlers added here follow only their own rules. That is the intended behaviour for a block.');
    }

    var tail = [];
    if (newBlocks.length) {
      tail.push('# --- Added by AI Barricade (Basic Rules)' + (o.domain ? ' for ' + o.domain : '') + ' ---');
      newBlocks.forEach(function (b, i) { if (i) tail.push(''); tail = tail.concat(b); });
    }
    if (o.sitemap) {
      var s = o.sitemap.trim();
      var has = parsed.sitemaps.some(function (x) { return x.toLowerCase() === s.toLowerCase(); });
      if (has) result.skipped.push({ agent: 'Sitemap', path: s, reason: 'already declared in your file' });
      else {
        if (tail.length) tail.push('');
        tail.push('Sitemap: ' + s);
        result.added.push({ agent: 'Sitemap', path: s, existingGroup: false });
      }
    }

    if (tail.length && lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines = lines.concat(tail);
    result.text = lines.join('\n') + (lines.length ? '\n' : '');
    return result;
  }

  return {
    MAX_BYTES: MAX_BYTES,
    normaliseDomain: normaliseDomain,
    validatePath: validatePath,
    parsePathList: parsePathList,
    validateSitemap: validateSitemap,
    parse: parse,
    detectBlocked: detectBlocked,
    merge: merge
  };
});
