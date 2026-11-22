// The credits screen shows the notices as a page, not as raw Markdown.
//
//   node test/licences.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../scripts/markdown-lite.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('headings, lists, bold, code and links become markup', () => {
  const html = renderMarkdown('# Title\n\nText with **bold**, `code` and [a link](https://example.com/x).\n\n- one\n  wrapped\n- two\n\n1. first\n2. second\n\n---\n');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /a link <span class="url">\(https:\/\/example\.com\/x\)<\/span>/);
  assert.match(html, /<ul><li>one wrapped<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<hr>/);
});

test('markup in the notices is escaped, never live', () => {
  const html = renderMarkdown('A <script>alert(1)</script> & [x](https://a.test/"onmouseover=1)');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the real notices show no raw Markdown marks', () => {
  const html = renderMarkdown(fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8'));
  const text = html.replace(/<[^>]+>/g, '');
  assert.ok(!/^#+ /m.test(text), 'no # headings left');
  assert.ok(!text.includes('**'), 'no ** left');
  assert.ok(!/\]\(/.test(text), 'no [link](url) left');
  assert.ok(/<h3>LibRaw<\/h3>/.test(html));
});

test('the bundle builds the page with it, not with a <pre> of the file', () => {
  const bundle = fs.readFileSync(path.join(root, 'scripts', 'bundle.mjs'), 'utf8');
  assert.ok(bundle.includes('renderMarkdown(notices)'));
  assert.ok(!bundle.includes('<pre class="notices">'));
});
