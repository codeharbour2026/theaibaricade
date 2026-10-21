const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Robots = require('./robots.js');
const CRAWLERS = require('./crawlers.js');

const existing = fs.readFileSync(path.join(__dirname, 'existing-robots.txt'), 'utf8');
const byToken = t => CRAWLERS.find(c => c.token === t);
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok -', name); }

test('original lines are all preserved, in order', () => {
  const r = Robots.merge(existing, { crawlers: CRAWLERS.filter(c => c.category === 'training'), mode: 'full' });
  assert.deepStrictEqual(r.errors, []);
  const out = r.text.split('\n');
  let i = 0;
  existing.split('\n').filter((l, idx, a) => !(idx === a.length - 1 && l === '')).forEach(line => {
    const found = out.indexOf(line, i);
    assert.ok(found >= 0, 'missing or reordered: ' + line);
    i = found + 1;
  });
});

test('already-blocked crawlers are skipped, not duplicated', () => {
  const r = Robots.merge(existing, { crawlers: [byToken('GPTBot'), byToken('ClaudeBot')], mode: 'full' });
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.skipped.length, 2);
  assert.strictEqual(r.text, existing);
});

test('new crawlers are appended as their own groups', () => {
  const r = Robots.merge(existing, { crawlers: [byToken('Meta-ExternalAgent')], mode: 'full' });
  assert.ok(r.text.includes('User-agent: Meta-ExternalAgent\nDisallow: /\n'));
  assert.strictEqual(r.added.length, 1);
});

test('merge is idempotent', () => {
  const opts = { crawlers: CRAWLERS.filter(c => c.category === 'training'), mode: 'full' };
  const once = Robots.merge(existing, opts).text;
  const twice = Robots.merge(once, opts);
  assert.strictEqual(twice.text, once);
  assert.strictEqual(twice.added.length, 0);
});

test('path mode inserts into an existing group without touching other groups', () => {
  const file = 'User-agent: GPTBot\nDisallow: /admin/\n\nUser-agent: *\nDisallow: /tmp/\n';
  const r = Robots.merge(file, { crawlers: [byToken('GPTBot')], mode: 'paths', paths: ['/blog/'] });
  assert.strictEqual(r.text, 'User-agent: GPTBot\nDisallow: /admin/\nDisallow: /blog/\n\nUser-agent: *\nDisallow: /tmp/\n');
});

test('Disallow / already covers any path', () => {
  const r = Robots.merge(existing, { crawlers: [byToken('GPTBot')], mode: 'paths', paths: ['/blog/'] });
  assert.strictEqual(r.added.length, 0);
});

test('empty file produces a valid new file', () => {
  const r = Robots.merge('', { crawlers: [byToken('GPTBot')], mode: 'full', domain: 'example.com' });
  assert.ok(r.text.startsWith('# --- Added by AI Barricade'));
  assert.ok(r.text.includes('User-agent: GPTBot\nDisallow: /'));
});

test('sitemap added once, validated against domain', () => {
  const o = { crawlers: [byToken('GPTBot')], mode: 'full', domain: 'example.com', sitemap: 'https://example.com/sitemap.xml' };
  const r = Robots.merge(existing, o);
  assert.ok(r.text.trimEnd().endsWith('Sitemap: https://example.com/sitemap.xml'));
  assert.strictEqual(Robots.merge(r.text, o).text, r.text);
  assert.ok(Robots.merge(existing, Object.assign({}, o, { sitemap: 'https://evil.com/s.xml' })).errors.length);
});

test('Allow rules and shared groups produce warnings', () => {
  const file = 'User-agent: GPTBot\nUser-agent: ClaudeBot\nAllow: /public/\nDisallow: /x/\n';
  const r = Robots.merge(file, { crawlers: [byToken('GPTBot')], mode: 'full' });
  assert.ok(r.warnings.some(w => /shares a rule group/.test(w)));
  assert.ok(r.warnings.some(w => /Allow/.test(w)));
});

test('CRLF input and BOM are handled', () => {
  const r = Robots.merge('﻿User-agent: GPTBot\r\nDisallow: /\r\n', { crawlers: [byToken('GPTBot')], mode: 'full' });
  assert.strictEqual(r.added.length, 0);
});

test('validation rejects bad input', () => {
  assert.strictEqual(Robots.normaliseDomain('https://www.Example.com/path?x=1'), 'www.example.com');
  ['localhost', '127.0.0.1', 'exa mple.com', 'a..com', '<script>.com', ''].forEach(d => assert.strictEqual(Robots.normaliseDomain(d), null, d));
  assert.ok(Robots.validatePath('private'));
  assert.ok(Robots.validatePath('/a b'));
  assert.ok(Robots.validatePath('/a#b'));
  assert.ok(Robots.validatePath('/a\nUser-agent: *'));
  assert.strictEqual(Robots.validatePath('/private/*.pdf$'), null);
  assert.ok(Robots.merge('', { crawlers: [byToken('GPTBot')], mode: 'paths', paths: ['/ok', '/bad path'] }).errors.length);
  assert.ok(Robots.merge('x'.repeat(600 * 1024), { crawlers: [byToken('GPTBot')], mode: 'full' }).errors.length);
  assert.ok(Robots.merge('', { crawlers: [], mode: 'full' }).errors.length);
});

test('detectBlocked reports existing coverage', () => {
  const d = Robots.detectBlocked(existing, ['GPTBot', 'OAI-SearchBot', 'FacebookBot']);
  assert.deepStrictEqual(d, { 'GPTBot': true, 'OAI-SearchBot': false, 'FacebookBot': true });
});

test('your existing file: 10 groups, no wildcard, no sitemap', () => {
  const p = Robots.parse(existing);
  assert.strictEqual(p.groups.length, 10);
  assert.strictEqual(p.sitemaps.length, 0);
  assert.ok(!p.groups.some(g => g.agents.includes('*')));
});

console.log('\n' + n + ' tests passed');
