/* ==========================================================================
   Dante's Commedia · Inferno — ms. Harley 3459
   Digital Scholarly Edition — Application 
   ========================================================================== */

const TEI_NS = 'http://www.tei-c.org/ns/1.0';

/* --- Unicode Glyphs for Cross-OS Compatibility --- */
const GLYPHS = {
  MIDDLE_DOT: '\u00B7', // ·
  PIEDIMOSCA: '\u204B'  // ⁋ (Reversed Pilcrow)
};

/* --- State --- */
const state = {
  commediaDoc: null,
  commentoDoc: null,
  marginiDoc: null,
  cantos: [],
  commentary: {},
  marginalia: {},
  folioContentMap: {},
  currentView: 'facsimile',
  currentCanto: 1,
  currentFolioIdx: 0,
  zoom: 1,
  isDark: false,
  showOrig: false,
  noteCounter: 0,
  isSyncingText: false,
  syncTimeout: null
};

/* --- Facsimile file mapping (Dynamically Generated) --- */
const FOLIO_ORDER = ['2r', '2v', '3r', '3v', '4r', '4v', '5r', '5v', '6r', '6v', '7r', '7v', '8r', '8v', '9r', '9v', '10r', '10v', '11r', '11v'];

const FACSIMILE_MAP = Object.fromEntries(
  FOLIO_ORDER.map((folio, i) => {
    const fileNum = String(i + 6).padStart(5, '0');
    const folioStr = folio.padStart(4, '0');
    return [folio, `CNMD0000428772_${fileNum}_carta${folioStr}.jpg`];
  })
);

/* --- DOM refs --- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {};
function cacheDom() {
  Object.assign(els, {
    loadingOverlay: $('#loadingOverlay'),
    viewFacsimile: $('#viewFacsimile'),
    viewCommento: $('#viewCommento'),
    cantoSelect: $('#cantoSelect'),
    textContent: $('#textContent'),
    commentoContent: $('#commentoContent'),
    commentoPanelTitle: $('#commentoPanelTitle'),
    textPanelTitle: $('#textPanelTitle'),
    facsimileImg: $('#facsimileImg'),
    facsimileImageWrap: $('#facsimileImageWrap'),
    facsimileViewer: $('#facsimileViewer'),
    folioLabel: $('#folioLabel'),
    zoomLevel: $('#zoomLevel'),
    searchInput: $('#searchInput'),
    searchResults: $('#searchResults'),
    notePopup: $('#notePopup'),
    marginTooltip: $('#marginTooltip'),
    aboutModal: $('#aboutModal'),
    columnBadges: $('#columnBadges'),
    folioContentSummary: $('#folioContentSummary'),
  });
}

/* ==========================================================================
   XML Loading & Parsing Utils
   ========================================================================== */

async function loadXML(url) {
  const resp = await fetch(url);
  return new DOMParser().parseFromString(await resp.text(), 'application/xml');
}

const qsaTEI = (el, tag) => [...el.getElementsByTagNameNS(TEI_NS, tag)];
const qsTEI = (el, tag) => qsaTEI(el, tag)[0];

function getAttr(el, name) {
  if (name === 'xml:id') return el.getAttribute('xml:id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
  return el.getAttribute(name);
}

/* ==========================================================================
   Parse Commedia
   ========================================================================== */
function parseCommedia(doc) {
  return qsaTEI(doc, 'div')
    .filter(d => d.getAttribute('type') === 'canto')
    .map(cantoDiv => {
      const n = parseInt(cantoDiv.getAttribute('n'));
      const heading = qsTEI(cantoDiv, 'head')?.textContent.trim() ?? `Canto ${toRoman(n)}`;
      const elements = [];
      walkCantoChildren(cantoDiv, elements);

      return { n, xmlId: getAttr(cantoDiv, 'xml:id'), heading, elements };
    });
}

function walkCantoChildren(parent, elements) {
  for (const node of parent.childNodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const n = node.getAttribute('n');

    switch (node.localName) {
      case 'pb': if (n) elements.push({ type: 'pb', n }); break;
      case 'cb': if (n) elements.push({ type: 'cb', n }); break;
      case 'head': break;
      case 'lg':
        if (node.getAttribute('type') === 'terzina') {
          elements.push({ type: 'terzina', lines: parseTerzina(node, elements) });
        }
        break;
      default: walkCantoChildren(node, elements);
    }
  }
}

function parseTerzina(lgEl, elements) {
  return [...lgEl.childNodes]
    .filter(child => child.nodeType === Node.ELEMENT_NODE)
    .map(child => {
      if (child.localName === 'pb' || child.localName === 'cb') {
        elements.push({ type: child.localName, n: child.getAttribute('n') });
        return null;
      }
      if (child.localName === 'l') {
        const xmlId = getAttr(child, 'xml:id');
        return { xmlId, lineNum: extractLineNum(xmlId), html: renderLineContent(child) };
      }
    })
    .filter(Boolean);
}

function extractLineNum(xmlId) {
  const parts = xmlId?.split('.');
  return parts?.length >= 3 ? parseInt(parts[2]).toString() : (xmlId ?? '');
}

function renderLineContent(lineEl) {
  return [...lineEl.childNodes].reduce((html, node) => {
    if (node.nodeType === Node.TEXT_NODE) return html + escapeHTML(node.textContent);
    if (node.nodeType === Node.ELEMENT_NODE) return html + renderInlineElement(node);
    return html;
  }, '');
}

function renderInlineElement(el) {
  switch (el.localName) {
    case 'choice':
      const sic = qsTEI(el, 'sic');
      const corr = qsTEI(el, 'corr');
      const orig = qsTEI(el, 'orig');
      const reg = qsTEI(el, 'reg');

      if (sic && corr) {
        const sicContent = renderLineContent(sic);
        const corrContent = renderLineContent(corr);
        const type = el.getAttribute('type') || 'correzione editoriale';
        return `<span class="choice-reg choice-corr" data-tooltip="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(type)}" title="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(type)}">${corrContent}</span><span class="choice-orig choice-sic" title="Forma del manoscritto">${sicContent}</span>`;
      }
      if (orig && reg) {
        const origContent = renderLineContent(orig);
        const regContent = renderLineContent(reg);
        return `<span class="choice-reg" data-tooltip="orig.: ${escapeAttr(stripHTML(origContent))}" title="orig.: ${escapeAttr(stripHTML(origContent))}">${regContent}</span><span class="choice-orig" title="Forma originale">${origContent}</span>`;
      }
      return renderLineContent(el);

    case 'g':
      const ref = el.getAttribute('ref');
      if (ref === '#middle_dot') return GLYPHS.MIDDLE_DOT;
      if (ref === '#piedimosca') return `<span class="piedimosca">${GLYPHS.PIEDIMOSCA}</span>`;
      return el.textContent;

    case 'subst':
      const delSub = qsTEI(el, 'del');
      const addSub = qsTEI(el, 'add');
      return `${delSub ? `<span class="scribal-del">${renderLineContent(delSub)}</span>` : ''}${addSub ? `<span class="scribal-add">${renderLineContent(addSub)}</span>` : ''}`;

    case 'del': return `<span class="scribal-del">${renderLineContent(el)}</span>`;
    case 'add': return `<span class="scribal-add">${renderLineContent(el)}</span>`;
    case 'supplied': return `[${renderLineContent(el)}]`;
    case 'pb':
    case 'cb': return '';

    default: return renderLineContent(el);
  }
}

/* --- HTML Security --- */
const escapeHTML = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = str => String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripHTML = html => Object.assign(document.createElement('div'), { innerHTML: html }).textContent || '';

/* ==========================================================================
   Parse Commentary
   ========================================================================== */
function parseCommentary(doc) {
  const commentary = {};

  qsaTEI(doc, 'div')
    .filter(d => d.getAttribute('type') === 'commentary' && d.getAttribute('n'))
    .forEach(topDiv => {
      const cantoN = parseInt(topDiv.getAttribute('n'));
      commentary[cantoN] = commentary[cantoN] || [];

      qsaTEI(topDiv, 'div')
        .filter(d => d.getAttribute('type') === 'commentary')
        .forEach(innerDiv => {
          const entry = parseCommentaryEntry(innerDiv, getAttr(innerDiv, 'xml:id'));
          if (entry) commentary[cantoN].push(entry);
        });
    });

  return commentary;
}

function parseCommentaryEntry(div, xmlId) {
  state.noteCounter = 0;
  const pEl = qsTEI(div, 'p');
  if (!pEl) return null;

  let lemmaText = '', lineRef = '', refLabel = '';
  const firstRef = qsTEI(div, 'ref');

  if (firstRef) {
    lineRef = firstRef.getAttribute('target')?.replace('#', '') || '';
    lemmaText = qsTEI(firstRef, 'emph')?.textContent.trim() || qsTEI(firstRef, 'quote')?.textContent.trim() || '';
  }

  if (lineRef) {
    const parts = lineRef.split('.');
    if (parts.length >= 3) refLabel = `Inf. ${toRoman(parseInt(parts[1]))}, ${parseInt(parts[2])}`;
  }

  return { xmlId, lineRef, refLabel, lemmaText, bodyHtml: renderCommentaryBody(pEl) };
}

function renderCommentaryBody(pEl) {
  state.noteCounter = 0;
  let skippedFirstRef = false;

  return [...pEl.childNodes].reduce((html, child) => {
    if (child.nodeType === Node.ELEMENT_NODE && child.localName === 'ref' && child.getAttribute('target') && !skippedFirstRef) {
      skippedFirstRef = true;
      return html;
    }
    return html + renderCommentaryNode(child);
  }, '').replace(/^\s*\.\s*/, '').trim();
}

function renderCommentaryNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeHTML(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const name = node.localName;

  switch (name) {
    case 'ref':
      if (node.getAttribute('target')) {
        const text = qsTEI(node, 'emph')?.textContent || qsTEI(node, 'quote')?.textContent || '';
        return text ? `<em class="mentioned">${escapeHTML(text.trim())}</em>` : renderCommentaryChildren(node);
      }
      return renderCommentaryChildren(node);

    case 'emph':
    case 'mentioned':
      return `<em class="mentioned">${renderCommentaryChildren(node)}</em>`;

    case 'quote':
      return node.parentNode?.localName === 'cit' ? `<span class="block-quote">${renderCommentaryChildren(node)}</span>` : `«${renderCommentaryChildren(node)}»`;

    case 'cit': return renderCommentaryChildren(node);

    case 'note':
      const type = node.getAttribute('type');
      if (['philological-note', 'bibliographical-ref', 'philological-commentary'].includes(type)) {
        state.noteCounter++;
        const label = type === 'bibliographical-ref' ? 'Rif. bibliografico' : 'Nota filologica';
        return `<span class="note-indicator" data-note-id="note-${Date.now()}-${state.noteCounter}" data-note-title="${label}" data-note-content="${escapeHTML(node.textContent.trim()).replace(/"/g, '&quot;')}" title="${label}">${state.noteCounter}</span>`;
      }
      return renderCommentaryChildren(node);

    case 'app':
      if (node.getAttribute('type') === 'philological') {
        const lem = qsTEI(node, 'lem');
        const rdg = qsTEI(node, 'rdg');
        if (lem && rdg) {
          state.noteCounter++;
          const content = `Lem.: ${lem.textContent.trim()} | Var.: ${rdg.textContent.trim()}`;
          return `${escapeHTML(lem.textContent.trim())}<span class="note-indicator app-indicator" data-note-id="app-${Date.now()}-${state.noteCounter}" data-note-title="Apparato" data-note-content="${escapeHTML(content)}" title="Apparato filologico">🔍</span>`;
        }
      }
      return renderCommentaryChildren(qsTEI(node, 'lem') || node);

    case 'choice':
      const sic = qsTEI(node, 'sic');
      const corr = qsTEI(node, 'corr');
      const orig = qsTEI(node, 'orig');
      const reg = qsTEI(node, 'reg');

      if (sic && corr) {
        const cType = node.getAttribute('type') || 'correzione editoriale';
        return `<span class="choice-reg choice-corr" data-tooltip="${escapeAttr(stripHTML(renderCommentaryChildren(sic)))} — ${escapeAttr(cType)}">${renderCommentaryChildren(corr)}</span><span class="choice-orig choice-sic">${renderCommentaryChildren(sic)}</span>`;
      }
      if (orig && reg) {
        return `<span class="choice-reg" data-tooltip="${escapeAttr(stripHTML(renderCommentaryChildren(orig)))}">${renderCommentaryChildren(reg)}</span><span class="choice-orig">${renderCommentaryChildren(orig)}</span>`;
      }
      return renderCommentaryChildren(corr || reg || sic || orig || node);

    case 'g':
      const refAttr = node.getAttribute('ref');
      if (refAttr === '#middle_dot') return GLYPHS.MIDDLE_DOT;
      if (refAttr === '#piedimosca') return `<span class="piedimosca">${GLYPHS.PIEDIMOSCA}</span>`;
      return node.textContent;

    case 'subst':
      const delSub = qsTEI(node, 'del'), addSub = qsTEI(node, 'add');
      return `${delSub ? `<span class="scribal-del">${escapeHTML(delSub.textContent)}</span>` : ''}${addSub ? `<span class="scribal-add">${escapeHTML(addSub.textContent)}</span>` : ''}`;

    case 'del': return `<span class="scribal-del">${renderCommentaryChildren(node)}</span>`;
    case 'add': return `<span class="scribal-add">${escapeHTML(node.textContent)}</span>`;
    case 'supplied': return `[${renderCommentaryChildren(node)}]`;
    case 'pb':
    case 'cb': return '';

    default: return renderCommentaryChildren(node);
  }
}

function renderCommentaryChildren(node) {
  return [...node.childNodes].reduce((html, child) => html + renderCommentaryNode(child), '');
}

/* ==========================================================================
   Parse Marginalia
   ========================================================================== */
function parseMarginalia(doc) {
  const marginalia = {};

  const pushMarginalia = (lineId, item) => {
    if (!lineId) return;
    marginalia[lineId] = marginalia[lineId] || [];
    if (!marginalia[lineId].some(e => e.type === item.type && e.content === item.content && e.place === item.place)) {
      marginalia[lineId].push(item);
    }
  };

  qsaTEI(doc, 'div').filter(d => d.getAttribute('type') === 'canto').forEach(cantoDiv => {
    qsaTEI(cantoDiv, 'note').forEach(note => {
      const place = note.getAttribute('place');
      const type = note.getAttribute('type');

      if (['verbal', 'non_verbal'].includes(type)) {
        pushMarginalia(note.getAttribute('target')?.replace('#', ''), {
          type, content: note.textContent.trim(), place: place || getParentPlace(note)
        });
      } else if (place) {
        qsaTEI(note, 'ref').forEach(ref => pushMarginalia(ref.getAttribute('target')?.replace('#', ''), {
          type: ref.getAttribute('type') || 'verbal', content: ref.textContent.trim(), place
        }));
        [...note.children].filter(c => c.localName === 'note').forEach(cn => pushMarginalia(cn.getAttribute('target')?.replace('#', ''), {
          type: cn.getAttribute('type') || 'verbal', content: cn.textContent.trim(), place
        }));
      }
    });
  });
  return marginalia;
}

function getParentPlace(el) {
  let parent = el.parentNode;
  while (parent) {
    if (parent.localName === 'note' && parent.getAttribute('place')) return parent.getAttribute('place');
    parent = parent.parentNode;
  }
  return '';
}

/* ==========================================================================
   Build Folio → Content Map
   ========================================================================== */
function buildFolioContentMap(commediaDoc, commentoDoc) {
  const map = {};

  const ensureFolio = f => map[f] = map[f] || { A: { testo: false, commento: false, verseRange: '', cantoN: 0 }, B: { testo: false, commento: false, verseRange: '', cantoN: 0 } };
  const normCol = c => c?.toUpperCase() === 'B' ? 'B' : 'A';

  // 1) Testo
  let curPb = null, curCb = 'A', curCantoN = 0;
  const colLines = {};

  const walkTextNode = node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.localName === 'pb') { curPb = node.getAttribute('n'); curCb = 'A'; }
    else if (node.localName === 'cb') curCb = normCol(node.getAttribute('n'));
    else if (node.localName === 'div' && node.getAttribute('type') === 'canto') curCantoN = parseInt(node.getAttribute('n'));
    else if (node.localName === 'l' && curPb) {
      const xmlId = getAttr(node, 'xml:id');
      if (xmlId) {
        ensureFolio(curPb);
        const col = normCol(curCb);
        map[curPb][col].testo = true;
        map[curPb][col].cantoN = map[curPb][col].cantoN || curCantoN;

        const key = `${curPb}|${col}`;
        colLines[key] = colLines[key] || [];
        const parts = xmlId.split('.');
        if (parts.length >= 3) colLines[key].push(parseInt(parts[2]));
      }
    }
    node.childNodes.forEach(walkTextNode);
  };

  const textBody = commediaDoc.getElementsByTagNameNS(TEI_NS, 'body')[0];
  if (textBody) walkTextNode(textBody);

  Object.entries(colLines).forEach(([key, nums]) => {
    if (!nums.length) return;
    const [folioN, col] = key.split('|');
    map[folioN][col].verseRange = `${toRoman(map[folioN][col].cantoN)}, ${Math.min(...nums)}–${Math.max(...nums)}`;
  });

  // 2) Commento
  let comPb = null, comCb = 'A';
  const walkCommentoNode = node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.localName === 'pb') { comPb = node.getAttribute('n'); comCb = 'A'; }
    else if (node.localName === 'cb') comCb = normCol(node.getAttribute('n'));
    else if (node.localName === 'div' && node.getAttribute('type') === 'commentary' && comPb) {
      ensureFolio(comPb);
      map[comPb][normCol(comCb)].commento = true;
    }
    node.childNodes.forEach(walkCommentoNode);
  };

  const comBody = commentoDoc.getElementsByTagNameNS(TEI_NS, 'body')[0];
  if (comBody) walkCommentoNode(comBody);

  return map;
}

/* ==========================================================================
   Render Column Badges & UI
   ========================================================================== */
function renderColumnBadges() {
  const folioN = FOLIO_ORDER[state.currentFolioIdx];
  const info = state.folioContentMap[folioN];

  if (!info) {
    els.columnBadges.innerHTML = '';
    els.folioContentSummary.innerHTML = '';
    return;
  }

  const getColType = col => col.testo && col.commento ? 'misto' : col.commento ? 'commento' : col.testo ? 'testo' : null;
  const badgeLabel = (col, type) => type === 'misto' ? (col.verseRange ? `Testo ${col.verseRange} + Comm.` : 'Testo + Commento') : type === 'commento' ? 'Commento' : (col.verseRange ? `Testo ${col.verseRange}` : 'Testo');

  const tA = getColType(info.A), tB = getColType(info.B);

  els.columnBadges.innerHTML = [
    tA ? `<div class="col-badge col-left badge-${tA}"><span class="col-badge-dot"></span><span>${tB ? 'Col. A · ' : ''}${badgeLabel(info.A, tA)}</span></div>` : '',
    tB ? `<div class="col-badge col-right badge-${tB}"><span class="col-badge-dot"></span><span>${tA ? 'Col. B · ' : ''}${badgeLabel(info.B, tB)}</span></div>` : ''
  ].join('');

  const hasT = info.A.testo || info.B.testo, hasC = info.A.commento || info.B.commento;
  els.folioContentSummary.innerHTML = hasT && hasC
    ? `<span class="content-legend"><span class="legend-dot dot-testo"></span> Testo</span><span class="content-legend"><span class="legend-dot dot-commento"></span> Commento</span><span style="color:var(--accent);font-weight:500;">Carta mista</span>`
    : hasC ? `<span class="content-legend"><span class="legend-dot dot-commento"></span> Solo commento</span>`
      : hasT ? `<span class="content-legend"><span class="legend-dot dot-testo"></span> Solo testo</span>` : '';
}

/* ==========================================================================
   Rendering Views
   ========================================================================== */
function renderFacsimileView() {
  const canto = state.cantos.find(c => c.n === state.currentCanto);
  if (!canto) return;

  const firstFolio = canto.elements.find(el => el.type === 'pb')?.n || FOLIO_ORDER[0];
  const idx = FOLIO_ORDER.indexOf(firstFolio);
  if (idx >= 0) state.currentFolioIdx = idx;

  renderTextForCanto(canto);
  updateFacsimile();
}

function renderTextForCanto(canto) {
  els.textPanelTitle.textContent = `Testo poetico — Canto ${toRoman(canto.n)}`;

  let html = `<div class="canto-heading">${escapeHTML(canto.heading)}</div>` + canto.elements.reduce((html, el) => {
    if (el.type === 'pb') return html + `<div class="folio-marker" data-folio="${el.n}" title="Vai al facsimile della carta ${el.n}">[c. ${el.n}]</div>`;
    if (el.type === 'cb') return html + `<span class="column-marker">col. ${el.n}</span>`;
    if (el.type === 'terzina') return html + renderTerzina(el);
    return html;
  }, '');

  html += `
    <div class="end-of-canto-actions" style="margin-top: 50px; padding: 30px 0; border-top: 1px solid var(--border-color); text-align: center;">
      <button id="goToCommentaryBtn" style="padding: 12px 24px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 1rem; display: inline-flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2rem;">${GLYPHS.PIEDIMOSCA}</span> Passa al Commento
      </button>
    </div>
  `;

  els.textContent.innerHTML = html;

  els.textContent.onclick = e => {
    const marker = e.target.closest('.folio-marker');
    if (marker) {
      const idx = FOLIO_ORDER.indexOf(marker.dataset.folio);
      if (idx >= 0) setCurrentFolioIdx(idx);
    }
    const line = e.target.closest('.verse-line');
    if (line) {
      els.textContent.querySelectorAll('.verse-line.active').forEach(l => l.classList.remove('active'));
      line.classList.add('active');
    }
    const btnCommentary = e.target.closest('#goToCommentaryBtn');
    if (btnCommentary) {
      state.currentView = 'commento';
      $$('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'commento'));
      els.viewFacsimile.classList.remove('active');
      els.viewCommento.classList.add('active');
      renderCommentoView();
      els.commentoContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  els.textContent.querySelectorAll('.margin-indicator').forEach(ind => {
    ind.onmouseenter = e => showMarginTooltip(e, ind);
    ind.onmouseleave = hideMarginTooltip;
  });
}

function renderTerzina(el) {
  return '<div class="terzina">' + el.lines.map(line => {
    const margins = (state.marginalia[line.xmlId] || []).map(m =>
      m.type === 'non_verbal'
        ? `<span class="margin-indicator nonverbal" data-margin-type="non_verbal" data-margin-content="${escapeHTML(m.content.trim() || '⁋ capitulum')}" data-margin-place="${m.place}">⁋</span>`
        : `<span class="margin-indicator" data-margin-type="verbal" data-margin-content="${escapeHTML(m.content)}" data-margin-place="${m.place}">m</span>`
    ).join('');

    return `<div class="verse-line" data-line-id="${line.xmlId}"><span class="line-number">${line.lineNum}</span><span class="verse-text">${line.html}</span>${margins}</div>`;
  }).join('') + '</div>';
}

function renderCommentoView() {
  const entries = state.commentary[state.currentCanto] || [];
  els.commentoPanelTitle.textContent = `Commento — Canto ${toRoman(state.currentCanto)}`;

  els.commentoContent.innerHTML = entries.length === 0
    ? '<p style="color:var(--text-muted);text-align:center;padding:40px;">Nessun commento disponibile.</p>'
    : entries.map(e => `<div class="commentary-entry" data-line-ref="${e.lineRef}"><div class="commentary-lemma">${e.refLabel ? `<span class="lemma-ref">${escapeHTML(e.refLabel)}</span>` : ''}${e.lemmaText ? `<span class="lemma-text">${escapeHTML(e.lemmaText)}</span>` : ''}</div><div class="commentary-body">${e.bodyHtml}</div></div>`).join('');

  els.commentoContent.querySelectorAll('.note-indicator').forEach(ind => ind.onclick = e => { e.stopPropagation(); showNotePopup(e, ind); });
}

/* ==========================================================================
   Navigation Helpers
   ========================================================================== */
function setCurrentFolioIdx(idx) {
  state.currentFolioIdx = Math.max(0, Math.min(idx, FOLIO_ORDER.length - 1));
  updateFacsimile();
}

function syncTextWithFolio(folioN) {
  const targetCanto = state.cantos.find(c => c.elements.some(el => el.type === 'pb' && el.n === folioN)) || state.cantos.find(c => c.n === state.currentCanto);
  if (!targetCanto) return;

  if (targetCanto.n !== state.currentCanto) {
    state.currentCanto = targetCanto.n;
    els.cantoSelect.value = targetCanto.n;
    renderTextForCanto(targetCanto);
  }

  const marker = els.textContent.querySelector(`.folio-marker[data-folio="${folioN}"]`);
  if (marker) {
    state.isSyncingText = true;
    clearTimeout(state.syncTimeout);

    els.textContent.querySelectorAll('.folio-marker.active').forEach(m => m.classList.remove('active'));
    marker.classList.add('active');

    els.textContent.scrollTo({ top: marker.getBoundingClientRect().top - els.textContent.getBoundingClientRect().top + els.textContent.scrollTop - 24, behavior: 'smooth' });

    state.syncTimeout = setTimeout(() => { state.isSyncingText = false; }, 600);
  }
}

function updateFacsimile(silent = false) {
  const folioN = FOLIO_ORDER[state.currentFolioIdx];
  if (els.facsimileImg) {
    els.facsimileImg.src = FACSIMILE_MAP[folioN] ? `assets/facsimile/${FACSIMILE_MAP[folioN]}` : '';
    els.facsimileImg.alt = FACSIMILE_MAP[folioN] ? `Facsimile carta ${folioN}` : 'Immagine non disponibile';
  }
  if (els.folioLabel) els.folioLabel.textContent = `c. ${folioN}`;

  if ($('#prevFolio')) $('#prevFolio').disabled = state.currentFolioIdx <= 0;
  if ($('#nextFolio')) $('#nextFolio').disabled = state.currentFolioIdx >= FOLIO_ORDER.length - 1;

  applyZoom();
  renderColumnBadges();

  if (!silent && state.currentView === 'facsimile') {
    syncTextWithFolio(folioN);
  } else if (silent) {
    els.textContent.querySelectorAll('.folio-marker.active').forEach(m => m.classList.remove('active'));
    const marker = els.textContent.querySelector(`.folio-marker[data-folio="${folioN}"]`);
    if (marker) marker.classList.add('active');
  }
}

const applyZoom = () => {
  els.facsimileImageWrap.style.transform = `scale(${state.zoom})`;
  els.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
};

/* ==========================================================================
   Tooltips & Popups
   ========================================================================== */
function showNotePopup(e, indicator) {
  const { noteTitle: title = 'Nota', noteContent: content = '' } = indicator.dataset;
  els.notePopup.querySelector('.note-popup-title').textContent = title;
  els.notePopup.querySelector('.note-popup-body').innerHTML = `<p>${content}</p>`;
  els.notePopup.classList.add('visible');

  const rect = indicator.getBoundingClientRect();
  els.notePopup.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - els.notePopup.offsetHeight - 8)}px`;
  els.notePopup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 380 - 16))}px`;
}

const hideNotePopup = () => els.notePopup.classList.remove('visible');

function showMarginTooltip(e, indicator) {
  const { marginType: type, marginContent: content, marginPlace: place = '' } = indicator.dataset;
  const placeLabels = { 'external_margin': 'Margine esterno', 'internal_margin': 'Margine interno', 'intercolumn': 'Intercolumnio', 'inferior_margin': 'Margine inferiore' };

  els.marginTooltip.innerHTML = `${place ? `<span class="margin-ref">${placeLabels[place] || place}</span>` : ''}${escapeHTML(content)}`;
  els.marginTooltip.classList.add('visible');

  const rect = indicator.getBoundingClientRect();
  els.marginTooltip.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - els.marginTooltip.offsetHeight - 8)}px`;
  els.marginTooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 340 - 16))}px`;
}

const hideMarginTooltip = () => els.marginTooltip.classList.remove('visible');

/* ==========================================================================
   Search 
   ========================================================================== */
function performSearch(query) {
  if (!query || query.length < 2) {
    els.searchResults.classList.remove('visible');
    return;
  }

  const results = [];
  const lowerQ = query.toLowerCase();

  for (const canto of state.cantos) {
    for (const el of canto.elements) {
      if (el.type === 'terzina') {
        for (const line of el.lines) {
          const plainText = stripHTML(line.html);
          if (plainText.toLowerCase().includes(lowerQ)) {
            results.push({ type: 'testo', cantoN: canto.n, ref: `Inf. ${toRoman(canto.n)}, ${line.lineNum}`, text: plainText, lineId: line.xmlId });
          }
        }
      }
    }
  }

  for (const [cantoN, entries] of Object.entries(state.commentary)) {
    for (const entry of entries) {
      const plainText = stripHTML(entry.bodyHtml);
      if (plainText.toLowerCase().includes(lowerQ)) {
        results.push({ type: 'commento', cantoN: parseInt(cantoN), ref: entry.refLabel || `Inf. ${toRoman(parseInt(cantoN))}`, text: plainText.substring(0, 200), lineRef: entry.lineRef });
      }
    }
  }

  renderSearchResults(results.slice(0, 20), query);
}

function renderSearchResults(results, query) {
  if (results.length === 0) {
    els.searchResults.innerHTML = '<div class="search-no-results">Nessun risultato trovato.</div>';
    els.searchResults.classList.add('visible');
    return;
  }

  const lowerQ = query.toLowerCase();
  els.searchResults.innerHTML = results.map(r => `
    <div class="search-result-item" data-canto="${r.cantoN}" data-type="${r.type}" data-line="${r.lineId || r.lineRef || ''}">
      <div class="search-result-ref">${r.type === 'commento' ? 'Commento' : 'Testo'} · ${escapeHTML(r.ref)}</div>
      <div class="search-result-text">${highlightMatch(r.text, lowerQ)}</div>
    </div>
  `).join('');

  els.searchResults.classList.add('visible');

  els.searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const cantoN = parseInt(item.dataset.canto);
      const type = item.dataset.type;

      state.currentCanto = cantoN;
      els.cantoSelect.value = cantoN;

      if (type === 'commento') {
        state.currentView = 'commento';
        $$('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'commento'));
        els.viewFacsimile.classList.remove('active');
        els.viewCommento.classList.add('active');
        renderCommentoView();
      } else {
        state.currentView = 'facsimile';
        $$('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'facsimile'));
        els.viewFacsimile.classList.add('active');
        els.viewCommento.classList.remove('active');
        renderFacsimileView();

        setTimeout(() => {
          const lineId = item.dataset.line;
          if (lineId) {
            const lineEl = els.textContent.querySelector(`[data-line-id="${lineId}"]`);
            if (lineEl) {
              lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              lineEl.classList.add('active');
            }
          }
        }, 100);
      }

      els.searchResults.classList.remove('visible');
      if (els.searchInput) els.searchInput.value = '';
    });
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return escapeHTML(text);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = '…' + excerpt;
  if (end < text.length) excerpt += '…';

  const matchIdx = excerpt.toLowerCase().indexOf(query);
  if (matchIdx >= 0) {
    return escapeHTML(excerpt.substring(0, matchIdx)) +
      `<mark>${escapeHTML(excerpt.substring(matchIdx, matchIdx + query.length))}</mark>` +
      escapeHTML(excerpt.substring(matchIdx + query.length));
  }
  return escapeHTML(excerpt);
}

function toRoman(n) {
  return [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    .reduce((res, [v, l]) => { while (n >= v) { res += l; n -= v; } return res; }, '');
}

/* ==========================================================================
   Event Binding 
   ========================================================================== */
function bindEvents() {
  $$('.view-tab').forEach(t => t.onclick = () => {
    state.currentView = t.dataset.view;
    $$('.view-tab').forEach(tab => tab.classList.toggle('active', tab === t));
    els.viewFacsimile.classList.toggle('active', state.currentView === 'facsimile');
    els.viewCommento.classList.toggle('active', state.currentView === 'commento');
    state.currentView === 'commento' ? renderCommentoView() : renderFacsimileView();
  });

  els.cantoSelect.onchange = () => {
    state.currentCanto = parseInt(els.cantoSelect.value);
    state.currentView === 'facsimile' ? renderFacsimileView() : renderCommentoView();
  };

  $('#prevFolio').onclick = () => setCurrentFolioIdx(state.currentFolioIdx - 1);
  $('#nextFolio').onclick = () => setCurrentFolioIdx(state.currentFolioIdx + 1);
  $('#zoomIn').onclick = () => { state.zoom = Math.min(4, state.zoom + 0.2); applyZoom(); };
  $('#zoomOut').onclick = () => { state.zoom = Math.max(0.3, state.zoom - 0.2); applyZoom(); };
  $('#zoomReset').onclick = () => { state.zoom = 1; applyZoom(); };

  const origRegToggle = $('#origRegToggle');
  if (origRegToggle) {
    origRegToggle.onclick = () => {
      state.showOrig = !state.showOrig;
      document.body.classList.toggle('show-orig', state.showOrig);
      origRegToggle.classList.toggle('active', state.showOrig);
      $('#toggleLabelReg')?.classList.toggle('active', !state.showOrig);
      $('#toggleLabelOrig')?.classList.toggle('active', state.showOrig);
    };
  }

  const darkModeToggle = $('#darkModeToggle');
  if (darkModeToggle) {
    darkModeToggle.onclick = () => {
      state.isDark = !state.isDark;
      document.body.classList.toggle('dark', state.isDark);
    };
  }

  $('#aboutBtn')?.addEventListener('click', () => els.aboutModal?.classList.add('visible'));
  $('#aboutClose')?.addEventListener('click', () => els.aboutModal?.classList.remove('visible'));
  els.aboutModal?.addEventListener('click', e => {
    if (e.target === els.aboutModal) els.aboutModal.classList.remove('visible');
  });

  const notePopupClose = els.notePopup?.querySelector('.note-popup-close');
  if (notePopupClose) notePopupClose.onclick = hideNotePopup;

  let searchTimer;
  if (els.searchInput) {
    els.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => performSearch(els.searchInput.value.trim()), 250);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.aboutModal?.classList.remove('visible');
      hideNotePopup();
      els.searchResults?.classList.remove('visible');
      els.searchInput?.blur();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      els.searchInput?.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) els.searchResults?.classList.remove('visible');
    if (!e.target.closest('.note-popup') && !e.target.closest('.note-indicator')) hideNotePopup();
  });

  let isPan = false, sX, sY, sL, sT;
  if (els.facsimileViewer) {
    els.facsimileViewer.onmousedown = e => {
      isPan = true;
      sX = e.pageX - els.facsimileViewer.offsetLeft;
      sY = e.pageY - els.facsimileViewer.offsetTop;
      sL = els.facsimileViewer.scrollLeft;
      sT = els.facsimileViewer.scrollTop;
    };
    document.onmousemove = e => {
      if (isPan) {
        e.preventDefault();
        els.facsimileViewer.scrollLeft = sL - (e.pageX - els.facsimileViewer.offsetLeft - sX);
        els.facsimileViewer.scrollTop = sT - (e.pageY - els.facsimileViewer.offsetTop - sY);
      }
    };
    document.onmouseup = () => isPan = false;

    els.facsimileViewer.onwheel = e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        state.zoom = Math.max(0.3, Math.min(4, state.zoom + (e.deltaY > 0 ? -0.1 : 0.1)));
        applyZoom();
      }
    };
  }

  if (els.textContent) {
    els.textContent.addEventListener('scroll', () => {
      if (state.isSyncingText || state.currentView !== 'facsimile') return;

      const markers = Array.from(els.textContent.querySelectorAll('.folio-marker'));
      if (!markers.length) return;

      const containerRect = els.textContent.getBoundingClientRect();
      const offset = containerRect.top + 150; 

      let currentMarker = markers[0];

      for (let i = 0; i < markers.length; i++) {
        const rect = markers[i].getBoundingClientRect();
        if (rect.top <= offset) {
          currentMarker = markers[i]; 
        } else {
          break; 
        }
      }

      const folioN = currentMarker.dataset.folio;
      const idx = FOLIO_ORDER.indexOf(folioN);

      if (idx >= 0 && state.currentFolioIdx !== idx) {
        state.currentFolioIdx = idx;
        updateFacsimile(true); 
      }
    });
  }
}

/* ==========================================================================
   Init
   ========================================================================== */
async function init() {
  cacheDom();
  try {
    const [commediaDoc, commentoDoc, marginiDoc] = await Promise.all([
      loadXML('data/commedia_inferno.xml'), loadXML('data/commento_inferno.xml'), loadXML('data/margini_inferno.xml')
    ]);

    Object.assign(state, { commediaDoc, commentoDoc, marginiDoc });
    state.cantos = parseCommedia(commediaDoc);
    state.commentary = parseCommentary(commentoDoc);
    state.marginalia = parseMarginalia(marginiDoc);
    state.folioContentMap = buildFolioContentMap(commediaDoc, commentoDoc);

    els.cantoSelect.innerHTML = state.cantos.map(c => `<option value="${c.n}">Canto ${toRoman(c.n)}</option>`).join('');

    bindEvents();
    renderFacsimileView();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    els.loadingOverlay.classList.add('hide');
    setTimeout(() => els.loadingOverlay.remove(), 500);
  } catch (err) {
    els.loadingOverlay.innerHTML = `<div style="text-align:center;padding:40px;"><p style="color:var(--accent);font-size:1.1rem;margin-bottom:8px;">Errore</p><p style="color:var(--text-muted);font-size:0.85rem;">${escapeHTML(err.message)}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);