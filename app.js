/* ==========================================================================
   Dante Commedia · Inferno — MS Harley 3459
   Digital Scholarly Edition — Application
   ========================================================================== */

const TEI_NS = 'http://www.tei-c.org/ns/1.0';
const XI_NS = 'http://www.w3.org/2001/XInclude';

/* --- State --- */
const state = {
  commediaDoc: null,
  commentoDoc: null,
  marginiDoc: null,
  cantos: [],          // parsed canto data
  commentary: {},      // cantoNum -> array of commentary entries
  marginalia: {},      // lineId -> array of margin notes
  folioContentMap: {}, // folioN -> {colA: {testo, commento, verseRange}, colB: {...}}
  folios: [],          // ordered folio entries {n, filename}
  currentView: 'facsimile',
  currentCanto: 1,
  currentFolioIdx: 0,
  zoom: 1,
  isDark: false,
  showOrig: false,
  noteCounter: 0,
};

/* --- Facsimile file mapping --- */
const FACSIMILE_MAP = {
  '2r':  'CNMD0000428772_-00006_carta_2r-12.jpg',
  '2v':  'CNMD0000428772_-00007_carta_2v-13.jpg',
  '3r':  'CNMD0000428772_-00008_carta_3r-14.jpg',
  '3v':  'CNMD0000428772_-00009_carta_3v-15.jpg',
  '4r':  'CNMD0000428772_-00010_carta_4r-16.jpg',
  '4v':  'CNMD0000428772_-00011_carta_4v-17.jpg',
  '5r':  'CNMD0000428772_-00012_carta_5r-18.jpg',
  '5v':  'CNMD0000428772_-00013_carta_5v-19.jpg',
  '6r':  'CNMD0000428772_-00014_carta_6r-20.jpg',
  '6v':  'CNMD0000428772_-00015_carta_6v-21.jpg',
  '7r':  'CNMD0000428772_-00016_carta_7r-22.jpg',
  '7v':  'CNMD0000428772_-00017_carta_7v-23.jpg',
  '8r':  'CNMD0000428772_-00018_carta_8r-24.jpg',
  '8v':  'CNMD0000428772_-00019_carta_8v-25.jpg',
  '9r':  'CNMD0000428772_-00020_carta_9r-26.jpg',
  '9v':  'CNMD0000428772_-00021_carta_9v-27.jpg',
  '10r': 'CNMD0000428772_-00022_carta_10r-28.jpg',
  '10v': 'CNMD0000428772_-00023_carta_10v-29.jpg',
  '11r': 'CNMD0000428772_-00024_carta_11r-5.jpg',
  '11v': 'CNMD0000428772_-00025_carta_11v-6.jpg',
};

/* Ordered folio list */
const FOLIO_ORDER = ['2r','2v','3r','3v','4r','4v','5r','5v','6r','6v','7r','7v','8r','8v','9r','9v','10r','10v','11r','11v'];

/* --- DOM refs --- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {};
function cacheDom() {
  els.loadingOverlay = $('#loadingOverlay');
  els.viewFacsimile = $('#viewFacsimile');
  els.viewCommento = $('#viewCommento');
  els.cantoSelect = $('#cantoSelect');
  els.textContent = $('#textContent');
  els.commentoContent = $('#commentoContent');
  els.commentoPanelTitle = $('#commentoPanelTitle');
  els.textPanelTitle = $('#textPanelTitle');
  els.facsimileImg = $('#facsimileImg');
  els.facsimileImageWrap = $('#facsimileImageWrap');
  els.facsimileViewer = $('#facsimileViewer');
  els.folioLabel = $('#folioLabel');
  els.zoomLevel = $('#zoomLevel');
  els.searchInput = $('#searchInput');
  els.searchResults = $('#searchResults');
  els.notePopup = $('#notePopup');
  els.marginTooltip = $('#marginTooltip');
  els.aboutModal = $('#aboutModal');
  els.columnBadges = $('#columnBadges');
  els.folioContentSummary = $('#folioContentSummary');
}

/* ==========================================================================
   XML Loading & Parsing
   ========================================================================== */

async function loadXML(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  return new DOMParser().parseFromString(text, 'application/xml');
}

function qsTEI(el, sel) {
  // Query within TEI namespace
  return el.querySelector(sel);
}

function qsaTEI(el, tag) {
  return [...el.getElementsByTagNameNS(TEI_NS, tag)];
}

function getAttr(el, name) {
  // xml:id needs special handling
  if (name === 'xml:id') return el.getAttribute('xml:id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
  return el.getAttribute(name);
}

/* ==========================================================================
   Parse Commedia
   ========================================================================== */
function parseCommedia(doc) {
  const cantos = [];
  const cantoDivs = qsaTEI(doc, 'div').filter(d => d.getAttribute('type') === 'canto');

  for (const cantoDiv of cantoDivs) {
    const n = parseInt(cantoDiv.getAttribute('n'));
    const xmlId = getAttr(cantoDiv, 'xml:id');
    const headEl = qsaTEI(cantoDiv, 'head')[0];
    const heading = headEl ? headEl.textContent.trim() : `Canto ${toRoman(n)}`;

    // Walk through children to build a page-aware structure
    const elements = []; // {type: 'pb'|'cb'|'terzina', ...}
    walkCantoChildren(cantoDiv, elements);

    cantos.push({ n, xmlId, heading, elements });
  }
  return cantos;
}

function walkCantoChildren(parent, elements) {
  for (const node of parent.childNodes) {
    if (node.nodeType !== 1) continue; // skip text nodes
    const localName = node.localName;

    if (localName === 'pb') {
      const n = node.getAttribute('n');
      if (n) elements.push({ type: 'pb', n });
    } else if (localName === 'cb') {
      const n = node.getAttribute('n');
      if (n) elements.push({ type: 'cb', n });
    } else if (localName === 'head') {
      // Skip canto head (handled separately)
    } else if (localName === 'lg') {
      const lgType = node.getAttribute('type');
      if (lgType === 'terzina') {
        const lines = parseTerzina(node, elements);
        elements.push({ type: 'terzina', lines });
      }
    } else {
      // Recurse into any wrapper elements
      walkCantoChildren(node, elements);
    }
  }
}

function parseTerzina(lgEl, elements) {
  const lines = [];
  for (const child of lgEl.childNodes) {
    if (child.nodeType !== 1) continue;
    if (child.localName === 'pb') {
      elements.push({ type: 'pb', n: child.getAttribute('n') });
    } else if (child.localName === 'cb') {
      elements.push({ type: 'cb', n: child.getAttribute('n') });
    } else if (child.localName === 'l') {
      const xmlId = getAttr(child, 'xml:id');
      const lineNum = extractLineNum(xmlId);
      const html = renderLineContent(child);
      lines.push({ xmlId, lineNum, html });
    }
  }
  return lines;
}

function extractLineNum(xmlId) {
  if (!xmlId) return '';
  const parts = xmlId.split('.');
  return parts.length >= 3 ? parseInt(parts[2]).toString() : xmlId;
}

function renderLineContent(lineEl) {
  let html = '';
  for (const node of lineEl.childNodes) {
    if (node.nodeType === 3) {
      html += escapeHTML(node.textContent);
    } else if (node.nodeType === 1) {
      html += renderInlineElement(node);
    }
  }
  return html;
}

function renderInlineElement(el) {
  const localName = el.localName;

  if (localName === 'choice') {
    const orig = qsaTEI(el, 'orig')[0];
    const reg = qsaTEI(el, 'reg')[0];
    if (orig && reg) {
      const origContent = renderLineContent(orig);
      const regContent = renderLineContent(reg);
      return `<span class="choice-reg" title="Lezione regolarizzata">${regContent}</span><span class="choice-orig" title="Lezione originale">${origContent}</span>`;
    }
    return renderLineContent(el);
  }

  if (localName === 'g') {
    const ref = el.getAttribute('ref');
    if (ref === '#middle_dot') return '·';
    if (ref === '#piedimosca') return '⸿';
    return el.textContent;
  }

  if (localName === 'subst') {
    const del = qsaTEI(el, 'del')[0];
    const add = qsaTEI(el, 'add')[0];
    let html = '';
    if (del) html += `<span class="scribal-del">${renderLineContent(del)}</span>`;
    if (add) html += `<span class="scribal-add">${renderLineContent(add)}</span>`;
    return html;
  }

  if (localName === 'del') {
    return `<span class="scribal-del">${renderLineContent(el)}</span>`;
  }

  if (localName === 'add') {
    return `<span class="scribal-add">${renderLineContent(el)}</span>`;
  }

  if (localName === 'supplied') {
    return `[${renderLineContent(el)}]`;
  }

  if (localName === 'pb' || localName === 'cb') {
    return ''; // handled at higher level
  }

  return renderLineContent(el);
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ==========================================================================
   Parse Commentary
   ========================================================================== */
function parseCommentary(doc) {
  const commentary = {};
  // Top-level commentary divs: <div n="1" type="commentary" xml:id="Ha_An_Inf.01">
  const topDivs = qsaTEI(doc, 'div').filter(d =>
    d.getAttribute('type') === 'commentary' && d.getAttribute('n')
  );

  for (const topDiv of topDivs) {
    const cantoN = parseInt(topDiv.getAttribute('n'));
    if (!commentary[cantoN]) commentary[cantoN] = [];

    // Inner divs: <div type="commentary" xml:id="Ha_An_Inf.01.001">
    const innerDivs = qsaTEI(topDiv, 'div').filter(d => d.getAttribute('type') === 'commentary');

    for (const innerDiv of innerDivs) {
      const xmlId = getAttr(innerDiv, 'xml:id');
      const entry = parseCommentaryEntry(innerDiv, xmlId);
      if (entry) commentary[cantoN].push(entry);
    }
  }
  return commentary;
}

function parseCommentaryEntry(div, xmlId) {
  state.noteCounter = 0;
  const pEls = qsaTEI(div, 'p');
  if (pEls.length === 0) return null;

  // Extract lemma from first <ref> > <quote> > <emph>
  let lemmaText = '';
  let lineRef = '';
  const firstRef = qsaTEI(div, 'ref')[0];
  if (firstRef) {
    const target = firstRef.getAttribute('target');
    if (target) lineRef = target.replace('#', '');
    const emph = qsaTEI(firstRef, 'emph')[0];
    if (emph) lemmaText = emph.textContent.trim();
    const quoteEl = qsaTEI(firstRef, 'quote')[0];
    if (!lemmaText && quoteEl) lemmaText = quoteEl.textContent.trim();
  }

  // Extract line number from lineRef for display
  let refLabel = '';
  if (lineRef) {
    const parts = lineRef.split('.');
    if (parts.length >= 3) {
      refLabel = `Inf. ${romanFromParts(parts[1])}, ${parseInt(parts[2])}`;
    }
  }

  // Build commentary body HTML
  const bodyHtml = renderCommentaryBody(pEls[0]);

  return { xmlId, lineRef, refLabel, lemmaText, bodyHtml };
}

function romanFromParts(str) {
  const n = parseInt(str);
  return toRoman(n);
}

function renderCommentaryBody(pEl) {
  let html = '';
  state.noteCounter = 0;
  // Skip the first <ref> element (already displayed as lemma)
  let skippedFirstRef = false;
  for (const child of pEl.childNodes) {
    if (child.nodeType === 1 && child.localName === 'ref' && child.getAttribute('target') && !skippedFirstRef) {
      skippedFirstRef = true;
      continue; // skip the first ref — it's the lemma
    }
    html += renderCommentaryNode(child);
  }
  return html.replace(/^\s*\.\s*/, '').trim();
}

function renderCommentaryNode(node) {
  if (node.nodeType === 3) return escapeHTML(node.textContent);
  if (node.nodeType !== 1) return '';

  const name = node.localName;

  // Skip the very first ref+quote (it's the lemma we already extracted)
  // We handle this by rendering it lightly
  if (name === 'ref' && node.getAttribute('target')) {
    // If this is a secondary ref (not the first one), render inline
    const target = node.getAttribute('target');
    const quoteEl = qsaTEI(node, 'quote')[0];
    const emphEl = qsaTEI(node, 'emph')[0];
    if (emphEl || quoteEl) {
      const text = emphEl ? emphEl.textContent : quoteEl ? quoteEl.textContent : '';
      return `<em class="mentioned">${escapeHTML(text.trim())}</em>`;
    }
    return renderCommentaryChildren(node);
  }

  if (name === 'emph' || name === 'mentioned') {
    return `<em class="mentioned">${renderCommentaryChildren(node)}</em>`;
  }

  if (name === 'quote') {
    // Check parent for <cit>
    if (node.parentNode && node.parentNode.localName === 'cit') {
      const langAttr = node.getAttribute('xml:lang') || node.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang');
      return `<span class="block-quote">${renderCommentaryChildren(node)}</span>`;
    }
    return `«${renderCommentaryChildren(node)}»`;
  }

  if (name === 'cit') {
    return renderCommentaryChildren(node);
  }

  if (name === 'note') {
    const type = node.getAttribute('type');
    if (type === 'philological-note' || type === 'bibliographical-ref' || type === 'philological-commentary') {
      state.noteCounter++;
      const noteId = `note-${Date.now()}-${state.noteCounter}`;
      const noteContent = escapeHTML(node.textContent.trim());
      const label = type === 'bibliographical-ref' ? 'Rif. bibliografico' :
                    type === 'philological-commentary' ? 'Nota filologica' : 'Nota filologica';
      return `<span class="note-indicator" data-note-id="${noteId}" data-note-title="${label}" data-note-content="${noteContent.replace(/"/g, '&quot;')}" title="${label}">${state.noteCounter}</span>`;
    }
    return renderCommentaryChildren(node);
  }

  if (name === 'app') {
    const type = node.getAttribute('type');
    if (type === 'philological') {
      const lem = qsaTEI(node, 'lem')[0];
      const rdg = qsaTEI(node, 'rdg')[0];
      if (lem && rdg) {
        state.noteCounter++;
        const noteId = `app-${Date.now()}-${state.noteCounter}`;
        const content = `Lem.: ${lem.textContent.trim()} | Var.: ${rdg.textContent.trim()}`;
        return `${escapeHTML(lem.textContent.trim())}<span class="note-indicator app-indicator" data-note-id="${noteId}" data-note-title="Apparato" data-note-content="${escapeHTML(content)}" title="Apparato filologico">⊕</span>`;
      }
    }
    // Render lem only
    const lem = qsaTEI(node, 'lem')[0];
    if (lem) return renderCommentaryChildren(lem);
    return renderCommentaryChildren(node);
  }

  if (name === 'choice') {
    const orig = qsaTEI(node, 'orig')[0];
    const reg = qsaTEI(node, 'reg')[0];
    if (orig && reg) {
      const origContent = renderCommentaryChildren(orig);
      const regContent = renderCommentaryChildren(reg);
      return `<span class="choice-reg" title="Lezione regolarizzata">${regContent}</span><span class="choice-orig" title="Lezione originale">${origContent}</span>`;
    }
    if (reg) return renderCommentaryChildren(reg);
    if (orig) return renderCommentaryChildren(orig);
    return renderCommentaryChildren(node);
  }

  if (name === 'subst') {
    const del = qsaTEI(node, 'del')[0];
    const add = qsaTEI(node, 'add')[0];
    let html = '';
    if (del) html += `<span class="scribal-del">${escapeHTML(del.textContent)}</span>`;
    if (add) html += `<span class="scribal-add">${escapeHTML(add.textContent)}</span>`;
    return html;
  }

  if (name === 'del') {
    return `<span class="scribal-del">${renderCommentaryChildren(node)}</span>`;
  }

  if (name === 'add') {
    return `<span class="scribal-add">${escapeHTML(node.textContent)}</span>`;
  }

  if (name === 'g') {
    const ref = node.getAttribute('ref');
    if (ref === '#middle_dot') return '·';
    if (ref === '#piedimosca') return '⸿';
    return node.textContent;
  }

  if (name === 'pb' || name === 'cb') {
    return ''; // skip page/column breaks in commentary view
  }

  if (name === 'supplied') {
    return `[${renderCommentaryChildren(node)}]`;
  }

  return renderCommentaryChildren(node);
}

function renderCommentaryChildren(node) {
  let html = '';
  for (const child of node.childNodes) {
    html += renderCommentaryNode(child);
  }
  return html;
}

/* ==========================================================================
   Parse Marginalia
   ========================================================================== */
function parseMarginalia(doc) {
  const marginalia = {}; // lineId -> [{type, content, place}]

  const cantoDivs = qsaTEI(doc, 'div').filter(d => d.getAttribute('type') === 'canto');
  for (const cantoDiv of cantoDivs) {
    const notes = qsaTEI(cantoDiv, 'note');
    for (const note of notes) {
      const place = note.getAttribute('place');
      const type = note.getAttribute('type');
      const target = note.getAttribute('target');

      if (type === 'verbal' || type === 'non_verbal') {
        // This is a specific note with a target
        const lineId = target ? target.replace('#', '') : '';
        if (lineId) {
          if (!marginalia[lineId]) marginalia[lineId] = [];
          marginalia[lineId].push({
            type: type,
            content: note.textContent.trim(),
            place: place || getParentPlace(note),
          });
        }
      } else if (place) {
        // Container note — find child refs
        const refs = qsaTEI(note, 'ref');
        for (const ref of refs) {
          const refType = ref.getAttribute('type') || 'verbal';
          const refTarget = ref.getAttribute('target');
          const lineId = refTarget ? refTarget.replace('#', '') : '';
          if (lineId) {
            if (!marginalia[lineId]) marginalia[lineId] = [];
            marginalia[lineId].push({
              type: refType,
              content: ref.textContent.trim(),
              place: place,
            });
          }
        }
        // Also find child <note> elements
        const childNotes = [...note.children].filter(c => c.localName === 'note');
        for (const cn of childNotes) {
          const cnType = cn.getAttribute('type') || 'verbal';
          const cnTarget = cn.getAttribute('target');
          const lineId = cnTarget ? cnTarget.replace('#', '') : '';
          if (lineId) {
            if (!marginalia[lineId]) marginalia[lineId] = [];
            marginalia[lineId].push({
              type: cnType,
              content: cn.textContent.trim(),
              place: place,
            });
          }
        }
      }
    }
  }
  return marginalia;
}

function getParentPlace(el) {
  let parent = el.parentNode;
  while (parent) {
    if (parent.localName === 'note' && parent.getAttribute('place')) {
      return parent.getAttribute('place');
    }
    parent = parent.parentNode;
  }
  return '';
}

/* ==========================================================================
   Build Folio → Content Map
   Maps each folio+column to its content types (testo/commento) with verse ranges
   ========================================================================== */
function buildFolioContentMap(commediaDoc, commentoDoc) {
  const map = {}; // folioN -> { A: {testo: bool, commento: bool, verseRange: str}, B: {...} }

  // Helper: ensure folio entry exists
  function ensureFolio(folioN) {
    if (!map[folioN]) {
      map[folioN] = {
        A: { testo: false, commento: false, verseRange: '', cantoN: 0 },
        B: { testo: false, commento: false, verseRange: '', cantoN: 0 },
      };
    }
  }

  // Helper: normalize column name to A/B
  function normCol(col) {
    if (!col) return 'A';
    const u = col.toUpperCase();
    return (u === 'B') ? 'B' : 'A';
  }

  // 1) Walk commedia XML for text content per folio/column
  let curPb = null;
  let curCb = 'A';
  let curCantoN = 0;
  let colLines = {}; // (folio, col) -> [lineNums]

  function walkTextNode(node) {
    if (node.nodeType !== 1) return;
    const localName = node.localName;

    if (localName === 'pb') {
      const n = node.getAttribute('n');
      if (n) { curPb = n; curCb = 'A'; }
    } else if (localName === 'cb') {
      const n = node.getAttribute('n');
      if (n) curCb = normCol(n);
    } else if (localName === 'div' && node.getAttribute('type') === 'canto') {
      const n = parseInt(node.getAttribute('n'));
      if (n) curCantoN = n;
    } else if (localName === 'l' && curPb) {
      const xmlId = getAttr(node, 'xml:id');
      if (xmlId) {
        ensureFolio(curPb);
        const col = normCol(curCb);
        map[curPb][col].testo = true;
        if (!map[curPb][col].cantoN) map[curPb][col].cantoN = curCantoN;

        const key = curPb + '|' + col;
        if (!colLines[key]) colLines[key] = [];
        const parts = xmlId.split('.');
        if (parts.length >= 3) colLines[key].push(parseInt(parts[2]));
      }
    }

    for (const child of node.childNodes) {
      walkTextNode(child);
    }
  }

  const textBody = commediaDoc.getElementsByTagNameNS(TEI_NS, 'body')[0];
  if (textBody) walkTextNode(textBody);

  // Fill verse ranges
  for (const [key, nums] of Object.entries(colLines)) {
    if (nums.length === 0) continue;
    const [folioN, col] = key.split('|');
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const cantoN = map[folioN][col].cantoN;
    map[folioN][col].verseRange = `${toRoman(cantoN)}, ${min}–${max}`;
  }

  // 2) Walk commento XML for commentary content per folio/column
  let comPb = null;
  let comCb = 'A';
  let insideCommentary = false;

  function walkCommentoNode(node) {
    if (node.nodeType !== 1) return;
    const localName = node.localName;

    if (localName === 'pb') {
      const n = node.getAttribute('n');
      if (n) { comPb = n; comCb = 'A'; }
    } else if (localName === 'cb') {
      const n = node.getAttribute('n');
      if (n) comCb = normCol(n);
    } else if (localName === 'div' && node.getAttribute('type') === 'commentary') {
      // Mark this folio/col as having commentary
      if (comPb) {
        ensureFolio(comPb);
        map[comPb][normCol(comCb)].commento = true;
      }
    }

    for (const child of node.childNodes) {
      walkCommentoNode(child);
    }
  }

  const comBody = commentoDoc.getElementsByTagNameNS(TEI_NS, 'body')[0];
  if (comBody) walkCommentoNode(comBody);

  // Also check for pb/cb inside commentary entries (mid-entry page breaks)
  // Already handled by walking all nodes including those inside divs

  return map;
}

/* ==========================================================================
   Render Column Badges on Facsimile
   ========================================================================== */
function renderColumnBadges() {
  const folioN = FOLIO_ORDER[state.currentFolioIdx];
  const info = state.folioContentMap[folioN];
  const badgeContainer = els.columnBadges;
  const summaryEl = els.folioContentSummary;

  if (!info) {
    badgeContainer.innerHTML = '';
    summaryEl.innerHTML = '';
    return;
  }

  const colA = info.A;
  const colB = info.B;

  // Determine what each column contains
  function getColType(col) {
    if (col.testo && col.commento) return 'misto';
    if (col.commento) return 'commento';
    if (col.testo) return 'testo';
    return null;
  }

  function badgeLabel(col, colType) {
    if (colType === 'misto') {
      let label = 'Testo + Commento';
      if (col.verseRange) label = `Testo ${col.verseRange} + Comm.`;
      return label;
    }
    if (colType === 'commento') return 'Commento';
    if (colType === 'testo') {
      return col.verseRange ? `Testo ${col.verseRange}` : 'Testo';
    }
    return '';
  }

  const typeA = getColType(colA);
  const typeB = getColType(colB);

  let badgesHtml = '';

  // If both columns have the same type and it's a simple case, show a single centered badge
  if (typeA && typeB) {
    // Two columns, two badges
    badgesHtml += `<div class="col-badge col-left badge-${typeA}">
      <span class="col-badge-dot"></span>
      <span>Col. A · ${badgeLabel(colA, typeA)}</span>
    </div>`;
    badgesHtml += `<div class="col-badge col-right badge-${typeB}">
      <span class="col-badge-dot"></span>
      <span>Col. B · ${badgeLabel(colB, typeB)}</span>
    </div>`;
  } else if (typeA && !typeB) {
    badgesHtml += `<div class="col-badge col-left badge-${typeA}">
      <span class="col-badge-dot"></span>
      <span>${badgeLabel(colA, typeA)}</span>
    </div>`;
  } else if (!typeA && typeB) {
    badgesHtml += `<div class="col-badge col-right badge-${typeB}">
      <span class="col-badge-dot"></span>
      <span>${badgeLabel(colB, typeB)}</span>
    </div>`;
  }

  badgeContainer.innerHTML = badgesHtml;

  // Summary bar below image
  const hasTesto = colA.testo || colB.testo;
  const hasCommento = colA.commento || colB.commento;

  let summaryHtml = '';
  if (hasTesto && hasCommento) {
    summaryHtml = `<span class="content-legend"><span class="legend-dot dot-testo"></span> Testo</span>
                   <span class="content-legend"><span class="legend-dot dot-commento"></span> Commento</span>
                   <span style="color:var(--accent);font-weight:500;">Carta con compresenza testo–commento</span>`;
  } else if (hasCommento) {
    summaryHtml = `<span class="content-legend"><span class="legend-dot dot-commento"></span> Carta interamente di commento</span>`;
  } else if (hasTesto) {
    summaryHtml = `<span class="content-legend"><span class="legend-dot dot-testo"></span> Carta di testo poetico</span>`;
  }
  summaryEl.innerHTML = summaryHtml;
}

/* ==========================================================================
   Rendering — View 1: Facsimile e Testo
   ========================================================================== */
function renderFacsimileView() {
  const canto = state.cantos.find(c => c.n === state.currentCanto);
  if (!canto) return;

  // Find which folios belong to this canto
  const cantoFolios = [];
  for (const el of canto.elements) {
    if (el.type === 'pb' && !cantoFolios.includes(el.n)) {
      cantoFolios.push(el.n);
    }
  }

  // If the canto doesn't start with a pb, use the first pb from the previous canto or default
  if (cantoFolios.length === 0) {
    cantoFolios.push(FOLIO_ORDER[0]);
  }

  // Set folio to first of this canto
  const firstFolioIdx = FOLIO_ORDER.indexOf(cantoFolios[0]);
  if (firstFolioIdx >= 0) {
    state.currentFolioIdx = firstFolioIdx;
  }

  renderTextForCanto(canto);
  updateFacsimile();
}

function renderTextForCanto(canto) {
  els.textPanelTitle.textContent = `Testo poetico — Canto ${toRoman(canto.n)}`;
  let html = `<div class="canto-heading">${escapeHTML(canto.heading)}</div>`;

  for (const el of canto.elements) {
    if (el.type === 'pb') {
      html += `<div class="folio-marker" data-folio="${el.n}" title="Vai al facsimile della carta ${el.n}">[c. ${el.n}]</div>`;
    } else if (el.type === 'cb') {
      html += `<span class="column-marker">col. ${el.n}</span>`;
    } else if (el.type === 'terzina') {
      html += renderTerzina(el);
    }
  }

  els.textContent.innerHTML = html;

  // Bind folio markers
  els.textContent.querySelectorAll('.folio-marker').forEach(marker => {
    marker.addEventListener('click', () => {
      const folio = marker.dataset.folio;
      const idx = FOLIO_ORDER.indexOf(folio);
      if (idx >= 0) {
        state.currentFolioIdx = idx;
        updateFacsimile();
      }
    });
  });

  // Bind verse clicks
  els.textContent.querySelectorAll('.verse-line').forEach(line => {
    line.addEventListener('click', () => {
      // Remove previous active
      els.textContent.querySelectorAll('.verse-line.active').forEach(l => l.classList.remove('active'));
      line.classList.add('active');
    });
  });

  // Bind margin indicators
  els.textContent.querySelectorAll('.margin-indicator').forEach(ind => {
    ind.addEventListener('mouseenter', (e) => showMarginTooltip(e, ind));
    ind.addEventListener('mouseleave', hideMarginTooltip);
    ind.addEventListener('click', (e) => {
      e.stopPropagation();
      showMarginTooltip(e, ind);
    });
  });
}

function renderTerzina(el) {
  let html = '<div class="terzina">';
  for (const line of el.lines) {
    const margins = state.marginalia[line.xmlId] || [];
    let marginHtml = '';
    for (const m of margins) {
      if (m.type === 'non_verbal') {
        const symbol = m.content.trim() || '⸿';
        marginHtml += `<span class="margin-indicator nonverbal" data-margin-type="non_verbal" data-margin-content="${escapeHTML(symbol)}" data-margin-place="${m.place}" title="Segno marginale">⸿</span>`;
      } else {
        marginHtml += `<span class="margin-indicator" data-margin-type="verbal" data-margin-content="${escapeHTML(m.content)}" data-margin-place="${m.place}" title="Annotazione marginale">m</span>`;
      }
    }

    html += `<div class="verse-line" data-line-id="${line.xmlId}">`;
    html += `<span class="line-number">${line.lineNum}</span>`;
    html += `<span class="verse-text">${line.html}</span>`;
    html += marginHtml;
    html += `</div>`;
  }
  html += '</div>';
  return html;
}

/* ==========================================================================
   Rendering — View 2: Commento
   ========================================================================== */
function renderCommentoView() {
  const cantoN = state.currentCanto;
  const entries = state.commentary[cantoN] || [];
  els.commentoPanelTitle.textContent = `Commento — Canto ${toRoman(cantoN)}`;

  if (entries.length === 0) {
    els.commentoContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;font-family:var(--font-serif);">Nessun commento disponibile per questo canto.</p>';
    return;
  }

  let html = '';
  for (const entry of entries) {
    html += `<div class="commentary-entry" data-line-ref="${entry.lineRef}">`;
    html += `<div class="commentary-lemma">`;
    if (entry.refLabel) {
      html += `<span class="lemma-ref">${escapeHTML(entry.refLabel)}</span>`;
    }
    if (entry.lemmaText) {
      html += `<span class="lemma-text">${escapeHTML(entry.lemmaText)}</span>`;
    }
    html += `</div>`;
    html += `<div class="commentary-body">${entry.bodyHtml}</div>`;
    html += `</div>`;
  }

  els.commentoContent.innerHTML = html;

  // Bind note indicators
  els.commentoContent.querySelectorAll('.note-indicator').forEach(ind => {
    ind.addEventListener('click', (e) => {
      e.stopPropagation();
      showNotePopup(e, ind);
    });
  });
}

/* ==========================================================================
   Facsimile Viewer
   ========================================================================== */
function updateFacsimile() {
  const folioN = FOLIO_ORDER[state.currentFolioIdx];
  const filename = FACSIMILE_MAP[folioN];

  if (filename) {
    els.facsimileImg.src = `assets/facsimile/${filename}`;
    els.facsimileImg.alt = `Facsimile carta ${folioN}`;
  } else {
    els.facsimileImg.src = '';
    els.facsimileImg.alt = 'Immagine non disponibile';
  }

  els.folioLabel.textContent = `c. ${folioN}`;
  $('#prevFolio').disabled = state.currentFolioIdx <= 0;
  $('#nextFolio').disabled = state.currentFolioIdx >= FOLIO_ORDER.length - 1;

  applyZoom();
  renderColumnBadges();
}

function applyZoom() {
  els.facsimileImageWrap.style.transform = `scale(${state.zoom})`;
  els.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
}

/* ==========================================================================
   Popups & Tooltips
   ========================================================================== */
function showNotePopup(e, indicator) {
  const popup = els.notePopup;
  const title = indicator.dataset.noteTitle || 'Nota';
  const content = indicator.dataset.noteContent || '';

  popup.querySelector('.note-popup-title').textContent = title;
  popup.querySelector('.note-popup-body').innerHTML = `<p>${content}</p>`;
  popup.classList.add('visible');

  // Position near the indicator
  const rect = indicator.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;

  // Keep within viewport
  const popW = 380;
  const popH = popup.offsetHeight || 200;
  if (left + popW > window.innerWidth) left = window.innerWidth - popW - 16;
  if (left < 8) left = 8;
  if (top + popH > window.innerHeight) top = rect.top - popH - 8;

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
}

function hideNotePopup() {
  els.notePopup.classList.remove('visible');
}

function showMarginTooltip(e, indicator) {
  const tooltip = els.marginTooltip;
  const type = indicator.dataset.marginType;
  const content = indicator.dataset.marginContent;
  const place = indicator.dataset.marginPlace || '';

  const placeLabels = {
    'external_margin': 'Margine esterno',
    'internal_margin': 'Margine interno',
    'intercolumn': 'Intercolonnio',
    'inferior_margin': 'Margine inferiore',
  };

  let html = '';
  if (place) html += `<span class="margin-ref">${placeLabels[place] || place}</span>`;
  html += escapeHTML(content);

  tooltip.innerHTML = html;
  tooltip.classList.add('visible');

  const rect = indicator.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;

  if (left + 340 > window.innerWidth) left = window.innerWidth - 340 - 16;
  if (left < 8) left = 8;
  if (top + tooltip.offsetHeight > window.innerHeight) top = rect.top - tooltip.offsetHeight - 8;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function hideMarginTooltip() {
  els.marginTooltip.classList.remove('visible');
}

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

  // Search in cantos
  for (const canto of state.cantos) {
    for (const el of canto.elements) {
      if (el.type === 'terzina') {
        for (const line of el.lines) {
          const plainText = stripHTML(line.html);
          if (plainText.toLowerCase().includes(lowerQ)) {
            results.push({
              type: 'testo',
              cantoN: canto.n,
              ref: `Inf. ${toRoman(canto.n)}, ${line.lineNum}`,
              text: plainText,
              lineId: line.xmlId,
            });
          }
        }
      }
    }
  }

  // Search in commentary
  for (const [cantoN, entries] of Object.entries(state.commentary)) {
    for (const entry of entries) {
      const plainText = stripHTML(entry.bodyHtml);
      if (plainText.toLowerCase().includes(lowerQ)) {
        results.push({
          type: 'commento',
          cantoN: parseInt(cantoN),
          ref: entry.refLabel || `Inf. ${toRoman(parseInt(cantoN))}`,
          text: plainText.substring(0, 200),
          lineRef: entry.lineRef,
        });
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
  let html = '';
  for (const r of results) {
    const highlighted = highlightMatch(r.text, lowerQ);
    html += `<div class="search-result-item" data-canto="${r.cantoN}" data-type="${r.type}" data-line="${r.lineId || r.lineRef || ''}">`;
    html += `<div class="search-result-ref">${r.type === 'commento' ? 'Commento' : 'Testo'} · ${escapeHTML(r.ref)}</div>`;
    html += `<div class="search-result-text">${highlighted}</div>`;
    html += `</div>`;
  }

  els.searchResults.innerHTML = html;
  els.searchResults.classList.add('visible');

  // Bind clicks
  els.searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      const cantoN = parseInt(item.dataset.canto);
      const type = item.dataset.type;

      state.currentCanto = cantoN;
      els.cantoSelect.value = cantoN;

      if (type === 'commento') {
        switchView('commento');
        renderCommentoView();
      } else {
        switchView('facsimile');
        renderFacsimileView();
        // Try to scroll to the line
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
      els.searchInput.value = '';
    });
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return escapeHTML(text);

  // Show context around match
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = '…' + excerpt;
  if (end < text.length) excerpt += '…';

  // Highlight
  const matchIdx = excerpt.toLowerCase().indexOf(query);
  if (matchIdx >= 0) {
    return escapeHTML(excerpt.substring(0, matchIdx)) +
           `<mark>${escapeHTML(excerpt.substring(matchIdx, matchIdx + query.length))}</mark>` +
           escapeHTML(excerpt.substring(matchIdx + query.length));
  }
  return escapeHTML(excerpt);
}

function stripHTML(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

/* ==========================================================================
   Navigation & UI
   ========================================================================== */
function switchView(view) {
  state.currentView = view;
  $$('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  els.viewFacsimile.classList.toggle('active', view === 'facsimile');
  els.viewCommento.classList.toggle('active', view === 'commento');

  if (view === 'commento') {
    renderCommentoView();
  } else {
    renderFacsimileView();
  }
}

function switchCanto(n) {
  state.currentCanto = n;
  if (state.currentView === 'facsimile') {
    renderFacsimileView();
  } else {
    renderCommentoView();
  }
}

function populateCantoSelect() {
  const cantoNums = state.cantos.map(c => c.n).sort((a, b) => a - b);
  els.cantoSelect.innerHTML = cantoNums.map(n =>
    `<option value="${n}">Canto ${toRoman(n)}</option>`
  ).join('');
  els.cantoSelect.value = state.currentCanto;
}

/* ==========================================================================
   Pan & Zoom for Facsimile
   ========================================================================== */
function initFacsimileInteraction() {
  let isPanning = false;
  let startX, startY, scrollLeft, scrollTop;

  els.facsimileViewer.addEventListener('mousedown', (e) => {
    isPanning = true;
    startX = e.pageX - els.facsimileViewer.offsetLeft;
    startY = e.pageY - els.facsimileViewer.offsetTop;
    scrollLeft = els.facsimileViewer.scrollLeft;
    scrollTop = els.facsimileViewer.scrollTop;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    e.preventDefault();
    const x = e.pageX - els.facsimileViewer.offsetLeft;
    const y = e.pageY - els.facsimileViewer.offsetTop;
    els.facsimileViewer.scrollLeft = scrollLeft - (x - startX);
    els.facsimileViewer.scrollTop = scrollTop - (y - startY);
  });

  document.addEventListener('mouseup', () => {
    isPanning = false;
  });

  // Mouse wheel zoom
  els.facsimileViewer.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      state.zoom = Math.max(0.3, Math.min(4, state.zoom + delta));
      applyZoom();
    }
  }, { passive: false });
}

/* ==========================================================================
   Event Binding
   ========================================================================== */
function bindEvents() {
  // View tabs
  $$('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Canto select
  els.cantoSelect.addEventListener('change', () => {
    switchCanto(parseInt(els.cantoSelect.value));
  });

  // Folio navigation
  $('#prevFolio').addEventListener('click', () => {
    if (state.currentFolioIdx > 0) {
      state.currentFolioIdx--;
      updateFacsimile();
    }
  });
  $('#nextFolio').addEventListener('click', () => {
    if (state.currentFolioIdx < FOLIO_ORDER.length - 1) {
      state.currentFolioIdx++;
      updateFacsimile();
    }
  });

  // Zoom
  $('#zoomIn').addEventListener('click', () => {
    state.zoom = Math.min(4, state.zoom + 0.2);
    applyZoom();
  });
  $('#zoomOut').addEventListener('click', () => {
    state.zoom = Math.max(0.3, state.zoom - 0.2);
    applyZoom();
  });
  $('#zoomReset').addEventListener('click', () => {
    state.zoom = 1;
    applyZoom();
  });

  // Search
  let searchTimer;
  els.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(els.searchInput.value.trim()), 250);
  });
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.searchResults.classList.remove('visible');
      els.searchInput.blur();
    }
  });

  // Close search on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      els.searchResults.classList.remove('visible');
    }
    if (!e.target.closest('.note-popup') && !e.target.closest('.note-indicator')) {
      hideNotePopup();
    }
  });

  // Orig/Reg toggle
  $('#origRegToggle').addEventListener('click', () => {
    state.showOrig = !state.showOrig;
    document.body.classList.toggle('show-orig', state.showOrig);
    $('#origRegToggle').classList.toggle('active', state.showOrig);
    $('#toggleLabelReg').classList.toggle('active', !state.showOrig);
    $('#toggleLabelOrig').classList.toggle('active', state.showOrig);
  });

  // Dark mode
  $('#darkModeToggle').addEventListener('click', () => {
    state.isDark = !state.isDark;
    document.body.classList.toggle('dark', state.isDark);
  });

  // About modal
  $('#aboutBtn').addEventListener('click', () => {
    els.aboutModal.classList.add('visible');
  });
  $('#aboutClose').addEventListener('click', () => {
    els.aboutModal.classList.remove('visible');
  });
  els.aboutModal.addEventListener('click', (e) => {
    if (e.target === els.aboutModal) els.aboutModal.classList.remove('visible');
  });

  // Note popup close
  els.notePopup.querySelector('.note-popup-close').addEventListener('click', hideNotePopup);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      els.aboutModal.classList.remove('visible');
      hideNotePopup();
      els.searchResults.classList.remove('visible');
    }
    // Ctrl+K for search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      els.searchInput.focus();
    }
  });

  // Facsimile pan
  initFacsimileInteraction();
}

/* ==========================================================================
   Utilities
   ========================================================================== */
function toRoman(num) {
  const romanNumerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let result = '';
  for (const [value, numeral] of romanNumerals) {
    while (num >= value) { result += numeral; num -= value; }
  }
  return result;
}

/* ==========================================================================
   Initialization
   ========================================================================== */
async function init() {
  cacheDom();

  try {
    const [commediaDoc, commentoDoc, marginiDoc] = await Promise.all([
      loadXML('data/commedia_inferno.xml'),
      loadXML('data/commento_inferno.xml'),
      loadXML('data/margini_inferno.xml'),
    ]);

    state.commediaDoc = commediaDoc;
    state.commentoDoc = commentoDoc;
    state.marginiDoc = marginiDoc;

    // Parse
    state.cantos = parseCommedia(commediaDoc);
    state.commentary = parseCommentary(commentoDoc);
    state.marginalia = parseMarginalia(marginiDoc);
    state.folioContentMap = buildFolioContentMap(commediaDoc, commentoDoc);

    // Populate UI
    populateCantoSelect();
    bindEvents();

    // Initial render
    renderFacsimileView();

    // Initialize Lucide icons
    lucide.createIcons();

    // Hide loading
    els.loadingOverlay.classList.add('hide');
    setTimeout(() => els.loadingOverlay.remove(), 500);

  } catch (err) {
    console.error('Error loading edition:', err);
    els.loadingOverlay.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <p style="color:var(--accent);font-size:1.1rem;margin-bottom:8px;">Errore nel caricamento</p>
        <p style="color:var(--text-muted);font-size:0.85rem;">${escapeHTML(err.message)}</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', init);
