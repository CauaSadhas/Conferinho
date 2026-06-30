/* global pdfjsLib, Tesseract */

const VALUE_TOLERANCE = 0.01;
const MAX_OCR_PAGES_PER_FILE = 12;

const state = {
  reportAFiles: [],
  reportBFiles: [],
  results: [],
  activeFilter: 'all',
  demoMode: false,
  meta: emptyMeta()
};

function emptyMeta() {
  return {
    reportAPages: 0,
    reportBPages: 0,
    parsedA: 0,
    parsedB: 0,
    diagnostics: []
  };
}

const els = {
  reportAInput: document.querySelector('#reportAInput'),
  reportBInput: document.querySelector('#reportBInput'),
  reportADropzone: document.querySelector('#reportADropzone'),
  reportBDropzone: document.querySelector('#reportBDropzone'),
  reportAFileList: document.querySelector('#reportAFileList'),
  reportBFileList: document.querySelector('#reportBFileList'),
  compareBtn: document.querySelector('#compareBtn'),
  compareBtnText: document.querySelector('#compareBtnText'),
  statusHint: document.querySelector('#statusHint'),
  resetBtn: document.querySelector('#resetBtn'),
  loadDemoBtn: document.querySelector('#loadDemoBtn'),
  progressSection: document.querySelector('#progressSection'),
  progressTitle: document.querySelector('#progressTitle'),
  progressPercent: document.querySelector('#progressPercent'),
  progressBar: document.querySelector('#progressBar'),
  progressDetail: document.querySelector('#progressDetail'),
  resultsSection: document.querySelector('#resultsSection'),
  resultsBody: document.querySelector('#resultsBody'),
  emptyResults: document.querySelector('#emptyResults'),
  searchInput: document.querySelector('#searchInput'),
  totalCount: document.querySelector('#totalCount'),
  okCount: document.querySelector('#okCount'),
  divergentCount: document.querySelector('#divergentCount'),
  missingCount: document.querySelector('#missingCount'),
  duplicateCount: document.querySelector('#duplicateCount'),
  validationPanel: document.querySelector('#validationPanel'),
  resultSubtitle: document.querySelector('#resultSubtitle'),
  resultEyebrow: document.querySelector('#resultEyebrow'),
  resultTitle: document.querySelector('#resultTitle'),
  emptyResultsTitle: document.querySelector('#emptyResultsTitle'),
  emptyResultsText: document.querySelector('#emptyResultsText'),
  exportBtn: document.querySelector('#exportBtn'),
  printBtn: document.querySelector('#printBtn'),
  toast: document.querySelector('#toast')
};

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function addFiles(side, fileList) {
  const target = side === 'a' ? state.reportAFiles : state.reportBFiles;
  for (const file of Array.from(fileList || [])) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast(`O arquivo “${file.name}” não é um PDF.`);
      continue;
    }
    const duplicate = target.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
    if (!duplicate) target.push(file);
  }
  state.demoMode = false;
  renderFiles();
  updateReadyState();
}

function removeFile(side, index) {
  const target = side === 'a' ? state.reportAFiles : state.reportBFiles;
  target.splice(index, 1);
  renderFiles();
  updateReadyState();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileGroup(files, container, side) {
  container.innerHTML = files.map((file, index) => `
    <div class="file-card">
      <div class="file-type">PDF</div>
      <div class="file-info"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${formatFileSize(file.size)}</span></div>
      <button class="remove-file" data-side="${side}" data-index="${index}" type="button" aria-label="Remover arquivo">×</button>
    </div>
  `).join('');
}

function renderFiles() {
  renderFileGroup(state.reportAFiles, els.reportAFileList, 'a');
  renderFileGroup(state.reportBFiles, els.reportBFileList, 'b');
}

function updateReadyState() {
  const ready = state.demoMode || (state.reportAFiles.length > 0 && state.reportBFiles.length > 0);
  els.compareBtn.disabled = !ready;
  els.statusHint.classList.toggle('ready', ready);
  if (state.demoMode) {
    els.statusHint.innerHTML = '<span class="status-dot"></span>O exemplo está pronto para ser comparado.';
  } else if (ready) {
    els.statusHint.innerHTML = `<span class="status-dot"></span>${state.reportAFiles.length} arquivo(s) no Relatório 1 e ${state.reportBFiles.length} no Relatório 2.`;
  } else {
    els.statusHint.innerHTML = '<span class="status-dot"></span>Estou esperando pelo menos um PDF em cada campo.';
  }
}

function bindDropzone(dropzone, side) {
  ['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', event => addFiles(side, event.dataTransfer.files));
}

els.reportAInput.addEventListener('change', event => addFiles('a', event.target.files));
els.reportBInput.addEventListener('change', event => addFiles('b', event.target.files));
bindDropzone(els.reportADropzone, 'a');
bindDropzone(els.reportBDropzone, 'b');

els.searchInput.addEventListener('input', renderResults);
els.compareBtn.addEventListener('click', runComparison);
els.resetBtn.addEventListener('click', resetAll);
els.loadDemoBtn.addEventListener('click', loadDemo);
els.exportBtn.addEventListener('click', exportCsv);
els.printBtn.addEventListener('click', () => window.print());

document.addEventListener('click', event => {
  const removeButton = event.target.closest('.remove-file');
  if (removeButton) removeFile(removeButton.dataset.side, Number(removeButton.dataset.index));

  const filterButton = event.target.closest('[data-filter]');
  if (filterButton && (filterButton.classList.contains('filter-tab') || filterButton.classList.contains('summary-card'))) {
    setFilter(filterButton.dataset.filter);
  }
});

function setProgress(percent, title, detail) {
  els.progressSection.classList.remove('hidden');
  els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
}

async function runComparison() {
  els.compareBtn.disabled = true;
  els.compareBtnText.textContent = 'Analisando...';
  els.resultsSection.classList.add('hidden');
  setProgress(3, 'Preparando os relatórios...', 'Organizando os PDFs dos dois lados');

  try {
    let recordsA = [];
    let recordsB = [];
    state.meta = emptyMeta();

    if (state.demoMode) {
      await wait(350);
      setProgress(45, 'Entendendo os layouts...', 'Identificando campos e linhas correspondentes');
      await wait(350);
      ({ recordsA, recordsB } = getDemoRecords());
      state.meta = {
        reportAPages: 2,
        reportBPages: 2,
        parsedA: recordsA.length,
        parsedB: recordsB.length,
        diagnostics: [
          { side: 'a', name: 'Relatorio_1_exemplo.pdf', pages: 2, records: recordsA.length, method: 'Tabela reconhecida', usedOcr: false, fallback: false, textChars: 1200 },
          { side: 'b', name: 'Relatorio_2_exemplo.pdf', pages: 2, records: recordsB.length, method: 'Tabela reconhecida', usedOcr: false, fallback: false, textChars: 1100 }
        ]
      };
    } else {
      if (!window.pdfjsLib) throw new Error('O leitor de PDF não foi carregado. Verifique sua internet e tente novamente.');
      const totalFiles = state.reportAFiles.length + state.reportBFiles.length;
      let processed = 0;

      for (const file of state.reportAFiles) {
        setProgress(5 + (processed / totalFiles) * 67, 'Lendo o Relatório 1...', file.name);
        const parsed = await readAndUnderstandPdf(file, 'a', progress => {
          setProgress(5 + ((processed + progress) / totalFiles) * 67, progress < 0.95 ? 'Entendendo o Relatório 1...' : 'Finalizando a leitura...', file.name);
        });
        recordsA.push(...parsed.records);
        state.meta.reportAPages += parsed.pages;
        state.meta.diagnostics.push(parsed.diagnostic);
        processed += 1;
      }

      for (const file of state.reportBFiles) {
        setProgress(5 + (processed / totalFiles) * 67, 'Lendo o Relatório 2...', file.name);
        const parsed = await readAndUnderstandPdf(file, 'b', progress => {
          setProgress(5 + ((processed + progress) / totalFiles) * 67, progress < 0.95 ? 'Entendendo o Relatório 2...' : 'Finalizando a leitura...', file.name);
        });
        recordsB.push(...parsed.records);
        state.meta.reportBPages += parsed.pages;
        state.meta.diagnostics.push(parsed.diagnostic);
        processed += 1;
      }

      recordsA = prepareRecords(recordsA, 'a');
      recordsB = prepareRecords(recordsB, 'b');
      state.meta.parsedA = recordsA.length;
      state.meta.parsedB = recordsB.length;
    }

    if (!recordsA.length || !recordsB.length) {
      state.results = [];
      setProgress(100, 'Leitura incompleta', 'Não gerei ausências falsas porque um dos relatórios não produziu registros comparáveis');
      await wait(300);
      els.progressSection.classList.add('hidden');
      renderSummary(true);
      setFilter('all');
      els.resultsSection.classList.remove('hidden');
      els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('A comparação foi interrompida para evitar um resultado incorreto.');
      return;
    }

    setProgress(78, 'Encontrando correspondências...', 'Comparando identificadores, datas, valores, descrições e texto');
    await wait(260);
    state.results = compareRecords(recordsA, recordsB);
    setProgress(100, 'Comparação concluída', `${state.results.length} item(ns) organizados`);
    await wait(260);
    els.progressSection.classList.add('hidden');
    renderSummary(false);
    setFilter('all');
    els.resultsSection.classList.remove('hidden');
    els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Comparação concluída com sucesso.');
  } catch (error) {
    console.error(error);
    els.progressSection.classList.add('hidden');
    toast(error.message || 'Não foi possível concluir a comparação.');
  } finally {
    els.compareBtn.disabled = !(state.demoMode || (state.reportAFiles.length && state.reportBFiles.length));
    els.compareBtnText.textContent = 'Comparar relatórios';
  }
}

async function readAndUnderstandPdf(file, side, onProgress) {
  const extracted = await extractPdf(file, onProgress);
  let records = extractStructuredRecords(extracted, file.name, side);
  let fallback = false;
  let method = records.length ? 'Campos e linhas reconhecidos' : 'Comparação textual';

  if (records.length < 2) {
    const lineRecords = extractLineRecords(extracted, file.name, side);
    if (lineRecords.length > records.length) {
      records = lineRecords;
      fallback = true;
    }
  }

  records = prepareRecords(records, side);
  return {
    pages: extracted.pages,
    records,
    diagnostic: {
      side,
      name: file.name,
      pages: extracted.pages,
      records: records.length,
      method: fallback ? 'Comparação por linhas de texto' : method,
      usedOcr: extracted.usedOcr,
      textChars: extracted.textChars,
      fallback
    }
  };
}

async function extractPdf(file, onProgress = () => {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const rowsByPage = [];
  const allLines = [];
  let textChars = 0;
  let usedOcr = false;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter(item => String(item.str || '').trim())
      .map(item => ({
        x: Number(item.transform[4] || 0),
        y: Number(item.transform[5] || 0),
        width: Number(item.width || 0),
        height: Math.abs(Number(item.height || item.transform[3] || 0)),
        str: String(item.str || '').trim()
      }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const pageTextChars = items.reduce((sum, item) => sum + item.str.length, 0);
    textChars += pageTextChars;
    let pageRows = clusterPdfItems(items);

    if (pageTextChars < 25 && pageNumber <= MAX_OCR_PAGES_PER_FILE && window.Tesseract) {
      onProgress(Math.min(0.9, (pageNumber - 0.65) / pdf.numPages));
      const ocrText = await runOcrOnPage(page, pageNumber, pdf.numPages, onProgress);
      const ocrLines = ocrText.split(/\r?\n/).map(line => cleanSpaces(line)).filter(Boolean);
      if (ocrLines.length) {
        usedOcr = true;
        textChars += ocrText.length;
        pageRows = ocrLines.map((text, index) => ({ y: ocrLines.length - index, items: [], text, page: pageNumber }));
      }
    }

    pageRows.forEach(row => { row.page = pageNumber; });
    rowsByPage.push(pageRows);
    allLines.push(...pageRows.map(row => row.text));
    onProgress(pageNumber / pdf.numPages);
  }

  return { pages: pdf.numPages, rowsByPage, lines: allLines, textChars, usedOcr };
}

function clusterPdfItems(items) {
  const clusters = [];
  for (const item of items) {
    const tolerance = Math.max(1.8, Math.min(3.6, (item.height || 6) * 0.45));
    let cluster = clusters.find(candidate => Math.abs(candidate.y - item.y) <= tolerance);
    if (!cluster) {
      cluster = { y: item.y, items: [] };
      clusters.push(cluster);
    }
    cluster.items.push(item);
    cluster.y = cluster.items.reduce((sum, current) => sum + current.y, 0) / cluster.items.length;
  }

  return clusters
    .sort((a, b) => b.y - a.y)
    .map(cluster => {
      const sortedItems = cluster.items.sort((a, b) => a.x - b.x);
      return {
        y: cluster.y,
        items: sortedItems,
        text: cleanSpaces(sortedItems.map(item => item.str).join(' '))
      };
    })
    .filter(row => row.text);
}

async function runOcrOnPage(page, pageNumber, totalPages, onProgress) {
  const viewport = page.getViewport({ scale: 1.75 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;

  const result = await Tesseract.recognize(canvas, 'por', {
    logger: message => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        const pageBase = (pageNumber - 1) / totalPages;
        onProgress(Math.min(0.94, pageBase + (message.progress / totalPages) * 0.9));
      }
    }
  });
  return result?.data?.text || '';
}

function extractStructuredRecords(extracted, fileName, side) {
  const records = [];
  for (const pageRows of extracted.rowsByPage) {
    for (let index = 0; index < pageRows.length; index += 1) {
      const row = pageRows[index];
      const record = parsePotentialRecord(row.text, fileName, side, row.page || 1, index);
      if (record) records.push(record);
    }
  }
  return records;
}

function parsePotentialRecord(text, fileName, side, page, lineIndex) {
  const raw = cleanSpaces(text);
  const normalized = normalizeText(raw);
  if (!raw || raw.length < 8 || raw.length > 600) return null;
  if (isNoiseLine(normalized)) return null;

  const date = extractDate(raw);
  const amounts = extractAmounts(raw);
  const amount = chooseRepresentativeAmount(amounts);
  const documentNumber = extractDocumentNumber(raw, date, amounts);
  const taxId = extractTaxId(raw);
  const description = extractDescription(raw, { date, amounts, documentNumber, taxId });
  const alphaWords = (raw.match(/[A-Za-zÀ-ÿ]{2,}/g) || []).length;

  const strongRow = Boolean(date && (amount !== null || documentNumber));
  const descriptiveRow = Boolean((documentNumber || taxId) && amount !== null && alphaWords >= 1);
  const numericRow = Boolean(date && amount !== null && alphaWords >= 1);
  if (!strongRow && !descriptiveRow && !numericRow) return null;

  return {
    side,
    identifier: documentNumber || taxId || createLineIdentifier(raw, page, lineIndex),
    documentNumber: documentNumber || '',
    taxId: taxId || '',
    date: date || '',
    amount,
    description: description || trimText(raw, 160),
    raw,
    fileName,
    page,
    lineIndex,
    mode: 'structured'
  };
}

function extractLineRecords(extracted, fileName, side) {
  const commonHeaders = findRepeatedLines(extracted.rowsByPage);
  const records = [];
  extracted.rowsByPage.forEach((pageRows, pageIndex) => {
    pageRows.forEach((row, lineIndex) => {
      const raw = cleanSpaces(row.text);
      const normalized = normalizeText(raw);
      if (raw.length < 12 || raw.length > 500 || isNoiseLine(normalized) || commonHeaders.has(normalized)) return;
      if ((raw.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length < 8) return;
      const date = extractDate(raw);
      const amounts = extractAmounts(raw);
      const amount = chooseRepresentativeAmount(amounts);
      const documentNumber = extractDocumentNumber(raw, date, amounts);
      const taxId = extractTaxId(raw);
      records.push({
        side,
        identifier: documentNumber || taxId || createLineIdentifier(raw, pageIndex + 1, lineIndex),
        documentNumber: documentNumber || '',
        taxId: taxId || '',
        date: date || '',
        amount,
        description: trimText(raw, 180),
        raw,
        fileName,
        page: pageIndex + 1,
        lineIndex,
        mode: 'line'
      });
    });
  });
  return records;
}

function findRepeatedLines(rowsByPage) {
  if (rowsByPage.length < 2) return new Set();
  const counts = new Map();
  rowsByPage.forEach(pageRows => {
    const pageSet = new Set(pageRows.map(row => normalizeText(row.text)).filter(text => text.length > 5));
    pageSet.forEach(text => counts.set(text, (counts.get(text) || 0) + 1));
  });
  const threshold = Math.max(2, Math.ceil(rowsByPage.length * 0.6));
  return new Set([...counts.entries()].filter(([, count]) => count >= threshold).map(([text]) => text));
}

function isNoiseLine(normalized) {
  const noisePatterns = [
    /^pagina\b/, /^page\b/, /^emissao\b/, /^hora\b/, /^periodo\b/, /^usuario\b/,
    /^visualizando\b/, /^copyright\b/, /^todos os direitos/, /^sistema licenciado/,
    /^informacoes de pesquisa/, /^menu de opcoes/, /^consultar\b/, /^limpar\b/,
    /^total geral\b/, /^total acumulador\b/, /^subtotal\b/, /^total\b/,
    /^(codigo|data|nota|serie|especie|fornecedor|valor|descricao|documento)(\s|$)/
  ];
  return noisePatterns.some(pattern => pattern.test(normalized));
}

function extractDate(text) {
  const match = text.match(/\b([0-3]?\d)[\/\-.]([01]?\d)[\/\-.]((?:19|20)?\d{2})\b/);
  if (!match) return '';
  let year = match[3];
  if (year.length === 2) year = Number(year) > 60 ? `19${year}` : `20${year}`;
  return `${String(match[1]).padStart(2, '0')}/${String(match[2]).padStart(2, '0')}/${year}`;
}

function extractAmounts(text) {
  const regex = /(?:R\$\s*)?[-+]?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?[-+]?\d+\.\d{2}\b/g;
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({ raw: match[0], value: parseMoney(match[0]), index: match.index });
  }
  return matches.filter(item => Number.isFinite(item.value));
}

function chooseRepresentativeAmount(amounts) {
  if (!amounts.length) return null;
  const positive = amounts.filter(item => Math.abs(item.value) > 0.0001);
  const pool = positive.length ? positive : amounts;
  return pool.reduce((best, item) => Math.abs(item.value) > Math.abs(best.value) ? item : best).value;
}

function extractTaxId(text) {
  const formatted = text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/);
  if (formatted) return formatted[0].replace(/\D/g, '');
  const plain = text.match(/\b\d{14}\b|\b\d{11}\b/);
  return plain ? plain[0] : '';
}

function extractDocumentNumber(text, date, amounts) {
  let cleaned = text;
  if (date) {
    const [day, month, year] = date.split('/');
    const dateRegex = new RegExp(`\\b${Number(day)}[\\/\\-.]0?${Number(month)}[\\/\\-.](?:${year}|${year.slice(2)})\\b`);
    cleaned = cleaned.replace(dateRegex, ' __DATE__ ');
  }
  amounts.forEach(amount => { cleaned = cleaned.replace(amount.raw, ' __AMOUNT__ '); });
  cleaned = cleaned.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' __TAX__ ');

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const dateIndex = tokens.indexOf('__DATE__');
  const candidates = tokens
    .map((token, index) => ({ token: token.replace(/[^0-9]/g, ''), index, original: token }))
    .filter(item => /^\d{2,12}$/.test(item.token) && !['19', '20'].includes(item.token));

  if (!candidates.length) return '';
  const reasonable = candidates.filter(item => item.token.length <= 9 || item.token.length === 12);
  const pool = reasonable.length ? reasonable : candidates;

  if (dateIndex >= 0) {
    const after = pool.filter(item => item.index > dateIndex && item.index <= dateIndex + 4).sort((a, b) => a.index - b.index);
    if (after.length) return stripLeadingZeros(after[0].token);
    const before = pool.filter(item => item.index < dateIndex && item.index >= dateIndex - 4).sort((a, b) => b.index - a.index);
    if (before.length) return stripLeadingZeros(before[0].token);
  }

  const scored = pool.map(item => ({
    ...item,
    score: (item.token.length >= 3 && item.token.length <= 9 ? 2 : 0) + (item.index > 0 ? 0.2 : 0)
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  return stripLeadingZeros(scored[0].token);
}

function extractDescription(text, fields) {
  let description = text;
  if (fields.date) description = description.replace(new RegExp(escapeRegExpLoose(fields.date), 'g'), ' ');
  fields.amounts.forEach(amount => { description = description.replace(amount.raw, ' '); });
  if (fields.taxId) description = description.replace(new RegExp(fields.taxId.split('').join('\\D*')), ' ');
  if (fields.documentNumber) description = description.replace(new RegExp(`\\b0*${escapeRegExp(fields.documentNumber)}\\b`), ' ');
  description = description
    .replace(/\b(?:SP|MS|MT|MG|PR|SC|RS|RJ|GO|DF|BA|PE|CE|ES|PA|AM|RO|AC|AP|RR|TO|MA|PI|RN|PB|AL|SE)\b/g, ' ')
    .replace(/\b\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\-–—:;,\.\s]+|[\-–—:;,\.\s]+$/g, '')
    .trim();
  const words = description.split(' ').filter(word => /[A-Za-zÀ-ÿ]/.test(word));
  if (words.length < 1) return '';
  return trimText(words.join(' '), 180);
}

function prepareRecords(records, side) {
  const unique = [];
  const seen = new Map();
  for (const record of records) {
    const normalizedRecord = {
      ...record,
      side,
      identifier: String(record.identifier || '').trim(),
      description: cleanSpaces(record.description || record.raw || ''),
      raw: cleanSpaces(record.raw || record.description || ''),
      amount: Number.isFinite(record.amount) ? record.amount : null
    };
    const key = recordSignature(normalizedRecord);
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    normalizedRecord.duplicateIndex = count;
    normalizedRecord.duplicate = count > 0;
    unique.push(normalizedRecord);
  }
  const duplicateKeys = new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  unique.forEach(record => { if (duplicateKeys.has(recordSignature(record))) record.duplicate = true; });
  return unique;
}

function recordSignature(record) {
  return [
    normalizeIdentifier(record.identifier),
    normalizeDate(record.date),
    record.amount === null ? '' : record.amount.toFixed(2),
    normalizeText(record.description).slice(0, 60)
  ].join('|');
}

function compareRecords(recordsA, recordsB) {
  const unmatchedB = new Set(recordsB.map((_, index) => index));
  const matches = [];

  const orderedA = [...recordsA].sort((x, y) => recordSpecificity(y) - recordSpecificity(x));
  for (const recordA of orderedA) {
    let best = null;
    for (const indexB of unmatchedB) {
      const recordB = recordsB[indexB];
      const scoreInfo = matchScore(recordA, recordB);
      if (!best || scoreInfo.score > best.score) best = { indexB, recordB, ...scoreInfo };
    }

    const threshold = matchThreshold(recordA, best?.recordB);
    if (best && best.score >= threshold) {
      unmatchedB.delete(best.indexB);
      matches.push(buildMatchedResult(recordA, best.recordB, best));
    } else {
      matches.push(buildMissingResult(recordA, 'missing-b'));
    }
  }

  for (const indexB of unmatchedB) matches.push(buildMissingResult(recordsB[indexB], 'missing-a'));

  const order = { divergent: 0, 'missing-b': 1, 'missing-a': 2, ok: 3 };
  return matches.sort((a, b) => (order[a.status] - order[b.status]) || String(a.identifier).localeCompare(String(b.identifier), 'pt-BR', { numeric: true }));
}

function recordSpecificity(record) {
  return (record.documentNumber ? 4 : 0) + (record.taxId ? 4 : 0) + (record.date ? 2 : 0) + (record.amount !== null ? 2 : 0) + Math.min(2, tokenize(record.description).size / 5);
}

function matchThreshold(a, b) {
  if (!b) return 1;
  if (a.documentNumber && b.documentNumber && normalizeIdentifier(a.documentNumber) === normalizeIdentifier(b.documentNumber)) return 0.46;
  if (a.taxId && b.taxId && a.taxId === b.taxId) return 0.46;
  if (a.mode === 'line' || b.mode === 'line') return 0.58;
  return 0.52;
}

function matchScore(a, b) {
  let score = 0;
  const reasons = [];
  const idA = normalizeIdentifier(a.documentNumber || a.identifier);
  const idB = normalizeIdentifier(b.documentNumber || b.identifier);
  const genericIdA = isGeneratedIdentifier(a.identifier);
  const genericIdB = isGeneratedIdentifier(b.identifier);

  if (idA && idB && idA === idB && !genericIdA && !genericIdB) {
    score += 0.48;
    reasons.push('identificador');
  } else if (idA && idB && idA.length >= 4 && idB.length >= 4 && (idA.endsWith(idB) || idB.endsWith(idA))) {
    score += 0.28;
  }

  if (a.taxId && b.taxId && a.taxId === b.taxId) {
    score += 0.32;
    reasons.push('CPF/CNPJ');
  }

  if (a.amount !== null && b.amount !== null) {
    const difference = Math.abs(a.amount - b.amount);
    const scale = Math.max(1, Math.abs(a.amount), Math.abs(b.amount));
    if (difference <= VALUE_TOLERANCE) {
      score += 0.24;
      reasons.push('valor');
    } else if (difference / scale <= 0.005) score += 0.14;
    else if (difference / scale <= 0.03) score += 0.06;
  }

  if (a.date && b.date) {
    const dayDifference = dateDistanceInDays(a.date, b.date);
    if (dayDifference === 0) {
      score += 0.14;
      reasons.push('data');
    } else if (dayDifference <= 3) score += 0.07;
    else if (dayDifference <= 31) score += 0.02;
  }

  const descriptionSimilarity = textSimilarity(a.description || a.raw, b.description || b.raw);
  const rawSimilarity = textSimilarity(a.raw, b.raw);
  score += Math.max(descriptionSimilarity * 0.24, rawSimilarity * 0.18);
  if (descriptionSimilarity >= 0.72) reasons.push('descrição');

  return { score: Math.min(1, score), descriptionSimilarity, rawSimilarity, reasons };
}

function buildMatchedResult(a, b, scoreInfo) {
  const differences = [];
  if (a.amount !== null && b.amount !== null && Math.abs(a.amount - b.amount) > VALUE_TOLERANCE) differences.push('Valor diferente');
  if (a.date && b.date && normalizeDate(a.date) !== normalizeDate(b.date)) differences.push('Data diferente');
  if (a.documentNumber && b.documentNumber && normalizeIdentifier(a.documentNumber) !== normalizeIdentifier(b.documentNumber)) differences.push('Identificador diferente');
  if (a.taxId && b.taxId && a.taxId !== b.taxId) differences.push('CPF/CNPJ diferente');
  if (scoreInfo.descriptionSimilarity < 0.58 && normalizeText(a.description) !== normalizeText(b.description)) differences.push('Descrição diferente');

  return {
    status: differences.length ? 'divergent' : 'ok',
    identifier: chooseDisplayIdentifier(a, b),
    description: chooseDisplayDescription(a, b),
    descriptionA: a.description,
    descriptionB: b.description,
    dateA: a.date,
    dateB: b.date,
    amountA: a.amount,
    amountB: b.amount,
    fileA: a.fileName,
    fileB: b.fileName,
    pageA: a.page,
    pageB: b.page,
    rawA: a.raw,
    rawB: b.raw,
    differences,
    duplicate: Boolean(a.duplicate || b.duplicate),
    confidence: scoreInfo.score
  };
}

function buildMissingResult(record, status) {
  const fromA = status === 'missing-b';
  return {
    status,
    identifier: record.identifier,
    description: record.description,
    descriptionA: fromA ? record.description : '',
    descriptionB: fromA ? '' : record.description,
    dateA: fromA ? record.date : '',
    dateB: fromA ? '' : record.date,
    amountA: fromA ? record.amount : null,
    amountB: fromA ? null : record.amount,
    fileA: fromA ? record.fileName : '',
    fileB: fromA ? '' : record.fileName,
    pageA: fromA ? record.page : null,
    pageB: fromA ? null : record.page,
    rawA: fromA ? record.raw : '',
    rawB: fromA ? '' : record.raw,
    differences: [fromA ? 'Não localizado no Relatório 2' : 'Não localizado no Relatório 1'],
    duplicate: Boolean(record.duplicate),
    confidence: 0
  };
}

function chooseDisplayIdentifier(a, b) {
  const idA = String(a.documentNumber || a.identifier || '');
  const idB = String(b.documentNumber || b.identifier || '');
  if (!isGeneratedIdentifier(idA)) return idA;
  if (!isGeneratedIdentifier(idB)) return idB;
  return idA || idB || '—';
}

function chooseDisplayDescription(a, b) {
  const left = cleanSpaces(a.description || '');
  const right = cleanSpaces(b.description || '');
  if (!left) return right;
  if (!right) return left;
  return left.length >= right.length ? left : right;
}

function renderSummary(readingFailed = false) {
  const counts = state.results.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'ok') acc.ok += 1;
    if (item.status === 'divergent') acc.divergent += 1;
    if (item.status === 'missing-a' || item.status === 'missing-b') acc.missing += 1;
    if (item.duplicate) acc.duplicate += 1;
    return acc;
  }, { total: 0, ok: 0, divergent: 0, missing: 0, duplicate: 0 });

  els.totalCount.textContent = counts.total;
  els.okCount.textContent = counts.ok;
  els.divergentCount.textContent = counts.divergent;
  els.missingCount.textContent = counts.missing;
  els.duplicateCount.textContent = counts.duplicate;

  if (readingFailed) {
    els.resultEyebrow.innerHTML = '<span class="eyebrow-dot"></span> LEITURA PRECISA DE ATENÇÃO';
    els.resultTitle.textContent = 'Não gerei uma comparação incompleta.';
    els.resultSubtitle.textContent = 'Veja abaixo qual arquivo não produziu conteúdo comparável.';
    els.emptyResultsTitle.textContent = 'Nenhum resultado foi criado';
    els.emptyResultsText.textContent = 'O Conferinho evitou marcar linhas como ausentes sem ter lido os dois lados corretamente.';
  } else {
    els.resultEyebrow.innerHTML = '<span class="eyebrow-dot"></span> COMPARAÇÃO CONCLUÍDA';
    els.resultTitle.textContent = 'Prontinho! Veja o que eu encontrei.';
    els.resultSubtitle.textContent = `${state.meta.parsedA} registro(s) no Relatório 1 e ${state.meta.parsedB} no Relatório 2.`;
    els.emptyResultsTitle.textContent = 'Nenhum item encontrado';
    els.emptyResultsText.textContent = 'Altere o filtro ou o termo de busca.';
  }

  const diagnosticRows = state.meta.diagnostics.map(item => {
    const noText = item.textChars < 20;
    const status = item.records > 0 ? 'ok' : (noText ? 'scan' : 'error');
    const label = item.records > 0
      ? `${item.records} registro(s) comparável(is)`
      : (noText ? 'Não foi possível extrair texto' : 'Nenhum bloco comparável foi reconhecido');
    const method = item.usedOcr ? `${item.method} · OCR utilizado` : item.method;
    return `
      <div class="diagnostic-row diagnostic-${status}">
        <div class="diagnostic-file">
          <span class="diagnostic-badge">REL. ${item.side === 'a' ? '1' : '2'}</span>
          <div><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><span>${item.pages} página(s) · ${escapeHtml(method || 'Leitura automática')}</span></div>
        </div>
        <div class="diagnostic-result"><b>${label}</b>${noText ? '<span>O arquivo pode estar protegido, vazio ou com uma imagem que o OCR não conseguiu ler.</span>' : ''}</div>
      </div>`;
  }).join('');

  const warning = readingFailed ? `
    <div class="reading-alert">
      <span class="reading-alert-icon">!</span>
      <div><strong>O Conferinho protegeu você de um resultado falso.</strong><p>Um dos lados ficou sem registros comparáveis. Por isso, ele não marcou todo o outro relatório como ausente.</p></div>
    </div>` : '';

  els.validationPanel.innerHTML = `
    ${warning}
    <div class="validation-title"><strong>Como os arquivos foram entendidos</strong><span>O sistema escolhe automaticamente entre leitura de tabela, campos, texto corrido e OCR.</span></div>
    <div class="validation-grid">
      <div class="validation-item"><span>Relatório 1</span><strong>${state.demoMode ? 1 : state.reportAFiles.length} arquivo(s) · ${state.meta.reportAPages} página(s)</strong></div>
      <div class="validation-item"><span>Relatório 2</span><strong>${state.demoMode ? 1 : state.reportBFiles.length} arquivo(s) · ${state.meta.reportBPages} página(s)</strong></div>
      <div class="validation-item"><span>Registros do Relatório 1</span><strong>${state.meta.parsedA} registros</strong></div>
      <div class="validation-item"><span>Registros do Relatório 2</span><strong>${state.meta.parsedB} registros</strong></div>
    </div>
    <div class="diagnostic-list">${diagnosticRows}</div>
  `;
}

function setFilter(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  document.querySelectorAll('.summary-card').forEach(button => {
    const active = button.dataset.filter === filter || (button.dataset.filter === 'missing' && ['missing-a', 'missing-b'].includes(filter));
    button.classList.toggle('active', active);
  });
  renderResults();
}

function renderResults() {
  const query = normalizeText(els.searchInput.value);
  const filtered = state.results.filter(item => {
    const matchesFilter = state.activeFilter === 'all'
      || item.status === state.activeFilter
      || (state.activeFilter === 'duplicate' && item.duplicate)
      || (state.activeFilter === 'missing' && ['missing-a', 'missing-b'].includes(item.status));
    const haystack = normalizeText(`${item.identifier} ${item.description} ${item.descriptionA} ${item.descriptionB} ${item.rawA} ${item.rawB}`);
    return matchesFilter && (!query || haystack.includes(query));
  });

  const labels = {
    ok: 'Conferido',
    divergent: 'Divergente',
    'missing-b': 'Só no Relatório 1',
    'missing-a': 'Só no Relatório 2'
  };

  els.resultsBody.innerHTML = filtered.map(item => {
    const descriptionDetail = item.descriptionA && item.descriptionB && normalizeText(item.descriptionA) !== normalizeText(item.descriptionB)
      ? `Relatório 2: ${escapeHtml(item.descriptionB)}`
      : (item.differences?.length ? item.differences.join(' · ') : '');
    const amountDifferent = item.amountA !== null && item.amountB !== null && Math.abs(item.amountA - item.amountB) > VALUE_TOLERANCE;
    const duplicateBadge = item.duplicate ? '<span class="duplicate-inline">Duplicado?</span>' : '';
    return `
      <tr>
        <td><span class="status-pill status-${item.status}">${labels[item.status]}</span>${duplicateBadge}</td>
        <td><strong>${escapeHtml(item.identifier || '—')}</strong></td>
        <td class="supplier-cell"><strong title="${escapeHtml(item.description)}">${escapeHtml(trimText(item.description, 85))}</strong>${descriptionDetail ? `<span>${escapeHtml(trimText(descriptionDetail, 100))}</span>` : ''}</td>
        <td>${item.dateA || '—'}</td>
        <td>${item.dateB || '—'}</td>
        <td class="align-right ${amountDifferent ? 'value-diff' : ''}">${formatMoney(item.amountA)}</td>
        <td class="align-right ${amountDifferent ? 'value-diff' : ''}">${formatMoney(item.amountB)}</td>
        <td class="source-stack">${item.fileA ? `<span title="${escapeHtml(item.fileA)}">Rel. 1: ${escapeHtml(item.fileA)}${item.pageA ? ` · pág. ${item.pageA}` : ''}</span>` : ''}${item.fileB ? `<span title="${escapeHtml(item.fileB)}">Rel. 2: ${escapeHtml(item.fileB)}${item.pageB ? ` · pág. ${item.pageB}` : ''}</span>` : ''}</td>
      </tr>`;
  }).join('');

  els.emptyResults.classList.toggle('hidden', filtered.length > 0);
}

function getDemoRecords() {
  const recordsA = prepareRecords([
    { identifier: '10458', documentNumber: '10458', date: '03/06/2026', description: 'AGRO CAMPO PEÇAS E MÁQUINAS LTDA', amount: 1480.00, raw: '10458 03/06/2026 AGRO CAMPO PEÇAS E MÁQUINAS LTDA R$ 1.480,00', fileName: 'Relatorio_1_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '10471', documentNumber: '10471', date: '08/06/2026', description: 'AGRO CAMPO PEÇAS E MÁQUINAS LTDA', amount: 320.90, raw: '10471 08/06/2026 AGRO CAMPO PEÇAS E MÁQUINAS LTDA R$ 320,90', fileName: 'Relatorio_1_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '8842', documentNumber: '8842', date: '11/06/2026', description: 'COOPERATIVA RURAL DO PANTANAL', amount: 7825.40, raw: '8842 11/06/2026 COOPERATIVA RURAL DO PANTANAL R$ 7.825,40', fileName: 'Relatorio_1_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '910', documentNumber: '910', date: '18/06/2026', description: 'FAZENDA BOA ESPERANÇA INSUMOS LTDA', amount: 9600.00, raw: '910 18/06/2026 FAZENDA BOA ESPERANÇA INSUMOS LTDA R$ 9.600,00', fileName: 'Relatorio_1_exemplo.pdf', page: 2, mode: 'structured' },
    { identifier: '22208', documentNumber: '22208', date: '24/06/2026', description: 'POSTO CENTRAL COMBUSTÍVEIS LTDA', amount: 675.30, raw: '22208 24/06/2026 POSTO CENTRAL COMBUSTÍVEIS LTDA R$ 675,30', fileName: 'Relatorio_1_exemplo.pdf', page: 2, mode: 'structured' }
  ], 'a');

  const recordsB = prepareRecords([
    { identifier: '10458', documentNumber: '10458', date: '03/06/2026', description: 'AGRO CAMPO PECAS E MAQUINAS LTDA', amount: 1480.00, raw: '03/06/2026 NOTA 10458 AGRO CAMPO PECAS E MAQUINAS LTDA 1480,00', fileName: 'Relatorio_2_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '10471', documentNumber: '10471', date: '08/06/2026', description: 'AGRO CAMPO PECAS E MAQ LTDA', amount: 325.90, raw: '03 10471 AGRO CAMPO PECAS E MAQ LTDA 08/06/2026 325,90', fileName: 'Relatorio_2_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '8842', documentNumber: '8842', date: '12/06/2026', description: 'COOPERATIVA RURAL DO PANTANAL', amount: 7825.40, raw: '8842 COOPERATIVA RURAL DO PANTANAL 12/06/2026 7825,40', fileName: 'Relatorio_2_exemplo.pdf', page: 1, mode: 'structured' },
    { identifier: '910', documentNumber: '910', date: '18/06/2026', description: 'FAZENDA BOA ESPERANCA INSUMOS', amount: 9600.00, raw: '910 FAZENDA BOA ESPERANCA INSUMOS 18/06/2026 9600,00', fileName: 'Relatorio_2_exemplo.pdf', page: 2, mode: 'structured' },
    { identifier: '33100', documentNumber: '33100', date: '27/06/2026', description: 'CASA DO PRODUTOR LTDA', amount: 410.00, raw: '33100 CASA DO PRODUTOR LTDA 27/06/2026 410,00', fileName: 'Relatorio_2_exemplo.pdf', page: 2, mode: 'structured' }
  ], 'b');
  return { recordsA, recordsB };
}

function loadDemo() {
  state.reportAFiles = [];
  state.reportBFiles = [];
  state.demoMode = true;
  state.results = [];
  renderFiles();
  updateReadyState();
  els.resultsSection.classList.add('hidden');
  toast('Demonstração carregada. Clique em “Comparar relatórios”.');
}

function resetAll() {
  state.reportAFiles = [];
  state.reportBFiles = [];
  state.results = [];
  state.demoMode = false;
  state.activeFilter = 'all';
  state.meta = emptyMeta();
  els.reportAInput.value = '';
  els.reportBInput.value = '';
  els.searchInput.value = '';
  els.resultsSection.classList.add('hidden');
  els.progressSection.classList.add('hidden');
  renderFiles();
  updateReadyState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exportCsv() {
  if (!state.results.length) return;
  const headers = ['Situação', 'Identificador', 'Descrição Relatório 1', 'Descrição Relatório 2', 'Data Relatório 1', 'Data Relatório 2', 'Valor Relatório 1', 'Valor Relatório 2', 'Diferenças', 'Arquivo Relatório 1', 'Arquivo Relatório 2'];
  const labels = { ok: 'Conferido', divergent: 'Divergente', 'missing-b': 'Só no Relatório 1', 'missing-a': 'Só no Relatório 2' };
  const rows = state.results.map(item => [
    labels[item.status], item.identifier, item.descriptionA, item.descriptionB, item.dateA, item.dateB,
    item.amountA === null ? '' : item.amountA.toFixed(2).replace('.', ','),
    item.amountB === null ? '' : item.amountB.toFixed(2).replace('.', ','),
    (item.differences || []).join(' | '), item.fileA, item.fileB
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `comparacao-conferinho-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Arquivo CSV gerado.');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|me|eireli|sa|s a|epp|cia|companhia)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIdentifier(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function normalizeDate(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function tokenize(value) {
  return new Set(normalizeText(value).split(' ').filter(token => token.length >= 2));
}

function textSimilarity(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return normalizeText(left) === normalizeText(right) ? 1 : 0;
  let intersection = 0;
  a.forEach(token => { if (b.has(token)) intersection += 1; });
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;
  const containment = Math.min(a.size, b.size) ? intersection / Math.min(a.size, b.size) : 0;
  return Math.max(jaccard, containment * 0.88);
}

function dateDistanceInDays(left, right) {
  const parse = value => {
    const [day, month, year] = value.split('/').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  try { return Math.round(Math.abs(parse(left) - parse(right)) / 86400000); } catch { return 9999; }
}

function parseMoney(value) {
  const text = String(value || '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!text) return NaN;
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'));
  return Number(text);
}

function formatMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function stripLeadingZeros(value) {
  return String(value || '').replace(/^0+(?=\d)/, '') || '0';
}

function createLineIdentifier(text, page, lineIndex) {
  let hash = 2166136261;
  const normalized = normalizeText(text);
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `LIN-${page}-${lineIndex + 1}-${(hash >>> 0).toString(36).toUpperCase().slice(0, 5)}`;
}

function isGeneratedIdentifier(value) {
  return /^LIN-/i.test(String(value || ''));
}

function cleanSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function trimText(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeRegExpLoose(value) {
  return escapeRegExp(value).replace(/\\\//g, '[\\/\\-.]');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 3400);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

renderFiles();
updateReadyState();
