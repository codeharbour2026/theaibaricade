/* Builds dist/html-to-js-converter.html: the whole tool in one file that works offline
 * (apart from the optional Google Fonts stylesheet). Run: node build.js */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

let html = read('index.html');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('styles.css') + '</style>');
['jszip.min.js', 'converter-core.js', 'sample-site.js', 'app.js'].forEach((f) => {
  const tag = '<script src="' + f + '"></script>';
  if (!html.includes(tag)) throw new Error('Missing script tag for ' + f);
  html = html.replace(tag, () => '<script>\n' + safeScript(read(f)) + '\n</script>');
});

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'html-to-js-converter.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(root, out) + ' (' + (html.length / 1024).toFixed(0) + ' KB)');
