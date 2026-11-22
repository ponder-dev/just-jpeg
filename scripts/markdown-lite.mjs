// Just enough Markdown for THIRD-PARTY-NOTICES.md on the credits screen:
// headings, paragraphs, bullet and numbered lists (wrapped lines folded in),
// rules, and inline bold, code and links. Everything is escaped first, so the
// notices can never put markup of their own on the page.

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A link has no live anchor on this page (it is a window of its own, with no
// browser to hand it to), so it reads as its words and then where it points.
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 <span class="url">($2)</span>');
}

export function renderMarkdown(markdown) {
  const out = [];
  let para = [];
  let list = null; // { tag: 'ul'|'ol', items: [[lines]] }
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((lines) => `<li>${inline(lines.join(' '))}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara(); flushList();
      const level = m[1].length + 1; // the page's own title is the h1
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^-{3,}\s*$/.test(line)) {
      flushPara(); flushList(); out.push('<hr>');
    } else if ((m = /^(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = m[1] ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push([m[3]]);
    } else if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1].push(line.trim());
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out.join('\n');
}
