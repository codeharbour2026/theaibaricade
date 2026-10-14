/* A small sample website used by the "Try the sample site" button and by the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SampleSite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAV = function (prefix) {
    return '<nav id="nav" aria-label="Main">\n' +
      '    <a href="' + prefix + 'index.html">Home</a>\n' +
      '    <a href="' + prefix + 'about.html">About</a>\n' +
      '    <a href="' + prefix + 'products.html">Products</a>\n' +
      '    <a href="' + prefix + 'blog/news.html">News</a>\n' +
      '    <a href="' + prefix + 'contact.html">Contact</a>\n' +
      '  </nav>';
  };
  var HEADER = function (prefix) {
    return '<header class="site-header">\n  <a class="brand" href="' + prefix + 'index.html"><img src="' + prefix + 'images/logo.svg" alt="" width="34" height="34"> Harbour Street Bakery</a>\n' +
      '  <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="nav">Menu</button>\n  ' + NAV(prefix) + '\n</header>';
  };
  var FOOTER = function (prefix) {
    return '<footer class="site-footer">\n  <p>&copy; <span id="year">2024</span> Harbour Street Bakery &middot; 14 Harbour Street &middot; <a href="' + prefix + 'contact.html#hours">Opening hours</a></p>\n</footer>';
  };
  var HEAD = function (prefix, title, desc) {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + title + '</title>\n<meta name="description" content="' + desc + '">\n' +
      '<link rel="stylesheet" href="' + prefix + 'css/style.css">\n<link rel="icon" href="' + prefix + 'images/logo.svg" type="image/svg+xml">\n</head>\n';
  };

  var files = {};

  files['index.html'] = HEAD('', 'Harbour Street Bakery', 'Sourdough, pastries and coffee baked daily on Harbour Street.') +
    '<body class="home">\n' + HEADER('') + '\n<main>\n' +
    '  <section class="hero">\n    <h1>Bread worth getting up for</h1>\n    <p>Slow-fermented sourdough, butter pastries and filter coffee, baked every morning from 6am.</p>\n' +
    '    <p><a class="button" href="products.html">See today\'s bake</a> <a class="button ghost" href="contact.html#hours">Opening hours</a></p>\n  </section>\n' +
    '  <section class="cards">\n' +
    '    <article><img src="images/loaf.svg" alt="Sourdough loaf" width="120" height="120"><h2>Country sourdough</h2><p>Thirty-hour ferment, blistered crust.</p></article>\n' +
    '    <article><img src="images/croissant.svg" alt="Croissant" width="120" height="120"><h2>Butter croissant</h2><p>Laminated by hand, 27 layers.</p></article>\n' +
    '  </section>\n</main>\n' + FOOTER('') + '\n<script src="js/script.js"></script>\n</body>\n</html>\n';

  files['about.html'] = HEAD('', 'About us | Harbour Street Bakery', 'Who bakes the bread and why.') +
    '<body>\n' + HEADER('') + '\n<main class="prose">\n  <h1>About us</h1>\n' +
    '  <p>We opened in 2016 with one oven and a bag of flour from the mill down the road. Today we bake about 400 loaves a day, and the starter is still the original one.</p>\n' +
    '  <p>Questions about allergens or wholesale orders? <a href="contact.html">Get in touch</a> or browse <a href="products.html">the menu</a>.</p>\n' +
    '  <blockquote>"Flour, water, salt &amp; time." &ndash; our whole recipe</blockquote>\n</main>\n' +
    FOOTER('') + '\n<script src="js/script.js"></script>\n</body>\n</html>\n';

  files['products.html'] = HEAD('', 'Products | Harbour Street Bakery', 'What we bake each day.') +
    '<body>\n' + HEADER('') + '\n<main class="prose">\n  <h1>Products</h1>\n' +
    '  <div class="filters" role="group" aria-label="Filter products">\n    <button type="button" data-filter="all" class="on">All</button>\n    <button type="button" data-filter="bread">Bread</button>\n    <button type="button" data-filter="pastry">Pastry</button>\n  </div>\n' +
    '  <ul class="products">\n' +
    '    <li data-kind="bread"><img src="images/loaf.svg" srcset="images/loaf.svg 1x, images/loaf.svg 2x" alt="" width="64" height="64"> Country sourdough <strong>$9</strong></li>\n' +
    '    <li data-kind="bread"><img src="images/loaf.svg" alt="" width="64" height="64"> Rye &amp; caraway <strong>$10</strong></li>\n' +
    '    <li data-kind="pastry"><img src="images/croissant.svg" alt="" width="64" height="64"> Butter croissant <strong>$5</strong></li>\n' +
    '    <li data-kind="pastry"><img src="images/croissant.svg" alt="" width="64" height="64"> Almond croissant <strong>$6</strong></li>\n' +
    '  </ul>\n  <p style="background:url(images/hero.svg) center/cover;padding:1rem;border-radius:8px">Pre-order for weekend pickup on the <a href="contact.html#order">contact page</a>.</p>\n</main>\n' +
    FOOTER('') + '\n<script src="js/script.js"></script>\n</body>\n</html>\n';

  files['contact.html'] = HEAD('', 'Contact | Harbour Street Bakery', 'Opening hours and how to reach us.') +
    '<body>\n' + HEADER('') + '\n<main class="prose">\n  <h1>Contact</h1>\n' +
    '  <h2 id="hours">Opening hours</h2>\n  <p>Tuesday to Saturday 6am&ndash;3pm. Sunday 7am&ndash;1pm. Closed Monday.</p>\n' +
    '  <h2 id="order">Order ahead</h2>\n  <form id="contact-form" novalidate>\n    <label for="name">Name</label><input id="name" name="name" required>\n' +
    '    <label for="msg">Your order or question</label><textarea id="msg" name="msg" rows="3" required></textarea>\n    <button class="button" type="submit">Send</button>\n' +
    '    <p class="ok" hidden>Thanks! We will reply within a day. (Demo form: nothing is sent.)</p>\n  </form>\n</main>\n' +
    FOOTER('') + '\n<script src="js/script.js"></script>\n</body>\n</html>\n';

  files['blog/news.html'] = HEAD('../', 'News | Harbour Street Bakery', 'Updates from the bakery.') +
    '<style>.news-hero{background:url(../images/hero.svg) center/cover;color:#fff;padding:2rem 1rem;border-radius:8px}</style>\n' +
    '<body>\n' + HEADER('../') + '\n<main class="prose">\n  <div class="news-hero"><h1>News</h1><p>Rye is back this Saturday.</p></div>\n' +
    '  <h2>New Saturday rye</h2>\n  <p>After a long trial we are adding a caraway rye. Read more <a href="../about.html">about our flour</a> or <a href="../index.html">head home</a>.</p>\n' +
    '  <p><button class="button" id="subscribe" type="button">Get the newsletter</button></p>\n</main>\n' +
    FOOTER('../') + '\n<script src="../js/script.js"></script>\n' +
    '<script>\n  document.getElementById("subscribe").addEventListener("click", function () {\n    window.location.href = "../contact.html#order";\n  });\n</script>\n</body>\n</html>\n';

  files['css/style.css'] =
    ':root{--ink:#2a1f17;--paper:#fbf6ee;--crust:#b5651d;--line:#e6d9c6}\n' +
    '*{box-sizing:border-box}\nbody{margin:0;font:17px/1.6 Georgia,serif;color:var(--ink);background:var(--paper)}\n' +
    'a{color:var(--crust)}\n.site-header{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;padding:.75rem 1.25rem;border-bottom:1px solid var(--line)}\n' +
    '.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;text-decoration:none;color:var(--ink)}\n' +
    '.site-header nav{margin-left:auto;display:flex;gap:1rem}\n.menu-toggle{display:none}\n' +
    '.hero{padding:4rem 1.25rem;background:linear-gradient(rgba(42,31,23,.55),rgba(42,31,23,.55)),url("../images/hero.svg") center/cover;color:#fff}\n' +
    '.hero h1{font-size:2.6rem;margin:0 0 .5rem}\n.button{display:inline-block;padding:.5rem 1rem;border:0;border-radius:6px;background:var(--crust);color:#fff;text-decoration:none;font:inherit;cursor:pointer}\n' +
    '.button.ghost{background:transparent;border:1px solid #fff}\n.cards{display:flex;flex-wrap:wrap;gap:1.25rem;padding:2rem 1.25rem}\n' +
    '.cards article{flex:1 1 240px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:1rem}\n.prose{max-width:46rem;margin:0 auto;padding:2rem 1.25rem}\n' +
    '.products{list-style:none;padding:0}\n.products li{display:flex;align-items:center;gap:.75rem;padding:.5rem 0;border-bottom:1px solid var(--line)}\n.products strong{margin-left:auto}\n' +
    '.filters button{font:inherit;padding:.25rem .8rem;border:1px solid var(--line);background:#fff;border-radius:99px;cursor:pointer}\n.filters button.on{background:var(--ink);color:#fff}\n' +
    'form{display:grid;gap:.5rem;max-width:26rem}\ninput,textarea{font:inherit;padding:.4rem;border:1px solid var(--line);border-radius:6px}\n' +
    '.ok{color:#2f6f3e}\n.site-footer{border-top:1px solid var(--line);padding:1.25rem;text-align:center;font-size:.9rem}\n' +
    '@media (max-width:640px){.menu-toggle{display:block;margin-left:auto}.site-header nav{display:none;width:100%;flex-direction:column;margin:0}.site-header nav.open{display:flex}}\n';

  files['js/script.js'] =
    "document.addEventListener('DOMContentLoaded', function () {\n" +
    "  var year = document.getElementById('year');\n  if (year) year.textContent = new Date().getFullYear();\n\n" +
    "  var toggle = document.querySelector('.menu-toggle'), nav = document.getElementById('nav');\n" +
    "  if (toggle && nav) {\n    toggle.addEventListener('click', function () {\n      var open = nav.classList.toggle('open');\n      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');\n    });\n  }\n\n" +
    "  var form = document.getElementById('contact-form');\n  if (form) {\n    form.addEventListener('submit', function (e) {\n      e.preventDefault();\n      form.querySelector('.ok').hidden = false;\n    });\n  }\n\n" +
    "  var buttons = document.querySelectorAll('.filters button');\n  buttons.forEach(function (btn) {\n    btn.addEventListener('click', function () {\n      var kind = btn.getAttribute('data-filter');\n" +
    "      buttons.forEach(function (b) { b.classList.toggle('on', b === btn); });\n      document.querySelectorAll('.products li').forEach(function (li) {\n        li.hidden = kind !== 'all' && li.getAttribute('data-kind') !== kind;\n      });\n    });\n  });\n});\n";

  files['images/logo.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#b5651d"/><path d="M14 38c0-10 8-18 18-18s18 8 18 18z" fill="#fbf6ee"/><rect x="14" y="40" width="36" height="6" rx="3" fill="#fbf6ee"/></svg>';
  files['images/loaf.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><ellipse cx="60" cy="66" rx="48" ry="32" fill="#c98a45"/><path d="M34 52l14 -10M54 48l14 -10M74 52l14 -10" stroke="#f3dcb5" stroke-width="5" stroke-linecap="round"/></svg>';
  files['images/croissant.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M14 80c8-40 84-40 92 0-16-8-24-10-46-10s-30 2-46 10z" fill="#d99a4e"/><path d="M40 60l-6 14M60 56v16M80 60l6 14" stroke="#b5651d" stroke-width="4" stroke-linecap="round"/></svg>';
  files['images/hero.svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#7a4a1e"/><stop offset="1" stop-color="#d9a05b"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/><circle cx="640" cy="90" r="70" fill="#f3dcb5" opacity=".35"/></svg>';

  return {
    name: 'harbour-street-bakery',
    /** Returns { path: Uint8Array } like the ZIP reader does. */
    build: function () {
      var enc = new TextEncoder(), out = {};
      Object.keys(files).forEach(function (p) { out[p] = enc.encode(files[p]); });
      return out;
    },
    files: files
  };
});
