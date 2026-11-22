/* PonderDev kit 1.0.0, built from kit/src. Do not edit: run bin/kit-sync. */
'use strict';
/* --- icons.js --- */
/* kit icons: one set, drawn once, used by name in every Just tool (decided
 * 2026-11-18). 24px grid, outline, stroke var(--icon-stroke), round caps and
 * joins, currentColor, so an icon takes the colour of the text around it.
 *
 *   <i data-icon="play"></i>            filled in by Kit.icons() on load
 *   Kit.icon('folder', { size: 32 })    an <svg> element, for script
 *
 * A tool never draws its own copy of one of these; the kit check refuses an
 * inline <svg> in a tool's renderer. A tool's app icon (build/icon.svg) is its
 * own and is not here. To add an icon, add it here, in this style, and run
 * bin/kit-sync on the tools that use it. */
(function (Kit) {
  const P = {
    // things
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    folder: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>',
    'folder-open': '<path d="M3 18V6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h6.5A1.5 1.5 0 0 1 20 9v1.5"/><path d="M3 18l2.6-6.4A1.5 1.5 0 0 1 7 10.5h13.2a1 1 0 0 1 .9 1.4L18.5 18.6a1.5 1.5 0 0 1-1.4.9H4.5A1.5 1.5 0 0 1 3 18z"/>',
    video: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M10 9.5l5 2.5-5 2.5z"/>',
    clapper: '<rect x="3" y="7" width="18" height="12.5" rx="2"/><path d="M3 10.5h18"/><path d="M8 7l-2 3.5M13 7l-2 3.5M18 7l-2 3.5"/>',
    film: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18M3 15h18M7.5 4.5V9M12 4.5V9M16.5 4.5V9M7.5 15v4.5M12 15v4.5M16.5 15v4.5"/>',
    photo: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M3 17l5-5 4 4 3-3 6 6"/>',
    photos: '<rect x="6" y="3" width="15" height="13" rx="2"/><path d="M3 7v11a2 2 0 0 0 2 2h12"/><circle cx="10.5" cy="7.5" r="1.5"/><path d="M6 13.5l4-3.5 3 2.5 2.5-2 5.5 4.5"/>',
    audio: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
    captions: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M10.5 10.3a2.2 2.2 0 1 0 0 3.4M17 10.3a2.2 2.2 0 1 0 0 3.4"/>',
    colour: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
    layers: '<path d="M12 4l9 4.5-9 4.5-9-4.5z"/><path d="M3 13l9 4.5 9-4.5"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    // playing and editing
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    undo: '<path d="M9 13.5L4.5 9 9 4.5"/><path d="M4.5 9h10a5 5 0 0 1 0 10H11"/>',
    redo: '<path d="M15 13.5L19.5 9 15 4.5"/><path d="M19.5 9h-10a5 5 0 0 0 0 10H13"/>',
    split: '<path d="M12 3v18"/><path d="M8 7.5L4.5 12 8 16.5M16 7.5l3.5 4.5-3.5 4.5"/>',
    trash: '<path d="M4 7h16M10 3.5h4M6 7l1 13h10l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    change: '<path d="M4 9h13l-3.5-3.5"/><path d="M20 15H7l3.5 3.5"/>',
    drag: '<circle cx="9" cy="6" r=".9"/><circle cx="15" cy="6" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/>',
    // results
    export: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12"/>',
    reveal: '<path d="M3 18V6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warning: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.1"/>',
    // more, from the inventory (kit/INVENTORY.md)
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
    compare: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 3v18"/><path d="M7 10l-1.5 2L7 14M17 10l1.5 2-1.5 2"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    auto: '<path d="M5 19L15 9"/><path d="M14 4.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z"/><path d="M19 10l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/>',
    forward: '<rect x="8" y="3.5" width="12.5" height="12.5" rx="2"/><path d="M5.5 8v10A2.5 2.5 0 0 0 8 20.5h10"/>',
    back: '<rect x="3.5" y="8" width="12.5" height="12.5" rx="2"/><path d="M8 5.5V5A1.5 1.5 0 0 1 9.5 3.5h9.5A1.5 1.5 0 0 1 20.5 5v9.5a1.5 1.5 0 0 1-1.5 1.5h-.5"/>',
    shape: '<circle cx="8.5" cy="8.5" r="4.5"/><rect x="11" y="11" width="9.5" height="9.5" rx="1.5"/>',
    text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    position: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    language: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5S9.5 6.1 12 3.5z"/>',
    download: '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5"/><path d="M5 18.5h14"/>',
    update: '<path d="M19.5 12a7.5 7.5 0 0 1-13.4 4.6M4.5 12a7.5 7.5 0 0 1 13.4-4.6"/><path d="M18 3.5v4h-4M6 20.5v-4h4"/>',
    rollback: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M4.5 12H15a4.5 4.5 0 0 0 0-9h-1"/>',
    run: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.5v7l5.5-3.5z"/>',
    chain: '<rect x="3" y="9" width="6" height="6" rx="1.5"/><rect x="15" y="9" width="6" height="6" rx="1.5"/><path d="M9 12h6M13 10l2 2-2 2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    connected: '<path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 12.8a6.5 6.5 0 0 1 9 0"/><circle cx="12" cy="16.5" r="1.2"/>',
    disconnected: '<path d="M4.5 9.5a11 11 0 0 1 4-2.3M14.5 7a11 11 0 0 1 5 2.5M7.5 12.8a6.5 6.5 0 0 1 2.2-1.3"/><circle cx="12" cy="16.5" r="1.2"/><path d="M4 4l16 16"/>',
    server: '<rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M7.5 7.5h.1M7.5 16.5h.1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    tree: '<path d="M5 4v14.5A1.5 1.5 0 0 0 6.5 20H9M5 9.5h4"/><rect x="9" y="6.5" width="11" height="6" rx="1.5"/><rect x="9" y="16.5" width="11" height="6" rx="1.5"/>',
    pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
    note: '<path d="M5 4.5h14v10l-5 5H5z"/><path d="M14 19.5v-5h5M8.5 9h7M8.5 12.5h4"/>',
    bolt: '<path d="M13 3L5.5 13.5H12L11 21l7.5-10.5H12z"/>',
    belt: '<rect x="4" y="14" width="16" height="5" rx="1.5"/><rect x="5.5" y="9.5" width="13" height="4.5" rx="1.5"/><rect x="7" y="5" width="10" height="4.5" rx="1.5"/>',
    tabs: '<path d="M3.5 19.5V7A1.5 1.5 0 0 1 5 5.5h4.5L11 8h8a1.5 1.5 0 0 1 1.5 1.5v10z"/><path d="M11 8h9.5"/>',
    minus: '<path d="M5 12h14"/>',
    // the window
    'chevron-down': '<path d="M6 9.5l6 6 6-6"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    waiting: '<circle cx="12" cy="12" r="7"/>',
    working: '<path d="M12 5a7 7 0 1 1-7 7"/>',
  };
  const NS = 'http://www.w3.org/2000/svg';

  Kit.ICONS = Object.keys(P);

  Kit.icon = function icon(name, { size, cls } = {}) {
    if (!P[name]) throw new Error(`kit: no icon "${name}"`);
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'k-icon' + (cls ? ' ' + cls : ''));
    s.dataset.icon = name;
    if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
    s.innerHTML = P[name];   // this file's own constants, never outside text
    return s;
  };

  // <i data-icon="name"></i> becomes the icon, keeping any classes on the <i>
  Kit.icons = function icons(root = document) {
    for (const i of root.querySelectorAll('i[data-icon]')) {
      const s = Kit.icon(i.dataset.icon, { cls: i.className });
      if (i.getAttribute('aria-label')) { s.setAttribute('aria-hidden', 'false'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', i.getAttribute('aria-label')); }
      i.replaceWith(s);
    }
  };
})(window.Kit = window.Kit || {});

/* --- parts/start.js --- */
/* kit part: the start screen (option A) and the file row.
 *
 *   const start = Kit.start(document.getElementById('start'), {
 *     name: 'Just Fits', version: '1.3.0', line: 'Makes a file small enough to send.',
 *     icon: 'video', say: 'Drop a video or a picture here', choose: 'Choose a file',
 *     takes: 'MP4, MOV, MKV, WebM and more, or a JPEG, PNG, HEIC or WebP picture',
 *     onChoose, onDrop(files),
 *     also: { label: 'Choose a folder', onClick, change: 'Change folder' },  // optional
 *   });
 *   also.change: the same second way in on the file row once something is in,
 *   beside "Change file" (decided 2026-11-21: a folder can be swapped for
 *   another folder on Windows and Linux without Start again).
 *   start.landed({ name: 'beach-day.mp4', facts: '41.3 MB · 1920x1080 · 0:12' });
 *   start.reset();
 */
(function (Kit) {
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  // also: { label, onClick } a second way to change, beside Change (a folder,
  // on Windows and Linux where one picker cannot take both); Change then reads
  // changeLabel ('Change file').
  Kit.fileRow = function fileRow(root, { icon = 'file', onChange, also, changeLabel = 'Change file' } = {}) {
    root.classList.add('k-file');
    root.replaceChildren();
    const text = el('div', 'k-file-text');
    const name = el('p', 'k-file-name');
    const facts = el('p', 'k-file-facts');
    text.append(name, facts);
    const change = el('button', 'btn btn-ghost btn-tight', also ? changeLabel : 'Change');
    change.type = 'button';
    if (onChange) change.addEventListener('click', onChange);
    let pic = Kit.icon(icon);
    let changeAlso = null;
    if (also) {
      changeAlso = el('button', 'btn btn-ghost btn-tight', also.label);
      changeAlso.type = 'button';
      changeAlso.addEventListener('click', () => also.onClick && also.onClick());
      const both = el('div', 'k-file-changes');
      both.append(change, changeAlso);
      root.append(pic, text, both);
    } else root.append(pic, text, change);
    return {
      // icon: a file's own kind when it differs from the tool's (a picture in Just Fits)
      set({ name: n, facts: f = '', icon: i } = {}) {
        name.textContent = n; facts.textContent = f; root.classList.add('show');
        if (i) { const next = Kit.icon(i); pic.replaceWith(next); pic = next; }
      },
      change,
      changeAlso,
      clear() { root.classList.remove('show'); },
    };
  };

  // A pre-release build carries its coming version with a pre-release tag in
  // package.json ("1.3.0-pre"), and says so in words: "1.3.0 (pre-release)",
  // so a review picture never looks like the old build. A release build shows
  // the plain version (decided 2026-11-20).
  Kit.versionLabel = function versionLabel(v) {
    const m = /^(\d+\.\d+\.\d+)-./.exec(String(v || ''));
    return m ? `${m[1]} (pre-release)` : String(v || '');
  };

  Kit.start = function start(root, o) {
    root.classList.add('k-start');
    root.replaceChildren();
    const head = el('header', 'k-start-head');
    // the version sits faintly beside the name (decided 2026-11-19)
    const title = el('h1', '', o.name);
    if (o.version) title.append(el('span', 'k-version', Kit.versionLabel(o.version)));
    head.append(title, el('p', 'sub', o.line));
    const zone = el('section', 'k-zone');
    const btn = el('button', 'btn btn-primary', o.choose || 'Choose a file');
    btn.type = 'button';
    const err = el('p', 'k-error');
    // also: a second way in, as a quieter button beside the first (Zip's "Open an archive")
    const actions = el('div', 'k-zone-actions');
    actions.append(btn);
    let also = null;
    if (o.also) {
      also = el('button', 'btn btn-ghost', o.also.label);
      also.type = 'button';
      also.addEventListener('click', () => o.also.onClick && o.also.onClick());
      actions.append(also);
    }
    zone.append(Kit.icon(o.icon || 'file'), el('p', 'k-zone-say', o.say), actions, el('p', 'k-zone-takes', o.takes || ''), err);
    const fileEl = el('div');
    root.append(head, zone);
    // skill: { copy: async () => the tool's SKILL.md text, about: () => opens its how-it-works page }
    if (o.skill) {
      const line = el('p', 'k-skill');
      const copy = el('button', 'linky', 'Copy skill');
      copy.type = 'button';
      const about = el('button', 'linky', "What's this?");
      about.type = 'button';
      const note = el('p', 'k-skill-about hint');
      note.hidden = true;
      note.textContent = `A skill is a short file that teaches an assistant (Claude, ChatGPT, or one on your own computer) to run ${o.name} for you.`;
      line.append('Use it with your assistant', el('span', 'k-skill-sep', '·'), copy, el('span', 'k-skill-sep', '·'), about);
      copy.addEventListener('click', async () => {
        try {
          const text = await o.skill.copy();
          await navigator.clipboard.writeText(text);
          copy.textContent = 'Copied';
        } catch { copy.textContent = 'Could not copy'; }
        setTimeout(() => { copy.textContent = 'Copy skill'; }, 2200);
      });
      if (o.skill.about) {
        const how = el('button', 'linky', 'How it works');
        how.type = 'button';
        how.addEventListener('click', () => o.skill.about());
        note.append(' ', how);
      }
      about.addEventListener('click', () => { note.hidden = !note.hidden; });
      root.append(line, note);
    }
    root.append(fileEl);
    const rowAlso = o.also && o.also.change ? { label: o.also.change, onClick: o.also.onClick } : null;
    const file = Kit.fileRow(fileEl, { icon: o.icon, onChange: o.onChoose, also: rowAlso, changeLabel: o.changeLabel });

    btn.addEventListener('click', () => o.onChoose && o.onChoose());
    for (const t of ['dragenter', 'dragover']) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add('over'); });
    for (const t of ['dragleave', 'dragend']) zone.addEventListener(t, () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (o.onDrop) o.onDrop([...e.dataTransfer.files]); });

    return {
      landed(f) { err.textContent = ''; file.set(f); root.classList.add('landed'); },
      reset() { file.clear(); root.classList.remove('landed'); },
      // a file that could not be taken: said under the zone, in the tool's words
      error(message) { err.textContent = message || ''; },
      // light the zone while a file is held anywhere over the window (the tool's veil decides)
      over(on) { zone.classList.toggle('over', Boolean(on)); },
      buttons: { choose: btn, change: file.change, changeAlso: file.changeAlso, also },
    };
  };
})(window.Kit = window.Kit || {});

/* --- parts/settings.js --- */
/* kit part: the fields that need behaviour. A swatch's colour is set through
 * the style object (--swatch), never a style attribute, which the policy blocks.
 *
 *   Kit.segmented(el, ['JPEG', 'PNG'], { value: 'JPEG', onChange })
 *   Kit.range2(el, { min: 0, max: 100, from: 20, to: 80, step: 1, onChange([from, to]) })
 *   Kit.swatches(el, ['#ffffff', '#000000', '#ffd400'], { value, custom: true, onChange })
 */
(function (Kit) {
  Kit.segmented = function segmented(root, choices, { value, onChange } = {}) {
    root.classList.add('k-seg');
    root.setAttribute('role', 'group');
    root.replaceChildren();
    const set = (v) => { for (const b of root.children) b.setAttribute('aria-pressed', String(b.dataset.value === v)); };
    for (const c of choices) {
      const [v, label] = Array.isArray(c) ? c : [c, c];
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.value = v; b.textContent = label;
      b.addEventListener('click', () => { set(v); if (onChange) onChange(v); });
      root.append(b);
    }
    set(value === undefined ? (Array.isArray(choices[0]) ? choices[0][0] : choices[0]) : value);
    return { set, get: () => [...root.children].find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.value };
  };

  Kit.range2 = function range2(root, { min = 0, max = 100, step = 1, from = min, to = max, onChange } = {}) {
    root.classList.add('k-range2');
    root.replaceChildren();
    const track = document.createElement('div'); track.className = 'k-range2-track';
    const fill = document.createElement('div'); fill.className = 'k-range2-fill';
    track.append(fill);
    const mk = (v) => { const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = v; return i; };
    const a = mk(from), b = mk(to);
    const paint = () => {
      let x = Number(a.value), y = Number(b.value);
      if (x > y) [x, y] = [y, x];
      fill.style.setProperty('--from', ((x - min) / (max - min) * 100) + '%');
      fill.style.setProperty('--to', ((y - min) / (max - min) * 100) + '%');
      return [x, y];
    };
    for (const i of [a, b]) i.addEventListener('input', () => { const v = paint(); if (onChange) onChange(v); });
    root.append(track, a, b);
    paint();
    return { get: paint };
  };

  Kit.swatches = function swatches(root, colours, { value, custom = false, onChange } = {}) {
    root.classList.add('k-swatches');
    root.replaceChildren();
    const set = (v) => { for (const s of root.children) s.setAttribute('aria-pressed', String(s.dataset.value === v)); };
    const add = (c, isCustom) => {
      const s = document.createElement('button');
      s.type = 'button'; s.className = 'k-swatch' + (isCustom ? ' k-swatch-custom' : '');
      s.dataset.value = c; s.style.setProperty('--swatch', c); s.setAttribute('aria-label', isCustom ? 'Another colour' : c);
      if (isCustom) {
        const i = document.createElement('input'); i.type = 'color'; i.value = c;
        i.addEventListener('input', () => { s.dataset.value = i.value; s.style.setProperty('--swatch', i.value); set(i.value); if (onChange) onChange(i.value); });
        s.append(i);
      } else {
        s.addEventListener('click', () => { set(c); if (onChange) onChange(c); });
      }
      root.append(s);
    };
    for (const c of colours) add(c, false);
    if (custom) add(value && !colours.includes(value) ? value : '#888888', true);
    set(value === undefined ? colours[0] : value);
    return { set };
  };
})(window.Kit = window.Kit || {});

/* --- parts/controls.js --- */
/* kit part: behaviour for chips, the bipolar slider, the reveal group and the
 * 3x3 grid.
 *
 *   Kit.chips(el, [['soft', 'Soft'], ['bold', 'Bold']], { value, onChange })
 *   Kit.bipolar(el, { min: -100, max: 100, value: 0, onChange })
 *   Kit.reveal(checkboxEl, groupEl)           shows the group while it's ticked
 *   Kit.grid9(el, { value: 8, onChange })      1..9 in numpad order, 8 = bottom middle
 */
(function (Kit) {
  Kit.chips = function chips(root, choices, { value, onChange } = {}) {
    root.classList.add('k-chips');
    root.replaceChildren();
    const set = (v) => { for (const b of root.children) b.setAttribute('aria-pressed', String(b.dataset.value === v)); };
    for (const c of choices) {
      const [v, label] = Array.isArray(c) ? c : [c, c];
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.value = v; b.textContent = label;
      b.addEventListener('click', () => { set(v); if (onChange) onChange(v); });
      root.append(b);
    }
    if (value !== undefined) set(value);
    return { set };
  };

  Kit.bipolar = function bipolar(root, { min = -100, max = 100, step = 1, value = 0, title, onChange } = {}) {
    root.classList.add('k-bipolar');
    root.replaceChildren();
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
    r.title = title || 'Double-click to put it back to 0';
    const pill = document.createElement('span'); pill.className = 'pill';
    const show = () => { const v = Number(r.value); pill.textContent = v > 0 ? `+${v}` : String(v); };
    r.addEventListener('input', () => { show(); if (onChange) onChange(Number(r.value)); });
    r.addEventListener('dblclick', () => { r.value = 0; show(); if (onChange) onChange(0); });
    root.append(r, pill);
    show();
    return { get: () => Number(r.value), set: (v) => { r.value = v; show(); } };
  };

  Kit.reveal = function reveal(box, group) {
    const host = group.closest('.k-reveal') || group.parentElement;
    host.classList.add('k-reveal');
    group.classList.add('k-reveal-body');
    const sync = () => host.classList.toggle('open', box.checked);
    box.addEventListener('change', sync);
    sync();
    return { sync };
  };

  const NAMES = ['', 'Bottom left', 'Bottom middle', 'Bottom right', 'Middle left', 'Centre', 'Middle right', 'Top left', 'Top middle', 'Top right'];
  Kit.grid9 = function grid9(root, { value = 2, onChange } = {}) {
    root.classList.add('k-grid9');
    root.replaceChildren();
    const set = (v) => { for (const b of root.children) b.setAttribute('aria-pressed', String(Number(b.dataset.value) === v)); };
    for (const v of [7, 8, 9, 4, 5, 6, 1, 2, 3]) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.value = v; b.title = NAMES[v]; b.setAttribute('aria-label', NAMES[v]);
      b.addEventListener('click', () => { set(v); if (onChange) onChange(v); });
      root.append(b);
    }
    set(value);
    return { set };
  };
})(window.Kit = window.Kit || {});

/* --- parts/overlays.js --- */
/* kit part: tabs and the popup menu. Dialogs need no script: a <dialog
 * class="k-dialog"> with showModal() and close().
 *
 *   Kit.tabs(el, [['tools', 'Tools'], ['flows', 'Workflows']], { value, onChange })
 *   const m = Kit.menu([{ value: 'fade', label: 'Fade', icon: 'layers' }], { value, onPick })
 *   m.openAt(anchorEl)
 */
(function (Kit) {
  Kit.tabs = function tabs(root, choices, { value, onChange } = {}) {
    root.classList.add('k-tabs');
    root.setAttribute('role', 'tablist');
    root.replaceChildren();
    const set = (v) => { for (const b of root.children) b.setAttribute('aria-selected', String(b.dataset.value === v)); };
    for (const [v, label, icon] of choices) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.value = v;
      if (icon) b.append(Kit.icon(icon));
      b.append(label);
      b.addEventListener('click', () => { set(v); if (onChange) onChange(v); });
      root.append(b);
    }
    set(value === undefined ? choices[0][0] : value);
    return { set };
  };

  Kit.menu = function menu(items, { value, onPick } = {}) {
    const root = document.createElement('div');
    root.className = 'k-menu'; root.setAttribute('role', 'menu'); root.hidden = true;
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.dataset.value = it.value;
      b.setAttribute('aria-checked', String(it.value === value));
      if (it.icon) b.append(Kit.icon(it.icon));
      b.append(it.label);
      b.addEventListener('click', () => {
        for (const o of root.children) o.setAttribute('aria-checked', String(o === b));
        close(); if (onPick) onPick(it.value);
      });
      root.append(b);
    }
    document.body.append(root);
    const close = () => { root.hidden = true; };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.addEventListener('pointerdown', (e) => { if (!root.hidden && !root.contains(e.target)) close(); });
    return {
      openAt(anchor) {
        const r = anchor.getBoundingClientRect();
        root.style.setProperty('--x', `${Math.round(Math.min(r.left, innerWidth - 200))}px`);
        root.style.setProperty('--y', `${Math.round(r.bottom + 6)}px`);
        root.hidden = false;
        root.querySelector('[aria-checked="true"]')?.focus();
      },
      close,
    };
  };
})(window.Kit = window.Kit || {});

/* --- parts/run.js --- */
/*
 * kit part: what happens under the main button in every Just tool (decided 2026-11-18):
 * working, the queue, done and failed, the same in every tool, with the tool's
 * own words and numbers in its slots.
 *
 *   const run = Kit.run(document.getElementById('run'), {
 *     onCancel, onReveal, onAgain, onRetry,
 *   });
 *   run.working({ what: 'Converting to JPEG', count: '58 of 120', fraction: 0.48,
 *                 file: 'IMG_4580.HEIC', left: 'About 9 seconds left' });
 *   run.working({ what: 'First pass', unknown: true });   // a step whose length can't be known:
 *                                                          // the bar sweeps instead of sitting still
 *   run.queue([{ name: 'IMG_4403.HEIC', state: 'done' }, { name: 'IMG_4511.HEIC', state: 'failed', note: 'Not a photo' }]);
 *   run.done({ title: 'Done. 120 photos converted', detail: '21.4 MB of JPEG in 20 seconds',
 *              where: 'Saved next to the originals in Beach vacation' });
 *   run.failed('There is already a file with that name. Pick another name.');
 *   run.reset();
 *
 * Before a run, the estimate goes above the main button (.k-note), never
 * in here: in here is only what happens once the button is pressed.
 */
(function (Kit) {
  // the queue's marks are kit icons: waiting, working, check (done), close (failed)
  const mark = (state) => Kit.icon({ waiting: 'waiting', working: 'working', done: 'check', failed: 'close' }[state] || 'waiting', { cls: 'k-q-mark' });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (cls, text, fn) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (fn) b.addEventListener('click', fn);
    return b;
  };

  function mount(root, o = {}) {
    root.classList.add('k-run');
    root.replaceChildren();
    // onState(state): told whenever the part changes state (idle, working, done, failed);
    // the parent also carries it as data-run-state, so a tool's CSS can follow
    const setState = (st) => { root.dataset.state = st; if (root.parentElement) root.parentElement.dataset.runState = st; if (o.onState) o.onState(st); };
    root.dataset.state = 'idle';

    const working = el('section', 'k-run-working');
    const bar = el('div', 'k-run-bar');
    const fill = el('span', 'k-run-fill');
    bar.append(fill);
    const line = el('p', 'k-run-line');
    const what = el('span', 'k-run-what');
    const count = el('span', 'k-run-count');
    line.append(what, count);
    const sub = el('p', 'k-run-sub');
    const file = el('span', 'k-run-file');
    const left = el('span', 'k-run-left');
    sub.append(file, left);
    const cancel = button('btn btn-ghost btn-tight k-run-cancel', 'Cancel', o.onCancel);
    working.append(bar, line, sub, cancel);

    const queueBox = el('section', 'k-run-queue');
    const list = el('ol');
    queueBox.append(list);

    const done = el('section', 'k-run-done');
    const title = el('p', 'k-run-done-title');
    const detail = el('p', 'k-run-done-detail');
    const where = el('p', 'k-run-done-where');
    const actions = el('div', 'k-run-done-actions');
    const reveal = button('btn btn-ghost', 'Show me the file', o.onReveal);
    const again = button('linky', 'Start again', o.onAgain);
    actions.append(reveal, again);
    done.append(title, detail, where, actions);

    const failed = el('section', 'k-run-failed');
    const err = el('p', 'k-error');
    const retry = button('btn btn-ghost', 'Try again', o.onRetry);
    failed.append(err, retry);

    root.append(working, queueBox, done, failed);

    return {
      // unknown: true (or a fraction of null) while a step's length can't be
      // known (Fits' first pass on a slow machine): the bar sweeps, so it is
      // plain that something is happening, and stops sweeping as soon as a
      // real fraction comes in (decided 2026-11-20).
      working({ what: w = 'Working', count: c = '', fraction = 0, unknown = false, file: f = '', left: l = '' } = {}) {
        setState('working');
        what.textContent = w;
        count.textContent = c;
        file.textContent = f;
        left.textContent = l;
        const sweep = unknown || fraction === null;
        bar.classList.toggle('unknown', sweep);
        if (sweep) { bar.setAttribute('aria-busy', 'true'); fill.style.width = ''; return; }
        bar.removeAttribute('aria-busy');
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 10}%`;
      },
      queue(items = []) {
        list.replaceChildren(...items.map((it) => {
          const li = el('li');
          li.dataset.q = it.state || 'waiting';
          li.append(mark(li.dataset.q), el('span', 'k-q-name', it.name));
          if (it.note) li.append(el('span', 'k-q-note', it.note));
          return li;
        }));
        queueBox.classList.toggle('has', items.length > 0);
        // keep the row being worked on in view, so a long queue follows the run
        const at = list.querySelector('[data-q="working"]');
        if (at) queueBox.scrollTop = Math.max(0, at.offsetTop - queueBox.clientHeight / 2);
      },
      // reveal: false when there is no file to show (it already fitted, it was
      // stopped); tone: 'over' when it did not get all the way
      // revealLabel: 'Show me the folder' when what it shows is a results folder.
      done({ title: t = 'Done.', detail: d = '', where: w = '', reveal: showReveal = true, revealLabel = 'Show me the file', tone = '' } = {}) {
        setState('done');
        reveal.hidden = !showReveal;
        reveal.textContent = revealLabel;
        done.classList.toggle('over', tone === 'over');
        title.textContent = t;
        detail.textContent = d;
        where.textContent = w;
      },
      failed(message) {
        setState('failed');
        err.textContent = message;
      },
      // the parts' own buttons, for a tool that needs to label or test them
      buttons: { cancel, reveal, again, retry },
      reset() { setState('idle'); list.replaceChildren(); queueBox.classList.remove('has'); bar.classList.remove('unknown'); bar.removeAttribute('aria-busy'); fill.style.width = '0%'; },
    };
  }

  Kit.run = mount;
})(window.Kit = window.Kit || {});

/* --- parts/veil.js --- */
/* kit part: the drag veil.
 *
 *   const veil = Kit.veil({ say: 'Drop to add to the tray', icon: 'plus', onDrop(files) {} });
 *   veil.say('Drop to replace the video');   // when where it goes changes
 */
(function (Kit) {
  // say: a sentence, or a function giving it when the drag starts (it can follow the screen)
  // when: a function; while it returns false (a run is going) there is no veil and no drop
  // onOver(on): told when a file comes over the window and leaves it (to light a start zone)
  Kit.veil = function veil({ say = 'Drop it here', icon = 'plus', onDrop, when = () => true, onOver } = {}) {
    const root = document.createElement('div');
    root.className = 'k-veil'; root.hidden = true;
    const p = document.createElement('p');
    const text = document.createElement('span');
    p.append(Kit.icon(icon), text);
    root.append(p);
    document.body.append(root);
    let depth = 0;
    const words = () => (typeof say === 'function' ? say() : say);
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const show = (on) => { root.hidden = !on; if (onOver) onOver(on); };
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      if (depth === 1 && when()) { text.textContent = words(); show(true); }
    });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = when() ? 'copy' : 'none';
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; show(false);
      if (when() && onDrop) onDrop([...e.dataTransfer.files]);
    });
    return { say(s) { say = s; text.textContent = words(); } };
  };
})(window.Kit = window.Kit || {});

/* --- parts/footer.js --- */
/* kit part: the footer. The promise is the family's, word for word; a tool does
 * not write its own (decided 2026-11-18).
 *
 *   Kit.footer(document.querySelector('footer'), { onSite, onLicences })
 *
 * Three places (decided 2026-11-20): the licences on the left, the promise in
 * the middle, the credit on the right. The version is not here: it is beside
 * the name on the start screen (Kit.start), which every window shows.
 */
(function (Kit) {
  Kit.PROMISE = 'Nothing is uploaded, and your originals are never touched.';
  // promise: only for a tool whose truth is different, one that talks to a
  // network by design (Clipboard, the Tool Belt's updates); everyone else says
  // the family's words, word for word.
  Kit.footer = function footer(root, { onSite, onLicences, promise } = {}) {
    root.classList.add('k-footer');
    root.replaceChildren();
    const lic = document.createElement('button');
    lic.type = 'button'; lic.id = 'licences'; lic.className = 'k-footer-licences'; lic.textContent = 'Licences and credits';
    const promiseEl = document.createElement('span');
    promiseEl.className = 'k-footer-promise';
    promiseEl.textContent = promise || Kit.PROMISE;
    const site = document.createElement('button');
    site.type = 'button'; site.id = 'site'; site.className = 'k-footer-credit';
    const mark = document.createElement('span'); mark.className = 'k-mark';
    const dev = document.createElement('b'); dev.textContent = 'Dev';
    mark.append('Ponder', dev);
    site.append('Powered by ', mark);
    if (onSite) site.addEventListener('click', onSite);
    if (onLicences) lic.addEventListener('click', onLicences);
    root.append(lic, promiseEl, site);
  };
})(window.Kit = window.Kit || {});

/* --- parts/store.js --- */
/* kit part: the settings store. Every setting a tool keeps between sessions
 * goes through here, so every tool follows one rule (decided 2026-11-19):
 *
 *   Two versions of a tool can be installed side by side, and they share one
 *   store (the same app id, the same storage). So a version keeps every key it
 *   does not know, and never drops one or fails on one. A newer version's keys
 *   ride along untouched when an older version saves, and an older version
 *   simply ignores them. A value of the wrong kind, or a store that cannot be
 *   read at all, falls back to the default; it never stops the tool.
 *
 *   const settings = Kit.store('justcut', { removeWithoutAsking: false });
 *   settings.get('removeWithoutAsking');         // the saved value or the default
 *   settings.set('removeWithoutAsking', true);    // writes this key, keeps the rest
 *   settings.clear('removeWithoutAsking');        // back to the default
 *
 * A key's meaning never changes: a setting that needs a new meaning takes a new
 * name, and the old key stays for the versions that read it.
 *
 * A setting a tool kept under its own key before the kit (Just Cut's
 * 'justcut.removeWithoutAsking' = '1') is carried over once:
 *
 *   settings.adopt('justcut.removeWithoutAsking', 'removeWithoutAsking', (raw) => raw === '1');
 *
 * When the store has no value for the key yet and the old key is there, its
 * value is read through the function and saved. Either way the old key is
 * noted as adopted, so it is never read again: a person who later turns the
 * setting back off is not overruled by the old key, which stays where it was
 * for the older version that reads it.
 */
(function (Kit) {
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const kindOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

  Kit.store = function store(name, defaults = {}, storage) {
    const key = name + '.settings';
    const box = () => storage || window.localStorage;
    // Everything saved, known keys or not. Never throws.
    function all() {
      try {
        const raw = box().getItem(key);
        if (!raw) return {};
        const saved = JSON.parse(raw);
        return isPlain(saved) ? saved : {};
      } catch (e) { return {}; }
    }
    function write(saved) {
      try { box().setItem(key, JSON.stringify(saved)); return true; } catch (e) { return false; }
    }
    return {
      // A saved value of a different kind than its default is ignored: an older
      // or newer version may have meant something else by it.
      get(k) {
        const saved = all();
        if (!Object.prototype.hasOwnProperty.call(saved, k)) return defaults[k];
        if (k in defaults && kindOf(saved[k]) !== kindOf(defaults[k])) return defaults[k];
        return saved[k];
      },
      // Writes one key on top of everything saved, so keys this version does
      // not know survive. Returns false when the store cannot be written.
      set(k, v) { const saved = all(); saved[k] = v; return write(saved); },
      clear(k) { const saved = all(); delete saved[k]; return write(saved); },
      adopt(oldKey, k, read = (raw) => raw) {
        const saved = all();
        const done = Array.isArray(saved._adopted) ? saved._adopted : [];
        if (done.includes(oldKey)) return false;
        let raw = null;
        try { raw = box().getItem(oldKey); } catch (e) { return false; }
        let took = false;
        if (raw !== null && !Object.prototype.hasOwnProperty.call(saved, k)) {
          try { saved[k] = read(raw); took = true; } catch (e) { /* unreadable: the default stands */ }
        }
        saved._adopted = done.concat(oldKey);
        write(saved);
        return took;
      },
    };
  };
})(window.Kit = window.Kit || {});
window.Kit.VERSION = '1.0.0';
