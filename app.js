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
  petrocchiDoc: null,
  cantos: [],
  petrocchiCantos: [],
  commentary: {},
  marginalia: {},
  marginNotes: {},
  folioContentMap: {},
  currentView: 'home',
  currentCanto: 1,
  currentFolioIdx: 0,
  zoom: 1,
  isDark: false,
  showOrig: false,
  noteCounter: 0,
  marginNoteCounter: 0,
  isSyncingText: false,
  isSyncingCommento: false,
  syncTimeout: null,
  commentoSyncTimeout: null,
  showTextPanel: true,
  showCommentoPanel: true
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
    viewHome: $('#viewHome'),
    viewFacsimile: $('#viewFacsimile'),
    viewCommento: $('#viewCommento'),
    viewConfronto: $('#viewConfronto'),
    cantoSelect: $('#cantoSelect'),
    textContent: $('#textContent'),
    commentoContent: $('#commentoContent'),
    completeCommentoContent: $('#completeCommentoContent'),
    commentoPanelTitle: $('#commentoPanelTitle'),
    completeCommentoPanelTitle: $('#completeCommentoPanelTitle'),
    confrontoContent: $('#confrontoContent'),
    confrontoPanelTitle: $('#confrontoPanelTitle'),
    toggleTextPanel: $('#toggleTextPanel'),
    toggleCommentoPanel: $('#toggleCommentoPanel'),
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
  if (!resp.ok) throw new Error(`Impossibile caricare ${url}`);
  return new DOMParser().parseFromString(await resp.text(), 'application/xml');
}

async function loadOptionalXML(url) {
  try {
    return await loadXML(url);
  } catch (err) {
    console.warn(`File opzionale non caricato: ${url}`, err);
    return null;
  }
}

const qsaTEI = (el, tag) => [...el.getElementsByTagNameNS(TEI_NS, tag)];
const qsTEI = (el, tag) => qsaTEI(el, tag)[0];

function getAttr(el, name) {
  if (name === 'xml:id') return el.getAttribute('xml:id') || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'id');
  return el.getAttribute(name);
}

function getDirectTEIChild(el, tagName) {
  if (!el) return null;

  return [...el.childNodes].find(child =>
    child.nodeType === Node.ELEMENT_NODE &&
    child.namespaceURI === TEI_NS &&
    child.localName === tagName
  ) || null;
}

function getAncestorTEIDivByType(el, type) {
  let current = el?.parentElement || null;

  while (current) {
    if (
      current.namespaceURI === TEI_NS &&
      current.localName === 'div' &&
      current.getAttribute('type') === type
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function isLastCantoInCantica(cantoDiv, canticaDiv) {
  if (!cantoDiv || !canticaDiv) return false;

  const cantos = [...canticaDiv.childNodes].filter(child =>
    child.nodeType === Node.ELEMENT_NODE &&
    child.namespaceURI === TEI_NS &&
    child.localName === 'div' &&
    child.getAttribute('type') === 'canto'
  );

  return cantos.length > 0 && cantos[cantos.length - 1] === cantoDiv;
}

function getNextTEIElementSibling(el) {
  let current = el?.nextSibling || null;

  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && current.namespaceURI === TEI_NS) {
      return current;
    }

    current = current.nextSibling;
  }

  return null;
}

function getPreviousTEIElementSibling(el) {
  let current = el?.previousSibling || null;

  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && current.namespaceURI === TEI_NS) {
      return current;
    }

    current = current.previousSibling;
  }

  return null;
}

function isChoiceEmendationNoteType(noteEl) {
  if (!noteEl || noteEl.localName !== 'note') return false;

  const rawType = String(noteEl.getAttribute('type') || '').trim().toLowerCase();
  const compactType = rawType.replace(/[\s_-]+/g, '');

  return (
    compactType === 'emendation' ||
    compactType === 'emendatio' ||
    compactType === 'emendamento' ||
    compactType === 'editorialemendation' ||
    compactType === 'notaemendazione' ||
    compactType.includes('emend')
  );
}

function isChoiceEmendationNote(noteEl) {
  if (!isChoiceEmendationNoteType(noteEl)) return false;

  const parent = noteEl.parentElement;
  if (parent?.namespaceURI === TEI_NS && parent.localName === 'choice') {
    return true;
  }

  const previous = getPreviousTEIElementSibling(noteEl);
  return previous?.namespaceURI === TEI_NS && previous.localName === 'choice';
}

function getChoiceEmendationNote(choiceEl) {
  if (!choiceEl) return null;

  const directNote = [...choiceEl.childNodes].find(child =>
    child.nodeType === Node.ELEMENT_NODE &&
    child.namespaceURI === TEI_NS &&
    child.localName === 'note' &&
    isChoiceEmendationNoteType(child)
  );

  if (directNote) return directNote;

  const next = getNextTEIElementSibling(choiceEl);
  if (next?.localName === 'note' && isChoiceEmendationNoteType(next)) {
    return next;
  }

  return null;
}

function renderChoiceNoteContent(noteEl, mode = 'line', anchorTarget = '') {
  if (!noteEl) return '';

  if (mode === 'commentary') return renderCommentaryChildren(noteEl).trim();
  if (mode === 'marginalia') return renderMarginaliaChildren(noteEl, anchorTarget).trim();

  return renderLineContent(noteEl).trim();
}

/* ==========================================================================
   Parse Commedia
   ========================================================================== */
function parseCommedia(doc) {
  return qsaTEI(doc, 'div')
    .filter(d => d.getAttribute('type') === 'canto')
    .map(cantoDiv => {
      const n = parseInt(cantoDiv.getAttribute('n'));
      const headEl = getDirectTEIChild(cantoDiv, 'head');
      const canticaDiv = getAncestorTEIDivByType(cantoDiv, 'cantica');
      const canticaHeadEl = getDirectTEIChild(canticaDiv, 'head');
      const cantoExplicitEl = getDirectTEIChild(cantoDiv, 'explicit');
      const canticaExplicitEl = isLastCantoInCantica(cantoDiv, canticaDiv)
        ? getDirectTEIChild(canticaDiv, 'explicit')
        : null;
      const explicitEl = cantoExplicitEl || canticaExplicitEl;

      const heading = headEl
        ? headEl.textContent.trim()
        : `Canto ${toRoman(n)}`;

      const headingHtml = headEl
        ? renderLineContent(headEl).trim()
        : escapeHTML(`Canto ${toRoman(n)}`);

      const canticaTitle = canticaHeadEl?.textContent.trim() || '';
      const canticaTitleHtml = canticaHeadEl
        ? renderLineContent(canticaHeadEl).trim()
        : '';

      const explicitText = explicitEl?.textContent.trim() || '';
      const explicitHtml = explicitEl
        ? renderLineContent(explicitEl).trim()
        : '';

      const elements = [];
      walkCantoChildren(cantoDiv, elements);

      return {
        n,
        xmlId: getAttr(cantoDiv, 'xml:id'),
        heading,
        headingHtml,
        canticaTitle,
        canticaTitleHtml,
        explicitText,
        explicitHtml,
        elements
      };
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
        return {
          xmlId,
          lineNum: extractLineNum(xmlId),
          html: renderLineContent(child),
          sourceEl: child
        };
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
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(el), 'line');

        return `<span class="choice-reg choice-corr"
                      data-tooltip="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(type)}"
                      data-choice-original-label="Lezione del manoscritto (sic)"
                      data-choice-edited-label="Correzione editoriale (corr)"
                      data-choice-edited="${escapeAttr(corrContent)}"
                      data-choice-note="${escapeAttr(noteContent)}"
                      title="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(type)}">${corrContent}</span><span class="choice-orig choice-sic"
                      title="Apparato (sic)">${sicContent}</span>`;
      }
      if (orig && reg) {
        const origContent = renderLineContent(orig);
        const regContent = renderLineContent(reg);
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(el), 'line');

        return `<span class="choice-reg"
                      data-tooltip="orig.: ${escapeAttr(stripHTML(origContent))}"
                      data-choice-original-label="Lezione attestata nel manoscritto (orig)"
                      data-choice-edited-label="Lezione emendata (reg)"
                      data-choice-edited="${escapeAttr(regContent)}"
                      data-choice-note="${escapeAttr(noteContent)}"
                      title="orig.: ${escapeAttr(stripHTML(origContent))}">${regContent}</span><span class="choice-orig"
                      title="Apparato (orig)">${origContent}</span>`;
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
    case 'note':
      if (isChoiceEmendationNote(el)) return '';
      return renderLineContent(el);
    case 'pb':
    case 'cb': return '';

    default: return renderLineContent(el);
  }
}

/* --- HTML Security --- */
const escapeHTML = str => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '’');
const escapeAttr = str => String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripHTML = html => Object.assign(document.createElement('div'), { innerHTML: html }).textContent || '';

/* ==========================================================================
   Parse Commentary
   ========================================================================== */
function parseCommentary(doc) {
  const commentary = {};
  const normCol = c => c?.toUpperCase() === 'B' ? 'B' : 'A';

  qsaTEI(doc, 'div')
    .filter(d => d.getAttribute('type') === 'commentary' && d.getAttribute('n'))
    .forEach(topDiv => {
      const cantoN = parseInt(topDiv.getAttribute('n'), 10);
      commentary[cantoN] = commentary[cantoN] || [];

      let currentFolio = null;
      let currentColumn = 'A';

      const walk = node => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.namespaceURI === TEI_NS && node.localName === 'pb') {
          currentFolio = node.getAttribute('n') || currentFolio;
          currentColumn = 'A';
          return;
        }

        if (node.namespaceURI === TEI_NS && node.localName === 'cb') {
          currentColumn = normCol(node.getAttribute('n'));
          return;
        }

        if (
          node !== topDiv &&
          node.namespaceURI === TEI_NS &&
          node.localName === 'div' &&
          node.getAttribute('type') === 'commentary'
        ) {
          const entry = parseCommentaryEntry(node, getAttr(node, 'xml:id'), {
            cantoN,
            folio: currentFolio,
            column: currentColumn
          });

          if (entry) {
            commentary[cantoN].push(entry);
            if (entry.lastFolio) currentFolio = entry.lastFolio;
            if (entry.lastColumn) currentColumn = normalizeCommentaryColumn(entry.lastColumn);
          }
          return;
        }

        node.childNodes.forEach(walk);
      };

      topDiv.childNodes.forEach(walk);
    });

  return commentary;
}

function normalizeCommentaryColumn(value) {
  const raw = String(value || '').trim().toUpperCase();
  return raw === 'B' ? 'B' : 'A';
}

function collectCommentaryLocations(pEl, initialLocation = {}) {
  const locations = [];
  const current = {
    folio: initialLocation.folio || '',
    column: normalizeCommentaryColumn(initialLocation.column || 'A')
  };

  const pushLocation = () => {
    if (!current.folio) return;

    const key = `${current.folio}|${current.column}`;
    if (!locations.some(loc => `${loc.folio}|${loc.column}` === key)) {
      locations.push({ folio: current.folio, column: current.column });
    }
  };

  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) pushLocation();
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.namespaceURI === TEI_NS && node.localName === 'pb') {
      current.folio = node.getAttribute('n') || current.folio;
      current.column = 'A';
      pushLocation();
      return;
    }

    if (node.namespaceURI === TEI_NS && node.localName === 'cb') {
      current.column = normalizeCommentaryColumn(node.getAttribute('n'));
      pushLocation();
      return;
    }

    node.childNodes.forEach(walk);
  };

  let skippedFirstRef = false;
  [...pEl.childNodes].forEach(child => {
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      child.namespaceURI === TEI_NS &&
      child.localName === 'ref' &&
      child.getAttribute('target') &&
      !skippedFirstRef
    ) {
      skippedFirstRef = true;
      return;
    }

    walk(child);
  });

  return locations;
}

function parseCommentaryEntry(div, xmlId, location = {}) {
  state.noteCounter = 0;
  const pEl = qsTEI(div, 'p');
  if (!pEl) return null;

  let lemmaText = '', lemmaHtml = '', lineRef = '', refLabel = '';
  const firstRef = qsTEI(div, 'ref');

  if (firstRef) {
    lineRef = firstRef.getAttribute('target')?.replace('#', '') || '';

    const quoteEl = qsTEI(firstRef, 'quote');
    const emphEl = qsTEI(firstRef, 'emph');
    const lemmaEl = quoteEl || emphEl || firstRef;

    lemmaText = lemmaEl.textContent.trim();
    lemmaHtml = renderCommentaryChildren(lemmaEl).trim();
  }

  if (lineRef) {
    const parts = lineRef.split('.');
    if (parts.length >= 3) refLabel = `Inf. ${toRoman(parseInt(parts[1]))}, ${parseInt(parts[2])}`;
  }

  const locations = collectCommentaryLocations(pEl, location);
  const primaryLocation = locations[0] || location || {};
  const lastLocation = locations[locations.length - 1] || primaryLocation || {};
  const folios = unique(locations.map(loc => loc.folio));

  return {
    xmlId,
    lineRef,
    refLabel,
    lemmaText,
    lemmaHtml,
    bodyHtml: renderCommentaryBody(pEl, location),
    cantoN: location.cantoN,
    folio: primaryLocation.folio || location.folio || '',
    column: primaryLocation.column || location.column || '',
    folios,
    locations,
    lastFolio: lastLocation.folio || location.folio || '',
    lastColumn: lastLocation.column || location.column || ''
  };
}

function renderCommentaryBody(pEl, initialLocation = {}) {
  state.noteCounter = 0;
  let skippedFirstRef = false;
  const context = {
    folio: initialLocation.folio || '',
    column: normalizeCommentaryColumn(initialLocation.column || 'A')
  };

  return [...pEl.childNodes].reduce((html, child) => {
    if (child.nodeType === Node.ELEMENT_NODE && child.localName === 'ref' && child.getAttribute('target') && !skippedFirstRef) {
      skippedFirstRef = true;
      return html;
    }
    return html + renderCommentaryNode(child, context);
  }, '').replace(/^\s*\.\s*/, '').trim();
}

function renderCommentaryNode(node, context = { folio: '', column: 'A' }) {
  if (node.nodeType === Node.TEXT_NODE) return escapeHTML(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const name = node.localName;

  switch (name) {
    case 'ref':
      if (node.getAttribute('target')) {
        const quoteEl = qsTEI(node, 'quote');
        const emphEl = qsTEI(node, 'emph');

        if (quoteEl) return `<em class="mentioned">${renderCommentaryChildren(quoteEl, context)}</em>`;
        if (emphEl) return `<em class="mentioned">${renderCommentaryChildren(emphEl, context)}</em>`;
      }
      return renderCommentaryChildren(node, context);

    case 'emph':
    case 'mentioned':
      return `<em class="mentioned">${renderCommentaryChildren(node, context)}</em>`;

    case 'quote':
      return node.parentNode?.localName === 'cit'
        ? `<span class="block-quote">${renderCommentaryChildren(node, context)}</span>`
        : `«${renderCommentaryChildren(node, context)}»`;

    case 'cit': return renderCommentaryChildren(node, context);

    case 'note':
      if (isChoiceEmendationNote(node)) return '';

      const type = node.getAttribute('type');
      if (['philological-note', 'bibliographical-ref', 'philological-commentary', 'emendation'].includes(type)) {
        state.noteCounter++;
        const label = type === 'bibliographical-ref'
          ? 'Rif. bibliografico'
          : type === 'emendation'
            ? 'Nota editoriale'
            : 'Nota filologica';
        return `<span class="note-indicator" data-note-id="note-${Date.now()}-${state.noteCounter}" data-note-title="${label}" data-note-content="${escapeHTML(node.textContent.trim()).replace(/"/g, '&quot;')}" title="${label}">${state.noteCounter}</span>`;
      }
      return renderCommentaryChildren(node, context);

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
      return renderCommentaryChildren(qsTEI(node, 'lem') || node, context);

    case 'choice': {
      const sic = qsTEI(node, 'sic');
      const corr = qsTEI(node, 'corr');
      const orig = qsTEI(node, 'orig');
      const reg = qsTEI(node, 'reg');

      if (sic && corr) {
        const cType = node.getAttribute('type') || 'correzione editoriale';
        const sicContent = renderCommentaryChildren(sic, context);
        const corrContent = renderCommentaryChildren(corr, context);
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(node), 'commentary');

        return `<span class="choice-reg choice-corr"
                      data-tooltip="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(cType)}"
                      data-choice-original-label="Lezione del manoscritto (sic)"
                      data-choice-edited-label="Correzione editoriale (corr)"
                      data-choice-edited="${escapeAttr(corrContent)}"
                      data-choice-note="${escapeAttr(noteContent)}">${corrContent}</span><span class="choice-orig choice-sic"
                      title="Apparato (sic)">${sicContent}</span>`;
      }
      if (orig && reg) {
        const origContent = renderCommentaryChildren(orig, context);
        const regContent = renderCommentaryChildren(reg, context);
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(node), 'commentary');

        return `<span class="choice-reg"
                      data-tooltip="${escapeAttr(stripHTML(origContent))}"
                      data-choice-original-label="Lezione attestata nel manoscritto (orig)"
                      data-choice-edited-label="Lezione emendata (reg)"
                      data-choice-edited="${escapeAttr(regContent)}"
                      data-choice-note="${escapeAttr(noteContent)}">${regContent}</span><span class="choice-orig"
                      title="Apparato (orig)">${origContent}</span>`;
      }
      return renderCommentaryChildren(corr || reg || sic || orig || node, context);
    }

    case 'g': {
      const refAttr = node.getAttribute('ref');
      if (refAttr === '#middle_dot') return GLYPHS.MIDDLE_DOT;
      if (refAttr === '#piedimosca') return `<span class="piedimosca">${GLYPHS.PIEDIMOSCA}</span>`;
      return node.textContent;
    }

    case 'subst': {
      const delSub = qsTEI(node, 'del'), addSub = qsTEI(node, 'add');
      return `${delSub ? `<span class="scribal-del">${escapeHTML(delSub.textContent)}</span>` : ''}${addSub ? `<span class="scribal-add">${escapeHTML(addSub.textContent)}</span>` : ''}`;
    }

    case 'del': return `<span class="scribal-del">${renderCommentaryChildren(node, context)}</span>`;
    case 'add': return `<span class="scribal-add">${escapeHTML(node.textContent)}</span>`;
    case 'supplied': return `[${renderCommentaryChildren(node, context)}]`;

    case 'pb': {
      const folio = node.getAttribute('n') || context.folio || '';
      context.folio = folio;
      context.column = 'A';
      return folio
        ? `<span class="commentary-folio-marker" data-folio="${escapeAttr(folio)}" data-column="A">c. ${escapeHTML(folio)}</span>`
        : '';
    }

    case 'cb': {
      const column = normalizeCommentaryColumn(node.getAttribute('n'));
      context.column = column;
      return `<span class="commentary-column-marker" data-column="${escapeAttr(column)}">col. ${escapeHTML(column)}</span>`;
    }

    default: return renderCommentaryChildren(node, context);
  }
}

function renderCommentaryChildren(node, context = { folio: '', column: 'A' }) {
  return [...node.childNodes].reduce((html, child) => html + renderCommentaryNode(child, context), '');
}

function parseTargets(value) {
  return (value || '')
    .trim()
    .split(/\s+/)
    .map(target => target.replace(/^#/, ''))
    .filter(Boolean);
}

function getCantoNumberFromLineId(lineId) {
  const match = /^Inf\.(\d+)\.\d+/.exec(lineId || '');
  return match ? parseInt(match[1], 10) : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}


function normalizeMarginaliaTypeValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const compact = raw.replace(/[\s_-]+/g, '');

  if (compact === 'nonverbal' || compact === 'nonverbale') return 'non_verbal';
  if (compact === 'verbal' || compact === 'verbale') return 'verbal';

  return null;
}

function detectMarginaliaType(note) {
  const directType = normalizeMarginaliaTypeValue(note.getAttribute('type'));
  if (directType) return directType;

  const extraSignals = [
    note.getAttribute('subtype'),
    note.getAttribute('ana'),
    note.getAttribute('rend'),
    note.getAttribute('class')
  ].filter(Boolean).join(' ').toLowerCase();

  if (/non[\s_-]*verbal(e)?/.test(extraSignals)) return 'non_verbal';
  if (/capitulum|piedimosca|pilcrow|paragraph|paragrafo/.test(extraSignals)) return 'non_verbal';

  const hasNonVerbalGlyph = qsaTEI(note, 'g').some(g => {
    const ref = (g.getAttribute('ref') || '').toLowerCase();
    const text = (g.textContent || '').toLowerCase();
    return /piedimosca|capitulum|pilcrow|paragraph|paragrafo/.test(ref + ' ' + text);
  });

  return hasNonVerbalGlyph ? 'non_verbal' : 'verbal';
}

function isNestedNoteWithin(note, rootDiv) {
  let parent = note.parentElement;

  while (parent && parent !== rootDiv) {
    if (parent.localName === 'note') return true;
    parent = parent.parentElement;
  }

  return false;
}

function pickAnchorTarget(targets, cantoN) {
  return (
    targets.find(target => getCantoNumberFromLineId(target) === cantoN) ||
    targets[0] ||
    ''
  );
}


/* ==========================================================================
   Parse Marginalia
   ========================================================================== */
/* ==========================================================================
   Parse Marginalia
   ========================================================================== */

function parseMarginalia(doc) {
  const marginalia = {};
  state.marginNotes = {};

  const pushMarginalia = (lineId, item) => {
    if (!lineId) return;

    marginalia[lineId] = marginalia[lineId] || [];

    const itemKey = item.id || item.xmlId || `${item.type}|${item.content}|${item.place}`;

    if (!marginalia[lineId].some(e => {
      const existingKey = e.id || e.xmlId || `${e.type}|${e.content}|${e.place}`;
      return existingKey === itemKey;
    })) {
      marginalia[lineId].push(item);
    }
  };

  qsaTEI(doc, 'div')
    .filter(d => d.getAttribute('type') === 'canto')
    .forEach(cantoDiv => {
      const cantoN = parseInt(cantoDiv.getAttribute('n'), 10);

      qsaTEI(cantoDiv, 'note')
        .filter(note => !isNestedNoteWithin(note, cantoDiv))
        .forEach(note => {
          const place = note.getAttribute('place') || getParentPlace(note);
          // Il tipo dei marginalia può comparire come non_verbal, non-verbal, non verbal,
          // nonVerbale ecc.: normalizzo prima di decidere quale icona mostrare.

          const directTargets = parseTargets(note.getAttribute('target'));

          const refTargets = qsaTEI(note, 'ref')
            .flatMap(ref => parseTargets(ref.getAttribute('target')));

          const childNoteTargets = qsaTEI(note, 'note')
            .flatMap(childNote => parseTargets(childNote.getAttribute('target')));

          const allTargets = unique([
            ...directTargets,
            ...refTargets,
            ...childNoteTargets
          ]);

          const anchorTarget = pickAnchorTarget(allTargets, cantoN);

          if (!anchorTarget) return;

          const xmlId =
            getAttr(note, 'xml:id') ||
            `margin-${cantoN}-${anchorTarget}-${Object.keys(state.marginNotes).length + 1}`;

          const id = xmlId;

          const type = detectMarginaliaType(note);

          const item = {
            id,
            xmlId,
            type,
            content: note.textContent.trim(),
            contentHtml: renderMarginaliaBody(note, anchorTarget),
            place: place || '',
            targets: allTargets,
            anchorTarget
          };

          state.marginNotes[id] = item;

          pushMarginalia(anchorTarget, item);
        });
    });

  return marginalia;
}

function renderMarginaliaBody(el, anchorTarget = '') {
  return [...el.childNodes]
    .reduce((html, child) => html + renderMarginaliaNode(child, anchorTarget), '')
    .trim();
}

function renderMarginaliaChildren(node, anchorTarget = '') {
  return [...node.childNodes]
    .reduce((html, child) => html + renderMarginaliaNode(child, anchorTarget), '');
}

function renderMarginaliaNode(node, anchorTarget = '') {
  if (node.nodeType === Node.TEXT_NODE) return escapeHTML(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const name = node.localName;

  switch (name) {
    case 'ref': {
      const content = renderMarginaliaChildren(node, anchorTarget);

      const targets = parseTargets(node.getAttribute('target'))
        .filter(isLineTarget);

      /*
        Regola:
        - se il ref punta solo al luogo materiale della nota, non faccio nulla;
        - se il ref contiene anche altri luoghi, mostro solo il/i rimando/i diversi;
        - non trasformo tutto il testo in bottone.
      */
      const crossTargets = targets.filter(target => target !== anchorTarget);

      if (!crossTargets.length) {
        return content;
      }

      const links = crossTargets.map(target => `
        <button type="button"
                class="tei-ref-jump"
                data-target="${escapeAttr(target)}"
                title="Vai a ${escapeAttr(formatLineRef(target))}">
          ↗ ${escapeHTML(formatLineRef(target))}
        </button>
      `).join('');

      return `${content} ${links}`;
    }

    case 'emph':
    case 'mentioned':
      return `<em class="mentioned">${renderMarginaliaChildren(node, anchorTarget)}</em>`;

    case 'quote':
      return `«${renderMarginaliaChildren(node, anchorTarget)}»`;

    case 'note': {
      if (isChoiceEmendationNote(node)) return '';

      state.noteCounter++;

      const label = noteTypeLabel(node.getAttribute('type'));
      const content = renderMarginaliaChildren(node, anchorTarget);

      return `<span class="note-indicator"
                    data-note-id="margin-note-${Date.now()}-${state.noteCounter}"
                    data-note-title="${escapeAttr(label)}"
                    data-note-content="${escapeAttr(content)}"
                    title="${escapeAttr(label)}">${state.noteCounter}</span>`;
    }

    case 'app': {
      if (node.getAttribute('type') === 'philological') {
        const lem = qsTEI(node, 'lem');
        const rdg = qsTEI(node, 'rdg');

        if (lem && rdg) {
          state.noteCounter++;

          const content = `Lem.: ${renderMarginaliaChildren(lem, anchorTarget)} | Var.: ${renderMarginaliaChildren(rdg, anchorTarget)}`;

          return `${renderMarginaliaChildren(lem, anchorTarget)}<span class="note-indicator app-indicator"
                    data-note-id="margin-app-${Date.now()}-${state.noteCounter}"
                    data-note-title="Apparato"
                    data-note-content="${escapeAttr(content)}"
                    title="Apparato filologico">🔍</span>`;
        }
      }

      return renderMarginaliaChildren(qsTEI(node, 'lem') || node, anchorTarget);
    }

    case 'choice': {
      const sic = qsTEI(node, 'sic');
      const corr = qsTEI(node, 'corr');
      const orig = qsTEI(node, 'orig');
      const reg = qsTEI(node, 'reg');

      if (sic && corr) {
        const cType = node.getAttribute('type') || 'correzione editoriale';
        const sicContent = renderMarginaliaChildren(sic, anchorTarget);
        const corrContent = renderMarginaliaChildren(corr, anchorTarget);
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(node), 'marginalia', anchorTarget);

        return `<span class="choice-reg choice-corr"
                      data-tooltip="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(cType)}"
                      data-choice-original-label="Lezione del manoscritto (sic)"
                      data-choice-edited-label="Correzione editoriale (corr)"
                      data-choice-edited="${escapeAttr(corrContent)}"
                      data-choice-note="${escapeAttr(noteContent)}"
                      title="${escapeAttr(stripHTML(sicContent))} — ${escapeAttr(cType)}">${corrContent}</span><span class="choice-orig choice-sic"
                      title="Apparato (sic)">${sicContent}</span>`;
      }

      if (orig && reg) {
        const origContent = renderMarginaliaChildren(orig, anchorTarget);
        const regContent = renderMarginaliaChildren(reg, anchorTarget);
        const noteContent = renderChoiceNoteContent(getChoiceEmendationNote(node), 'marginalia', anchorTarget);

        return `<span class="choice-reg"
                      data-tooltip="orig.: ${escapeAttr(stripHTML(origContent))}"
                      data-choice-original-label="Lezione attestata nel manoscritto (orig)"
                      data-choice-edited-label="Lezione emendata (reg)"
                      data-choice-edited="${escapeAttr(regContent)}"
                      data-choice-note="${escapeAttr(noteContent)}"
                      title="orig.: ${escapeAttr(stripHTML(origContent))}">${regContent}</span><span class="choice-orig"
                      title="Apparato (orig)">${origContent}</span>`;
      }

      return renderMarginaliaChildren(corr || reg || sic || orig || node, anchorTarget);
    }

    case 'g': {
      const refAttr = node.getAttribute('ref');

      if (refAttr === '#middle_dot') return GLYPHS.MIDDLE_DOT;
      if (refAttr === '#piedimosca') return `<span class="piedimosca">${GLYPHS.PIEDIMOSCA}</span>`;

      return escapeHTML(node.textContent);
    }

    case 'subst': {
      const delSub = qsTEI(node, 'del');
      const addSub = qsTEI(node, 'add');

      return `${delSub ? `<span class="scribal-del">${renderMarginaliaChildren(delSub, anchorTarget)}</span>` : ''}${addSub ? `<span class="scribal-add">${renderMarginaliaChildren(addSub, anchorTarget)}</span>` : ''}`;
    }

    case 'del':
      return `<span class="scribal-del">${renderMarginaliaChildren(node, anchorTarget)}</span>`;

    case 'add':
      return `<span class="scribal-add">${renderMarginaliaChildren(node, anchorTarget)}</span>`;

    case 'supplied':
      return `[${renderMarginaliaChildren(node, anchorTarget)}]`;

    case 'lb':
      return '<br>';

    case 'pb':
    case 'cb':
      return '';

    default:
      return renderMarginaliaChildren(node, anchorTarget);
  }
}

function noteTypeLabel(type) {
  const labels = {
    'philological-note': 'Nota filologica',
    'bibliographical-ref': 'Rif. bibliografico',
    'philological-commentary': 'Nota filologica',
    'editorial': 'Nota editoriale',
    'emendation': 'Nota editoriale',
    'editorial-emendation': 'Nota editoriale',
    'translation': 'Nota di traduzione',
    'source': 'Fonte'
  };

  return labels[type] || 'Nota';
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

function isNestedNoteWithin(note, rootDiv) {
  let parent = note.parentElement;

  while (parent && parent !== rootDiv) {
    if (parent.localName === 'note') return true;
    parent = parent.parentElement;
  }

  return false;
}

function isLineTarget(target) {
  return /^Inf\.\d+\.\d+$/.test(target || '');
}

function formatLineRef(lineId) {
  const match = /^Inf\.(\d+)\.(\d+)$/.exec(lineId || '');

  if (!match) return lineId || '';

  const canto = parseInt(match[1], 10);
  const line = parseInt(match[2], 10);

  return `Inf. ${toRoman(canto)}, ${line}`;
}

function goToLine(lineId) {
  const cantoN = getCantoNumberFromLineId(lineId);

  if (!cantoN) return;

  hideNotePopup();
  hideMarginTooltip();

  state.currentCanto = cantoN;
  els.cantoSelect.value = cantoN;

  setCurrentView('facsimile');

  renderFacsimileView();

  setTimeout(() => {
    highlightVerse(lineId, true);
    highlightCompleteCommentary(lineId, true);
    setFolioFromLine(lineId);
  }, 120);
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
  let comPb = null, comCb = 'A', insideCommentary = false;

  const markCommentaryContent = () => {
    if (!comPb) return;

    ensureFolio(comPb);
    map[comPb][normCol(comCb)].commento = true;
  };

  const walkCommentoNode = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (insideCommentary && node.textContent.trim()) markCommentaryContent();
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    if (node.localName === 'pb') {
      comPb = node.getAttribute('n') || comPb;
      comCb = 'A';
      return;
    }

    if (node.localName === 'cb') {
      comCb = normCol(node.getAttribute('n'));
      return;
    }

    const wasInside = insideCommentary;
    if (node.localName === 'div' && node.getAttribute('type') === 'commentary') {
      insideCommentary = true;
      markCommentaryContent();
    }

    node.childNodes.forEach(walkCommentoNode);
    insideCommentary = wasInside;
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
  renderCompleteCommentoPanel(FOLIO_ORDER[state.currentFolioIdx]);
  updateFacsimile();
}

function renderTextForCanto(canto) {
  els.textPanelTitle.textContent = `Testo poetico — Canto ${toRoman(canto.n)}`;

  const paratextHtml = (canto.canticaTitleHtml || canto.explicitHtml)
    ? `<div class="canto-paratext-row">${canto.canticaTitleHtml ? `<div class="cantica-title">${canto.canticaTitleHtml}</div>` : '<div></div>'}${canto.explicitHtml ? `<div class="cantica-explicit">${canto.explicitHtml}</div>` : ''}</div>`
    : '';

  let html = `${paratextHtml}<div class="canto-heading">${canto.headingHtml || escapeHTML(canto.heading)}</div>` + canto.elements.reduce((html, el) => {
    if (el.type === 'pb') return html + `<div class="folio-marker" data-folio="${el.n}" title="Vai al facsimile della carta ${el.n}">[c. ${el.n}]</div>`;
    if (el.type === 'cb') return html + `<span class="column-marker">col. ${el.n}</span>`;
    if (el.type === 'terzina') return html + renderTerzina(el);
    return html;
  }, '');

  html += `
    <div class="end-of-canto-actions" style="margin-top: 50px; padding: 30px 0; border-top: 1px solid var(--border-light); text-align: center;">
      <button id="goToCommentaryBtn" class="icon-btn" style="width: auto; padding: 12px 24px; background: var(--bg-surface); color: var(--accent); border: 1px solid var(--border); font-family: var(--font-sans); font-weight: 500; font-size: 0.9rem; display: inline-flex; align-items: center; gap: 8px;">
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
      highlightVerse(line.dataset.lineId, false);
      highlightCompleteCommentary(line.dataset.lineId, true);
      setFolioFromLine(line.dataset.lineId);
    }
    const btnCommentary = e.target.closest('#goToCommentaryBtn');
    if (btnCommentary) {
      setCurrentView('commento');
      els.commentoContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  els.textContent.querySelectorAll('.margin-indicator').forEach(ind => {
    ind.onmouseenter = e => showMarginTooltip(e, ind);
    ind.onmouseleave = hideMarginTooltip;
    ind.onclick = e => {
      e.stopPropagation();
      hideMarginTooltip();
      showMarginNotePopup(e, ind);
    };
  });

  bindNoteIndicators(els.textContent);
}

function renderTerzina(el) {
  return '<div class="terzina">' + el.lines.map(line => {
    const margins = (state.marginalia[line.xmlId] || []).map(m =>
      m.type === 'non_verbal'
        ? `<span class="margin-indicator nonverbal" data-margin-id="${escapeAttr(m.id)}" data-margin-type="non_verbal" data-margin-content="${escapeAttr(m.content.trim() || '⁋ capitulum')}" data-margin-place="${escapeAttr(m.place || '')}">⁋</span>`
        : `<span class="margin-indicator" data-margin-id="${escapeAttr(m.id)}" data-margin-type="verbal" data-margin-content="${escapeAttr(m.content)}" data-margin-place="${escapeAttr(m.place || '')}">m</span>`
    ).join('');

    return `<div class="verse-line" data-line-id="${line.xmlId}"><span class="line-number">${line.lineNum}</span><span class="verse-text">${line.html}</span>${margins}</div>`;
  }).join('') + '</div>';
}

function bindNoteIndicators(container) {
  // Gestione note standard
  container?.querySelectorAll('.note-indicator').forEach(ind => {
    ind.onclick = e => {
      e.stopPropagation();
      showNotePopup(e, ind);
    };
  });

  // Gestione link incrociati
  container?.querySelectorAll('.tei-ref-jump').forEach(link => {
    link.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      const target = link.dataset.target;
      if (target) goToLine(target);
    };
  });

  // Gestione click sui Choice (orig/reg · sic/corr)
  container?.querySelectorAll('.choice-reg').forEach(choice => {
    choice.onclick = e => {
      e.stopPropagation();

      const origNode = choice.nextElementSibling;
      const originalHtml = origNode ? origNode.innerHTML : 'Variante non disponibile';
      const editedHtml = choice.dataset.choiceEdited || choice.innerHTML;
      const noteHtml = choice.dataset.choiceNote || '';

      const isCorr = choice.classList.contains('choice-corr');
      const originalLabel = choice.dataset.choiceOriginalLabel || (isCorr ? 'Lezione del manoscritto (sic)' : 'Lezione attestata nel manoscritto (orig)');
      const editedLabel = choice.dataset.choiceEditedLabel || (isCorr ? 'Correzione editoriale (corr)' : 'Lezione regolarizzata (reg)');

      const body = els.notePopup.querySelector('.note-popup-body');
      els.notePopup.style.width = 'min(520px, calc(100vw - 32px))';
      els.notePopup.querySelector('.note-popup-title').textContent = originalLabel;

      body.innerHTML = `
        <div class="choice-popup-section" style="padding: 12px 0 16px;">
          <div class="choice-popup-label" style="font-family: var(--font-sans); font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
            ${escapeHTML(editedLabel)}
          </div>
          <div class="choice-popup-form" style="font-family: serif; font-size: 1.25rem; line-height: 1.5; text-align: center;">
            ${editedHtml}
          </div>
        </div>

        <div class="choice-popup-section" style="padding: 14px 0 16px; border-top: 1px solid var(--border-light);">
          <div class="choice-popup-label" style="font-family: var(--font-sans); font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
            ${escapeHTML(originalLabel)}
          </div>
          <div class="choice-popup-form" style="font-family: serif; font-size: 1.25rem; line-height: 1.5; text-align: center;">
            ${originalHtml}
          </div>
        </div>

        ${noteHtml ? `
          <div class="choice-popup-note" style="padding: 14px 0 2px; border-top: 1px solid var(--border-light);">
            <div class="choice-popup-label" style="font-family: var(--font-sans); font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">
              Nota editoriale
            </div>
            <div style="font-family: var(--font-serif); font-size: .98rem; line-height: 1.55;">
              ${noteHtml}
            </div>
          </div>
        ` : ''}
      `;

      els.notePopup.classList.add('visible');
      positionNotePopup(choice, 520);
      bindNoteIndicators(body);
    };
  });
}


function getEntryFolios(entry) {
  return (entry?.dataset?.folios || entry?.folios?.join(' ') || entry?.folio || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function entryHasFolio(entry, folioN) {
  if (!entry || !folioN) return false;
  return getEntryFolios(entry).includes(folioN);
}

function renderCommentaryEntries(entries, emptyMessage = 'Nessun commento disponibile.') {
  return entries.length === 0
    ? `<div class="empty-commentary-message">${escapeHTML(emptyMessage)}</div>`
    : entries.map(e => {
      const folios = e.folios?.length ? e.folios : (e.folio ? [e.folio] : []);
      const folioLabel = folios.length > 1 ? folios.join(', ') : (folios[0] || '');
      return `<div class="commentary-entry" data-line-ref="${escapeAttr(e.lineRef || '')}" data-folio="${escapeAttr(e.folio || '')}" data-folios="${escapeAttr(folios.join(' '))}" data-column="${escapeAttr(e.column || '')}"><div class="commentary-lemma">${e.refLabel ? `<span class="lemma-ref">${escapeHTML(e.refLabel)}</span>` : ''}${e.lemmaHtml ? `<span class="lemma-text">${e.lemmaHtml}</span>` : ''}${folioLabel ? `<span class="lemma-folio">c. ${escapeHTML(folioLabel)}</span>` : ''}</div><div class="commentary-body">${e.bodyHtml}</div></div>`;
    }).join('');
}

function getCommentaryEntriesForFolio(folioN) {
  const entries = [];

  Object.values(state.commentary).forEach(cantoEntries => {
    cantoEntries.forEach(entry => {
      const folios = entry.folios?.length ? entry.folios : (entry.folio ? [entry.folio] : []);
      if (folios.includes(folioN)) entries.push(entry);
    });
  });

  return entries;
}

function renderCommentoView() {
  const entries = state.commentary[state.currentCanto] || [];
  els.commentoPanelTitle.textContent = `Commento — Canto ${toRoman(state.currentCanto)}`;
  els.commentoContent.innerHTML = renderCommentaryEntries(entries);

  bindNoteIndicators(els.commentoContent);
}

function getCompleteCommentaryEntriesForCurrentCanto() {
  return state.commentary[state.currentCanto] || [];
}

function updateCompleteCommentoHeader(folioN = FOLIO_ORDER[state.currentFolioIdx]) {
  if (!els.completeCommentoPanelTitle) return;

  const entriesForFolio = getCommentaryEntriesForFolio(folioN)
    .filter(entry => !entry.cantoN || entry.cantoN === state.currentCanto);

  const cantoLabel = toRoman(state.currentCanto);
  const suffix = entriesForFolio.length
    ? ` · ${entriesForFolio.length} ${entriesForFolio.length === 1 ? 'voce' : 'voci'}`
    : ' · commento non presente';

  els.completeCommentoPanelTitle.textContent = `Commento — Canto ${cantoLabel} · c. ${folioN}${suffix}`;
}

function updateCompleteCommentoNotice(folioN = FOLIO_ORDER[state.currentFolioIdx]) {
  if (!els.completeCommentoContent) return;

  const notice = els.completeCommentoContent.querySelector('.empty-commentary-message');
  if (!notice) return;

  const entriesForFolio = getCommentaryEntriesForFolio(folioN)
    .filter(entry => !entry.cantoN || entry.cantoN === state.currentCanto);

  notice.hidden = entriesForFolio.length > 0;
  notice.textContent = `Commento non presente in questa carta.`;
}

function markCommentaryEntriesForFolio(folioN = FOLIO_ORDER[state.currentFolioIdx]) {
  if (!els.completeCommentoContent) return;

  els.completeCommentoContent.querySelectorAll('.commentary-entry').forEach(entry => {
    entry.classList.toggle('same-folio', entryHasFolio(entry, folioN));
  });
}

function renderCompleteCommentoPanel(folioN = FOLIO_ORDER[state.currentFolioIdx]) {
  if (!els.completeCommentoContent) return;

  const entries = getCompleteCommentaryEntriesForCurrentCanto();
  const listHtml = renderCommentaryEntries(entries);

  els.completeCommentoContent.innerHTML = `
    <div class="empty-commentary-message" hidden>Commento non presente in questa carta.</div>
    <div class="complete-commentary-list">${listHtml}</div>
  `;

  updateCompleteCommentoHeader(folioN);
  updateCompleteCommentoNotice(folioN);
  markCommentaryEntriesForFolio(folioN);
  highlightCompleteCommentaryForFolio(folioN, false);

  bindNoteIndicators(els.completeCommentoContent);

  els.completeCommentoContent.onclick = e => {
    if (e.target.closest('.note-indicator, .choice-reg, .tei-ref-jump')) return;

    const entry = e.target.closest('.commentary-entry');
    if (entry) {
      // Click sul commento = selezione, non cambio carta.
      // Evita l'effetto "mare mosso": il facsimile torna a cambiare solo con
      // scroll volontario del testo, scroll del commento o bottoni carta.
      state.isSyncingCommento = true;
      clearTimeout(state.commentoSyncTimeout);
      syncFromCommentaryEntry(entry, {
        scrollText: false,
        scrollCommento: false,
        updateFolio: false
      });
      state.commentoSyncTimeout = setTimeout(() => { state.isSyncingCommento = false; }, 450);
    }
  };
}

function getCurrentCommentaryLocationFromScroll() {
  if (!els.completeCommentoContent) return null;

  const anchors = Array.from(
    els.completeCommentoContent.querySelectorAll('.commentary-entry, .commentary-folio-marker')
  );

  if (!anchors.length) return null;

  const containerRect = els.completeCommentoContent.getBoundingClientRect();
  const offset = containerRect.top + Math.min(180, containerRect.height * 0.35);

  let current = anchors[0];

  for (const anchor of anchors) {
    const rect = anchor.getBoundingClientRect();
    if (rect.top <= offset) current = anchor;
    else break;
  }

  const entry = current.classList.contains('commentary-entry')
    ? current
    : current.closest('.commentary-entry');

  if (!entry) return null;

  const folio = current.dataset.folio || entry.dataset.folio || getEntryFolios(entry)[0] || '';
  return { entry, folio };
}

function syncFromCommentaryEntry(entry, options = {}) {
  if (!entry) return;

  const { scrollText = true, scrollCommento = false, folioOverride = '', updateFolio = true } = options;
  const lineRef = entry.dataset.lineRef;
  const folioN = folioOverride || entry.dataset.folio || getEntryFolios(entry)[0] || findFolioForLine(lineRef);
  const targetCanto = getCantoNumberFromLineId(lineRef);

  if (targetCanto && targetCanto !== state.currentCanto) {
    state.currentCanto = targetCanto;
    if (els.cantoSelect) els.cantoSelect.value = targetCanto;
    const canto = state.cantos.find(c => c.n === targetCanto);
    if (canto) {
      renderTextForCanto(canto);
      renderCompleteCommentoPanel(folioN || FOLIO_ORDER[state.currentFolioIdx]);
    }
  }

  if (folioN && updateFolio) {
    const idx = FOLIO_ORDER.indexOf(folioN);
    if (idx >= 0 && state.currentFolioIdx !== idx) {
      state.currentFolioIdx = idx;
      updateFacsimile(true);
    } else {
      updateCompleteCommentoHeader(folioN);
      updateCompleteCommentoNotice(folioN);
      markCommentaryEntriesForFolio(folioN);
    }
  }

  if (lineRef) {
    highlightCompleteCommentary(lineRef, scrollCommento);

    if (scrollText) {
      state.isSyncingText = true;
      clearTimeout(state.syncTimeout);
      highlightVerse(lineRef, true);
      state.syncTimeout = setTimeout(() => { state.isSyncingText = false; }, 650);
    } else {
      highlightVerse(lineRef, false);
    }
  }
}

function highlightVerse(lineId, shouldScroll = true) {
  if (!lineId || !els.textContent) return;

  const lineEl = Array.from(els.textContent.querySelectorAll('.verse-line')).find(line => line.dataset.lineId === lineId);
  if (!lineEl) return;

  els.textContent.querySelectorAll('.verse-line.active').forEach(l => l.classList.remove('active'));
  lineEl.classList.add('active');

  if (shouldScroll) {
    lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function highlightCompleteCommentary(lineId, shouldScroll = true) {
  if (!lineId || !els.completeCommentoContent) return;

  const entries = Array.from(els.completeCommentoContent.querySelectorAll('.commentary-entry'));
  const entry = entries.find(e => e.dataset.lineRef === lineId);

  entries.forEach(e => e.classList.remove('active'));

  if (!entry) return;

  entry.classList.add('active');

  if (shouldScroll) {
    state.isSyncingCommento = true;
    clearTimeout(state.commentoSyncTimeout);
    entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    state.commentoSyncTimeout = setTimeout(() => { state.isSyncingCommento = false; }, 650);
  }
}

function highlightCompleteCommentaryForFolio(folioN, shouldScroll = true) {
  if (!folioN || !els.completeCommentoContent) return;

  const entries = Array.from(els.completeCommentoContent.querySelectorAll('.commentary-entry'));
  const entry = entries.find(e => entryHasFolio(e, folioN));

  entries.forEach(e => e.classList.remove('active'));

  updateCompleteCommentoHeader(folioN);
  updateCompleteCommentoNotice(folioN);
  markCommentaryEntriesForFolio(folioN);

  if (!entry) return;

  entry.classList.add('active');

  if (shouldScroll) {
    state.isSyncingCommento = true;
    clearTimeout(state.commentoSyncTimeout);
    const marker = Array.from(entry.querySelectorAll('.commentary-folio-marker'))
      .find(m => m.dataset.folio === folioN);
    (marker || entry).scrollIntoView({ behavior: 'smooth', block: 'center' });
    state.commentoSyncTimeout = setTimeout(() => { state.isSyncingCommento = false; }, 650);
  }
}

function findFolioForLine(lineId) {
  let currentFolio = null;

  for (const canto of state.cantos) {
    for (const el of canto.elements) {
      if (el.type === 'pb') currentFolio = el.n;

      if (el.type === 'terzina') {
        for (const line of el.lines) {
          if (line.xmlId === lineId) return currentFolio;
        }
      }
    }
  }

  return null;
}

function setFolioFromLine(lineId) {
  const folioN = findFolioForLine(lineId);
  const idx = FOLIO_ORDER.indexOf(folioN);

  if (idx < 0) return;

  state.currentFolioIdx = idx;
  updateFacsimile(true);
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

  if (state.currentView === 'facsimile') {
    if (!state.isSyncingCommento) {
      renderCompleteCommentoPanel(folioN);
    } else {
      updateCompleteCommentoHeader(folioN);
      updateCompleteCommentoNotice(folioN);
      markCommentaryEntriesForFolio(folioN);
    }
  }

  if (!silent && state.currentView === 'facsimile') {
    syncTextWithFolio(folioN);
  } else if (silent) {
    els.textContent?.querySelectorAll('.folio-marker.active').forEach(m => m.classList.remove('active'));
    const marker = els.textContent?.querySelector(`.folio-marker[data-folio="${folioN}"]`);
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
  const body = els.notePopup.querySelector('.note-popup-body');

  els.notePopup.style.width = '380px';
  els.notePopup.querySelector('.note-popup-title').textContent = title;
  body.innerHTML = `<p>${content}</p>`;
  els.notePopup.classList.add('visible');

  positionNotePopup(indicator, 380);
  bindNoteIndicators(body);
}

function showMarginNotePopup(e, indicator) {
  const item = getMarginItem(indicator);
  const { marginPlace: place = '' } = indicator.dataset;
  const placeLabels = {
    'external_margin': 'Margine esterno',
    'internal_margin': 'Margine interno',
    'intercolumn': 'Intercolumnio',
    'inferior_margin': 'Margine inferiore'
  };

  const title = placeLabels[item?.place || place] || item?.place || place || 'Nota marginale';
  const body = els.notePopup.querySelector('.note-popup-body');

  els.notePopup.style.width = 'min(560px, calc(100vw - 32px))';
  els.notePopup.querySelector('.note-popup-title').textContent = title;
  body.innerHTML = item?.contentHtml || escapeHTML(indicator.dataset.marginContent || '');
  els.notePopup.classList.add('visible');

  positionNotePopup(indicator, 560);
  bindNoteIndicators(body);
}

function positionNotePopup(indicator, preferredWidth = 380) {
  const rect = indicator.getBoundingClientRect();
  const popupWidth = Math.min(preferredWidth, window.innerWidth - 32);
  const popupHeight = els.notePopup.offsetHeight || 320;

  els.notePopup.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - popupHeight - 8)}px`;
  els.notePopup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 16))}px`;
}

const hideNotePopup = () => els.notePopup.classList.remove('visible');

function getMarginItem(indicator) {
  const id = indicator.dataset.marginId;
  return id ? state.marginNotes[id] : null;
}

function showMarginTooltip(e, indicator) {
  const item = getMarginItem(indicator);
  const { marginContent: content, marginPlace: place = '' } = indicator.dataset;
  const placeLabels = {
    'external_margin': 'Margine esterno',
    'internal_margin': 'Margine interno',
    'intercolumn': 'Intercolumnio',
    'inferior_margin': 'Margine inferiore'
  };

  const title = item?.place || place;
  const bodyHtml = item?.contentHtml || escapeHTML(content || '');

  els.marginTooltip.innerHTML = `${title ? `<span class="margin-ref">${placeLabels[title] || title}</span>` : ''}${bodyHtml}`;
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
  const lowerQ = query.toLowerCase().replace(/'/g, '’');

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

  const lowerQ = query.toLowerCase().replace(/'/g, '’');
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
        setCurrentView('commento');
      } else {
        setCurrentView('facsimile');

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
  const normalizedQuery = query.toLowerCase().replace(/'/g, '’');
  const idx = text.toLowerCase().indexOf(normalizedQuery);
  if (idx < 0) return escapeHTML(text);

  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + normalizedQuery.length + 60);
  let excerpt = text.substring(start, end);
  if (start > 0) excerpt = '…' + excerpt;
  if (end < text.length) excerpt += '…';

  const matchIdx = excerpt.toLowerCase().indexOf(normalizedQuery);
  if (matchIdx >= 0) {
    return escapeHTML(excerpt.substring(0, matchIdx)) +
      `<mark>${escapeHTML(excerpt.substring(matchIdx, matchIdx + normalizedQuery.length))}</mark>` +
      escapeHTML(excerpt.substring(matchIdx + normalizedQuery.length));
  }
  return escapeHTML(excerpt);
}

function toRoman(n) {
  return [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    .reduce((res, [v, l]) => { while (n >= v) { res += l; n -= v; } return res; }, '');
}


function updateCompletePanelVisibility() {
  if (!els.viewFacsimile) return;

  els.viewFacsimile.classList.toggle('hide-text-panel', !state.showTextPanel);
  els.viewFacsimile.classList.toggle('hide-commento-panel', !state.showCommentoPanel);

  if (els.toggleTextPanel) {
    els.toggleTextPanel.classList.toggle('active', state.showTextPanel);
    els.toggleTextPanel.setAttribute('aria-pressed', String(state.showTextPanel));
  }

  if (els.toggleCommentoPanel) {
    els.toggleCommentoPanel.classList.toggle('active', state.showCommentoPanel);
    els.toggleCommentoPanel.setAttribute('aria-pressed', String(state.showCommentoPanel));
  }
}

function setCurrentView(view) {
  state.currentView = view;

  const viewMap = {
    home: els.viewHome,
    facsimile: els.viewFacsimile,
    commento: els.viewCommento,
    confronto: els.viewConfronto
  };

  Object.entries(viewMap).forEach(([key, el]) => {
    el?.classList.toggle('active', key === view);
  });

  $$('.view-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  if (view === 'facsimile') {
    renderFacsimileView();
    updateCompletePanelVisibility();
  } else if (view === 'commento') {
    renderCommentoView();
  } else if (view === 'confronto') {
    renderConfrontoView();
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function getLinesByIdFromCanto(canto) {
  const lines = new Map();
  if (!canto) return lines;

  canto.elements.forEach(el => {
    if (el.type === 'terzina') {
      el.lines.forEach(line => lines.set(line.xmlId, line));
    }
  });

  return lines;
}

function normalizeForComparison(html) {
  return stripHTML(html || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[·.,;:!?«»“”()\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapsePlainText(str) {
  return String(str || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getElementTextForComparison(node, mode = 'reg') {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  if (node.namespaceURI === TEI_NS) {
    switch (node.localName) {
      case 'choice': {
        const sic = qsTEI(node, 'sic');
        const corr = qsTEI(node, 'corr');
        const orig = qsTEI(node, 'orig');
        const reg = qsTEI(node, 'reg');

        const selected = mode === 'orig'
          ? (orig || sic || reg || corr)
          : (reg || corr || orig || sic);

        return selected
          ? getElementTextForComparison(selected, mode)
          : getChildTextForComparison(node, mode);
      }

      case 'g': {
        const ref = node.getAttribute('ref');
        if (ref === '#middle_dot') return GLYPHS.MIDDLE_DOT;
        if (ref === '#piedimosca') return GLYPHS.PIEDIMOSCA;
        return node.textContent || '';
      }

      case 'subst': {
        const delSub = qsTEI(node, 'del');
        const addSub = qsTEI(node, 'add');
        const selected = mode === 'orig'
          ? (delSub || addSub)
          : (addSub || delSub);
        return selected ? getElementTextForComparison(selected, mode) : '';
      }

      case 'del':
        return mode === 'orig' ? getChildTextForComparison(node, mode) : '';

      case 'add':
        return getChildTextForComparison(node, mode);

      case 'supplied':
        return getChildTextForComparison(node, mode);

      case 'note':
        return isChoiceEmendationNote(node) ? '' : getChildTextForComparison(node, mode);

      case 'pb':
      case 'cb':
        return '';

      default:
        return getChildTextForComparison(node, mode);
    }
  }

  return getChildTextForComparison(node, mode);
}

function getChildTextForComparison(node, mode = 'reg') {
  return [...(node?.childNodes || [])]
    .map(child => getElementTextForComparison(child, mode))
    .join('');
}

function getLineTextForComparison(line, mode = 'reg') {
  if (!line) return '';
  if (line.sourceEl) {
    return collapsePlainText(getElementTextForComparison(line.sourceEl, mode));
  }

  // Fallback per vecchie versioni già renderizzate in HTML: elimina la forma non attiva.
  const tmp = document.createElement('div');
  tmp.innerHTML = line.html || '';
  tmp.querySelectorAll(mode === 'orig' ? '.choice-reg' : '.choice-orig').forEach(el => el.remove());
  return collapsePlainText(tmp.textContent || '');
}

function getComparisonHarleyMode() {
  return state.showOrig ? 'orig' : 'reg';
}

function getComparisonHarleyModeLabel() {
  return state.showOrig ? 'Orig' : 'Reg';
}

/* ==========================================================================
   Confronto Harley / Petrocchi: tokenizzazione, allineamento e classificazione
   ========================================================================== */

function plainComparisonText(html) {
  return stripHTML(html || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeApostrophes(str) {
  return String(str || '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"');
}

function normalizeTokenLight(token) {
  return normalizeApostrophes(token)
    .toLowerCase()
    .replace(/[«»"“”.,;:!?()\[\]{}]/g, '')
    .replace(/^[-–—]+|[-–—]+$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeTokenFormal(token) {
  let s = stripDiacritics(normalizeTokenLight(token));

  const lexicalRules = new Map([
    ['et', 'e'],
    ['ed', 'e'],
    ['ogne', 'ogni'],
    ['om', 'uom'],
    ['omo', 'uomo'],
    ['ppiè', 'pie'],
    ['ppie', 'pie'],
    ['pie', 'pie'],
    ['sprendori', 'splendori'],
    ['sprendore', 'splendore'],
    ['diritta', 'dritta']
  ]);

  if (lexicalRules.has(s)) return lexicalRules.get(s);

  return s
    // consonante iniziale rafforzata: ppoi/poi, ppiè/piè, ccammino/cammino
    .replace(/^([bcdfglmnpqrstvxz])\1+/, '$1')
    // oscillazioni grafiche frequenti
    .replace(/spr/g, 'spl')
    .replace(/j/g, 'i')
    .replace(/y/g, 'i')
    .replace(/ç/g, 'z')
    .replace(/cha/g, 'ca')
    .replace(/cho/g, 'co')
    .replace(/chu/g, 'cu')
    .replace(/gha/g, 'ga')
    .replace(/gho/g, 'go')
    .replace(/ghu/g, 'gu')
    .replace(/h/g, '');
}

function tokenizeComparableText(text) {
  const normalized = normalizeApostrophes(text || '')
    .replace(/[«»"“”.,;:!?()\[\]{}]/g, ' ')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  return normalized.split(' ')
    .map(token => ({
      display: token,
      light: normalizeTokenLight(token),
      formal: normalizeTokenFormal(token)
    }))
    .filter(token => token.light);
}

function levenshteinDistance(a, b) {
  a = String(a || '');
  b = String(b || '');
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function commonPrefixLength(a, b) {
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i;
}

function looksMorphological(a, b) {
  if (!a || !b) return false;
  if (a === b) return false;

  const shortMorphPairs = new Set([
    'fu|fui', 'fui|fu',
    'e|è', 'è|e',
    'al|a', 'a|al',
    'del|de', 'de|del',
    'nel|ne', 'ne|nel'
  ]);
  if (shortMorphPairs.has(`${a}|${b}`)) return true;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  const prefix = commonPrefixLength(a, b);

  if (maxLen <= 4) return distance === 1 && prefix >= 1;
  if (prefix >= 3 && distance <= 2) return true;

  return false;
}

function classifyTokenPair(hToken, pToken) {
  if (!hToken && pToken) {
    return { type: 'omissione-harley', label: 'Omissione Harley' };
  }

  if (hToken && !pToken) {
    return { type: 'aggiunta-harley', label: 'Aggiunta Harley' };
  }

  if (!hToken && !pToken) {
    return { type: 'vuoto', label: '—' };
  }

  if (hToken.light === pToken.light) {
    return { type: 'uguale', label: 'Uguale' };
  }

  if (hToken.formal === pToken.formal) {
    return { type: 'formale', label: 'Formale' };
  }

  if (looksMorphological(hToken.formal, pToken.formal)) {
    return { type: 'morfologica', label: 'Morfologica' };
  }

  return { type: 'sostanziale', label: 'Sostanziale' };
}

function tokenSubstitutionCost(hToken, pToken) {
  const cls = classifyTokenPair(hToken, pToken).type;
  switch (cls) {
    case 'uguale': return 0;
    case 'formale': return 0.12;
    case 'morfologica': return 0.35;
    case 'sostanziale': return 0.95;
    default: return 0.95;
  }
}

function alignTokens(hTokens, pTokens) {
  const hLen = hTokens.length;
  const pLen = pTokens.length;
  const gapCost = 0.78;
  const dp = Array.from({ length: hLen + 1 }, () => Array(pLen + 1).fill(0));
  const back = Array.from({ length: hLen + 1 }, () => Array(pLen + 1).fill(null));

  for (let i = 1; i <= hLen; i++) {
    dp[i][0] = dp[i - 1][0] + gapCost;
    back[i][0] = 'delete';
  }
  for (let j = 1; j <= pLen; j++) {
    dp[0][j] = dp[0][j - 1] + gapCost;
    back[0][j] = 'insert';
  }

  for (let i = 1; i <= hLen; i++) {
    for (let j = 1; j <= pLen; j++) {
      const sub = dp[i - 1][j - 1] + tokenSubstitutionCost(hTokens[i - 1], pTokens[j - 1]);
      const del = dp[i - 1][j] + gapCost;
      const ins = dp[i][j - 1] + gapCost;
      const best = Math.min(sub, del, ins);
      dp[i][j] = best;
      back[i][j] = best === sub ? 'sub' : best === del ? 'delete' : 'insert';
    }
  }

  const pairs = [];
  let i = hLen;
  let j = pLen;

  while (i > 0 || j > 0) {
    const move = back[i][j];
    if (move === 'sub') {
      const harley = hTokens[i - 1];
      const petrocchi = pTokens[j - 1];
      const classification = classifyTokenPair(harley, petrocchi);
      pairs.unshift({ harley, petrocchi, ...classification });
      i--;
      j--;
    } else if (move === 'delete') {
      const harley = hTokens[i - 1];
      const classification = classifyTokenPair(harley, null);
      pairs.unshift({ harley, petrocchi: null, ...classification });
      i--;
    } else {
      const petrocchi = pTokens[j - 1];
      const classification = classifyTokenPair(null, petrocchi);
      pairs.unshift({ harley: null, petrocchi, ...classification });
      j--;
    }
  }

  return pairs;
}

function summarizeTokenPairs(pairs) {
  const counts = pairs.reduce((acc, pair) => {
    acc[pair.type] = (acc[pair.type] || 0) + 1;
    return acc;
  }, {});

  const has = type => (counts[type] || 0) > 0;

  if (pairs.length && pairs.every(pair => pair.type === 'uguale')) {
    return { type: 'uguale', label: 'Uguale', counts };
  }

  if (has('sostanziale')) {
    return { type: 'sostanziale', label: 'Sostanziale', counts };
  }

  if (has('aggiunta-harley') || has('omissione-harley')) {
    return { type: 'aggiunta-omissione', label: 'Aggiunta / omissione', counts };
  }

  if (has('morfologica')) {
    return { type: 'morfologica', label: 'Morfologica', counts };
  }

  if (has('formale')) {
    return { type: 'formale', label: 'Formale', counts };
  }

  return { type: 'da-verificare', label: 'Da verificare', counts };
}

function compareVerseTokens(hHtml, pHtml) {
  const harleyText = plainComparisonText(hHtml);
  const petrocchiText = plainComparisonText(pHtml);
  const harleyTokens = tokenizeComparableText(harleyText);
  const petrocchiTokens = tokenizeComparableText(petrocchiText);
  const pairs = alignTokens(harleyTokens, petrocchiTokens);
  const summary = summarizeTokenPairs(pairs);
  return { harleyText, petrocchiText, pairs, summary };
}

function renderTokenizedLine(pairs, side) {
  return pairs.map(pair => {
    const token = side === 'harley' ? pair.harley : pair.petrocchi;
    if (!token) return `<span class="comparison-token gap ${escapeAttr(pair.type)}">—</span>`;
    return `<span class="comparison-token ${escapeAttr(pair.type)}" title="${escapeAttr(pair.label)}">${escapeHTML(token.display)}</span>`;
  }).join(' ');
}

function renderVariantDetails(pairs) {
  const variants = pairs.filter(pair => pair.type !== 'uguale');
  if (!variants.length) return '';

  return `
    <details class="comparison-details">
      <summary>Dettaglio token (${variants.length})</summary>
      <div class="token-detail-table">
        <div class="token-detail-head">Harley</div>
        <div class="token-detail-head">Petrocchi</div>
        <div class="token-detail-head">Tipo</div>
        ${variants.map(pair => `
          <div>${pair.harley ? escapeHTML(pair.harley.display) : '<span class="muted">—</span>'}</div>
          <div>${pair.petrocchi ? escapeHTML(pair.petrocchi.display) : '<span class="muted">—</span>'}</div>
          <div><span class="variant-badge ${escapeAttr(pair.type)}">${escapeHTML(pair.label)}</span></div>
        `).join('')}
      </div>
    </details>
  `;
}

function renderComparisonFilters() {
  const filters = [
    ['all', 'Tutte'],
    ['formale', 'Formali'],
    ['morfologica', 'Morfologiche'],
    ['sostanziale', 'Sostanziali'],
    ['aggiunta-omissione', 'Aggiunte/omissioni'],
    ['da-verificare', 'Da verificare']
  ];

  return `
    <div class="comparison-toolbar" aria-label="Filtri confronto">
      ${filters.map(([value, label], index) => `
        <button type="button" class="comparison-filter ${index === 0 ? 'active' : ''}" data-comparison-filter="${value}">${label}</button>
      `).join('')}
    </div>
  `;
}

function bindComparisonFilters(container) {
  const buttons = [...container.querySelectorAll('[data-comparison-filter]')];
  const rows = [...container.querySelectorAll('.comparison-row')];

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const filter = button.dataset.comparisonFilter;
      buttons.forEach(b => b.classList.toggle('active', b === button));
      rows.forEach(row => {
        const type = row.dataset.variantType;
        row.hidden = filter !== 'all' && type !== filter;
      });
    });
  });
}

function renderConfrontoView() {
  if (!els.confrontoContent) return;

  const harleyCanto = state.cantos.find(c => c.n === state.currentCanto);
  const petrocchiCanto = state.petrocchiCantos.find(c => c.n === state.currentCanto);

  const harleyMode = getComparisonHarleyMode();
  const harleyModeLabel = getComparisonHarleyModeLabel();

  if (els.confrontoPanelTitle) {
    els.confrontoPanelTitle.textContent = `Confronto Harley / Petrocchi — Canto ${toRoman(state.currentCanto)} · Harley ${harleyModeLabel}`;
  }

  if (!state.petrocchiDoc || !petrocchiCanto) {
    els.confrontoContent.innerHTML = `
      <div class="comparison-placeholder">
        <h3>Confronto non ancora disponibile</h3>
        <p>Inserisci il file <code>data/testo_petrocchi.xml</code> nel progetto. Se mantiene una struttura TEI compatibile con <code>commedia_inferno.xml</code>, questa scheda costruirà automaticamente il confronto verso per verso.</p>
        <p>Per ora la scheda è già predisposta: quando il file sarà presente, mostrerà testo Harley, testo Petrocchi e stato della differenza.</p>
      </div>
    `;
    return;
  }

  const harleyLines = getLinesByIdFromCanto(harleyCanto);
  const petrocchiLines = getLinesByIdFromCanto(petrocchiCanto);
  const ids = unique([...harleyLines.keys(), ...petrocchiLines.keys()]).sort((a, b) => {
    const an = parseInt((a.split('.')[2] || '0'), 10);
    const bn = parseInt((b.split('.')[2] || '0'), 10);
    return an - bn;
  });

  els.confrontoContent.innerHTML = `
    <div class="comparison-mode-note">
      <span class="comparison-mode-pill">Harley ${escapeHTML(harleyModeLabel)}</span>
      <span>Il confronto usa la stessa lezione selezionata dal toggle <strong>Reg/Orig</strong>: Reg confronta <code>&lt;reg&gt;</code>/<code>&lt;corr&gt;</code>, Orig confronta <code>&lt;orig&gt;</code>/<code>&lt;sic&gt;</code>.</span>
    </div>
    ${renderComparisonFilters()}
    <div class="comparison-grid comparison-grid-head">
      <div>Verso</div>
      <div>Harley 3459 (${escapeHTML(harleyModeLabel)})</div>
      <div>Petrocchi</div>
      <div>Esito</div>
    </div>
    ${ids.map(id => {
      const h = harleyLines.get(id);
      const p = petrocchiLines.get(id);
      const hText = getLineTextForComparison(h, harleyMode);
      const pText = getLineTextForComparison(p, 'reg');

      let comparison;
      let status;

      if (!h && p) {
        comparison = compareVerseTokens('', pText);
        status = { type: 'omissione-harley', label: 'Manca Harley' };
      } else if (h && !p) {
        comparison = compareVerseTokens(hText, '');
        status = { type: 'aggiunta-harley', label: 'Manca Petrocchi' };
      } else {
        comparison = compareVerseTokens(hText, pText);
        status = comparison.summary;
      }

      const rowType = status.type === 'omissione-harley' || status.type === 'aggiunta-harley'
        ? 'aggiunta-omissione'
        : status.type;
      const rowClass = rowType === 'uguale' ? 'same' : 'different';

      return `
        <div class="comparison-grid comparison-row ${rowClass} variant-${escapeAttr(rowType)}" data-line-id="${escapeAttr(id)}" data-variant-type="${escapeAttr(rowType)}">
          <div class="comparison-ref">${escapeHTML(formatLineRef(id))}</div>
          <div class="comparison-text harley-text">
            ${comparison.pairs.length ? renderTokenizedLine(comparison.pairs, 'harley') : '<span class="muted">—</span>'}
          </div>
          <div class="comparison-text petrocchi-text">
            ${comparison.pairs.length ? renderTokenizedLine(comparison.pairs, 'petrocchi') : '<span class="muted">—</span>'}
          </div>
          <div class="comparison-status">
            <span class="variant-badge ${escapeAttr(rowType)}">${escapeHTML(status.label)}</span>
          </div>
          <div class="comparison-detail-cell">
            ${renderVariantDetails(comparison.pairs)}
          </div>
        </div>
      `;
    }).join('')}
  `;

  bindComparisonFilters(els.confrontoContent);
  bindNoteIndicators(els.confrontoContent);
}

/* ==========================================================================
   Event Binding 
   ========================================================================== */
function bindEvents() {
  $$('.view-tab').forEach(t => {
    t.onclick = () => setCurrentView(t.dataset.view);
  });

  $$('[data-open-view]').forEach(btn => {
    btn.addEventListener('click', () => setCurrentView(btn.dataset.openView));
  });

  els.toggleTextPanel?.addEventListener('click', () => {
    state.showTextPanel = !state.showTextPanel;
    updateCompletePanelVisibility();
  });

  els.toggleCommentoPanel?.addEventListener('click', () => {
    state.showCommentoPanel = !state.showCommentoPanel;
    updateCompletePanelVisibility();
  });

  els.cantoSelect.onchange = () => {
    state.currentCanto = parseInt(els.cantoSelect.value);
    if (state.currentView === 'facsimile') renderFacsimileView();
    else if (state.currentView === 'commento') renderCommentoView();
    else if (state.currentView === 'confronto') renderConfrontoView();
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

      if (state.currentView === 'confronto') {
        renderConfrontoView();
      }
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
    if (!e.target.closest('.note-popup') && !e.target.closest('.note-indicator') && !e.target.closest('.margin-indicator')) hideNotePopup();
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
        highlightCompleteCommentaryForFolio(folioN, true);
      }
    });
  }


  if (els.completeCommentoContent) {
    els.completeCommentoContent.addEventListener('scroll', () => {
      if (state.isSyncingCommento || state.currentView !== 'facsimile') return;

      const location = getCurrentCommentaryLocationFromScroll();
      if (!location?.entry) return;

      state.isSyncingCommento = true;
      clearTimeout(state.commentoSyncTimeout);
      syncFromCommentaryEntry(location.entry, { scrollText: false, scrollCommento: false, folioOverride: location.folio, updateFolio: true });
      state.commentoSyncTimeout = setTimeout(() => { state.isSyncingCommento = false; }, 450);
    });
  }
}
/* ==========================================================================
   Init
   ========================================================================== */
async function init() {
  cacheDom();
  try {
    const [commediaDoc, commentoDoc, marginiDoc, petrocchiDoc] = await Promise.all([
      loadXML('data/commedia_inferno.xml'),
      loadXML('data/commento_inferno.xml'),
      loadXML('data/margini_inferno.xml'),
      loadOptionalXML('data/testo_petrocchi.xml')
    ]);

    Object.assign(state, { commediaDoc, commentoDoc, marginiDoc, petrocchiDoc });
    state.cantos = parseCommedia(commediaDoc);
    state.commentary = parseCommentary(commentoDoc);
    state.marginalia = parseMarginalia(marginiDoc);
    state.petrocchiCantos = petrocchiDoc ? parseCommedia(petrocchiDoc) : [];
    state.folioContentMap = buildFolioContentMap(commediaDoc, commentoDoc);

    els.cantoSelect.innerHTML = state.cantos.map(c => `<option value="${c.n}">Canto ${toRoman(c.n)}</option>`).join('');

    bindEvents();
    renderCommentoView();
    renderFacsimileView();
    renderConfrontoView();
    updateCompletePanelVisibility();
    setCurrentView('home');

    els.loadingOverlay.classList.add('hide');
    setTimeout(() => els.loadingOverlay.remove(), 500);
  } catch (err) {
    els.loadingOverlay.innerHTML = `<div style="text-align:center;padding:40px;"><p style="color:var(--accent);font-size:1.1rem;margin-bottom:8px;">Errore</p><p style="color:var(--text-muted);font-size:0.85rem;">${escapeHTML(err.message)}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);