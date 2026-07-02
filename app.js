"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pdfState = { filesA: [], filesB: [], records: [], filter: "all", search: "" };
const nfseState = { files: [], notes: [], warnings: [], processed: 0, failed: 0, filter: "retained", search: "" };
const sumState = { files: [], records: [], warnings: [], pages: 0, filter: "all", search: "" };

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const moduleCopy = {
  pdf: {
    title: 'Deixe que o <span>Conferinho</span> encontre as diferenças para você.',
    text: "Envie dois relatórios, de qualquer origem. O Conferinho organiza os dados e mostra o que está igual, diferente ou ausente.",
    benefits: ["Vários arquivos de cada lado", "Leitura automática", "Resultado exportável"],
    mascot: "Envie os dois relatórios e eu procuro as diferenças."
  },
  nfse: {
    title: 'O <span>Conferinho</span> também analisa suas NFS-e.',
    text: "Envie vários XMLs de NFS-e. Eu encontro as notas com retenção de ISS e preparo o total dos serviços e do imposto retido.",
    benefits: ["Vários XMLs de uma vez", "Soma dos serviços retidos", "Relatório em CSV"],
    mascot: "Pode mandar os XMLs que eu separo as retenções."
  },
  sum: {
    title: 'Mande um print e o <span>Conferinho</span> soma as NFs.',
    text: "Envie imagens ou PDFs. Eu identifico cada número de nota, encontro seu valor total e preparo um relatório para conferência.",
    benefits: ["Print ou PDF", "Leitura por OCR", "Total e relatório revisável"],
    mascot: "Pode mandar o documento que eu leio e somo as notas."
  }
};

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function onlyDigits(value) { return String(value ?? "").replace(/\D/g, ""); }
function formatDocument(value) {
  const d = onlyDigits(value);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return value || "";
}
function csvEscape(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function yieldBrowser() { return new Promise((resolve) => setTimeout(resolve, 0)); }

$$('.module-button').forEach((button) => button.addEventListener('click', () => activateModule(button.dataset.module)));
function activateModule(name) {
  $$('.module-button').forEach((button) => button.classList.toggle('active', button.dataset.module === name));
  $('#pdfModule').classList.toggle('hidden', name !== 'pdf');
  $('#nfseModule').classList.toggle('hidden', name !== 'nfse');
  $('#sumModule').classList.toggle('hidden', name !== 'sum');
  const copy = moduleCopy[name];
  $('#heroTitle').innerHTML = copy.title;
  $('#heroText').textContent = copy.text;
  $('#heroBenefits').innerHTML = copy.benefits.map((item) => `<span><b>✓</b> ${escapeHtml(item)}</span>`).join('');
  $('#mascotMessage').textContent = copy.mascot;
  location.hash = 'top';
}

$('#globalResetBtn').addEventListener('click', () => {
  const active = $('.module-button.active')?.dataset.module;
  if (active === 'nfse') resetNfse(); else if (active === 'sum') resetSum(); else resetPdf();
});

function bindDropzone(dropzone, input, accept, onFiles) {
  input.addEventListener('change', () => onFiles([...input.files].filter(accept)));
  ['dragenter','dragover'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); }));
  ['dragleave','drop'].forEach((eventName) => dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
  dropzone.addEventListener('drop', (event) => onFiles([...event.dataTransfer.files].filter(accept)));
}

bindDropzone($('#reportADropzone'), $('#reportAInput'), (f) => /\.pdf$/i.test(f.name), (files) => setPdfFiles('A', files));
bindDropzone($('#reportBDropzone'), $('#reportBInput'), (f) => /\.pdf$/i.test(f.name), (files) => setPdfFiles('B', files));
function setPdfFiles(side, files) {
  pdfState[`files${side}`] = files;
  const list = $(`#report${side}FileList`);
  list.innerHTML = files.map((file) => `<span class="file-chip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`).join('');
  const ready = pdfState.filesA.length && pdfState.filesB.length;
  $('#compareBtn').disabled = !ready;
  $('#pdfStatusHint').textContent = ready ? `${pdfState.filesA.length} arquivo(s) no Relatório 1 e ${pdfState.filesB.length} no Relatório 2.` : 'Estou esperando pelo menos um PDF em cada campo.';
}

$('#compareBtn').addEventListener('click', comparePdfs);
$('#pdfSearchInput').addEventListener('input', (event) => { pdfState.search = normalize(event.target.value); renderPdfTable(); });
$$('[data-pdf-filter]').forEach((button) => button.addEventListener('click', () => { pdfState.filter = button.dataset.pdfFilter; $$('[data-pdf-filter]').forEach((b) => b.classList.toggle('active', b.dataset.pdfFilter === pdfState.filter)); renderPdfTable(); }));
$('#pdfExportBtn').addEventListener('click', exportPdfCsv);
$('#pdfPrintBtn').addEventListener('click', () => window.print());

async function comparePdfs() {
  $('#pdfProgress').classList.remove('hidden'); $('#pdfResults').classList.add('hidden'); $('#compareBtn').disabled = true;
  try {
    const total = pdfState.filesA.length + pdfState.filesB.length; let done = 0;
    const readGroup = async (files, side) => {
      const docs = [];
      for (const file of files) {
        updatePdfProgress(done / total, `Lendo ${file.name}`);
        const text = await extractPdfText(file);
        docs.push({ fileName: file.name, side, text }); done += 1; await yieldBrowser();
      }
      return docs;
    };
    const docsA = await readGroup(pdfState.filesA, 'A');
    const docsB = await readGroup(pdfState.filesB, 'B');
    updatePdfProgress(.86, 'Organizando registros e comparando os dois lados');
    const rowsA = docsA.flatMap((doc) => recordsFromText(doc.text, doc.fileName, 'A'));
    const rowsB = docsB.flatMap((doc) => recordsFromText(doc.text, doc.fileName, 'B'));
    pdfState.records = matchRecords(rowsA, rowsB);
    updatePdfProgress(1, 'Conferência concluída');
    renderPdfResults(rowsA, rowsB);
  } catch (error) {
    showToast(`Não foi possível comparar: ${error.message}`, true);
  } finally { $('#compareBtn').disabled = false; }
}

function updatePdfProgress(ratio, detail) {
  const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  $('#pdfProgressPercent').textContent = `${value}%`; $('#pdfProgressBar').style.width = `${value}%`; $('#pdfProgressDetail').textContent = detail;
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error('A biblioteca de leitura de PDF não carregou. Verifique a internet e atualize a página.');
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = pdfItemsToLines(content.items).join('\n');
    if (normalize(text).length < 35 && window.Tesseract) {
      const viewport = page.getViewport({ scale: 1.55 });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const result = await Tesseract.recognize(canvas, 'por', { logger: () => {} }); text = result.data.text || text;
    }
    pages.push(text);
  }
  return pages.join('\n');
}

function pdfItemsToLines(items) {
  const fragments = (items || []).filter((item) => String(item.str || '').trim()).map((item) => ({
    text: String(item.str || '').trim(),
    x: Number(item.transform?.[4] || 0),
    y: Number(item.transform?.[5] || 0),
    width: Number(item.width || 0)
  })).sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);
  const rows = [];
  fragments.forEach((fragment) => {
    let row = rows.find((candidate) => Math.abs(candidate.y - fragment.y) <= 2.5);
    if (!row) { row = { y: fragment.y, items: [] }; rows.push(row); }
    row.items.push(fragment);
  });
  return rows.sort((a, b) => b.y - a.y).map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let previousEnd = null;
    row.items.forEach((item) => {
      const gap = previousEnd == null ? 0 : item.x - previousEnd;
      if (line && gap > 1.5) line += ' ';
      line += item.text;
      previousEnd = item.x + item.width;
    });
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

const PDF_DATE_SOURCE = String.raw`(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})`;
const PDF_MONEY_SOURCE = String.raw`-?(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2}|\.\d{2})`;

function detectPdfReportType(text) {
  const content = normalize(text);
  if (content.includes('acompanhamento de entradas') && content.includes('valor contabil')) return 'entries';
  if (content.includes('governo do estado de mato grosso do sul') && content.includes('total nf')) return 'sefaz-ms';
  if (content.includes('pagamento nf-e') || content.includes('pagamento nfs-e')) return 'cashbook';
  return 'generic';
}

function normalizeInvoiceNumber(value) {
  const digits = onlyDigits(value).replace(/^0+/, '');
  return digits || (onlyDigits(value) ? '0' : '');
}

function getMoneyMatches(text) {
  const regex = new RegExp(PDF_MONEY_SOURCE, 'gi');
  return [...String(text || '').matchAll(regex)].map((match) => ({ raw: match[0], index: match.index || 0, value: parseLocaleNumber(match[0]) }));
}

function buildLogicalPdfLines(text) {
  const physical = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dateRegex = new RegExp(PDF_DATE_SOURCE, 'i');
  const moneyRegex = new RegExp(PDF_MONEY_SOURCE, 'i');
  const candidates = [];
  physical.forEach((line, index) => {
    if (!dateRegex.test(line)) return;
    let merged = line;
    for (let offset = 1; offset <= 2 && !moneyRegex.test(merged) && physical[index + offset]; offset++) merged += ` ${physical[index + offset]}`;
    candidates.push(merged.replace(/\s+/g, ' ').trim());
  });
  return [...new Set(candidates)];
}

function cleanDescription(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^[-–—|:]+|[-–—|:]+$/g, '').trim();
}

function makePdfRecord({ side, fileName, identifier, description, date, value, raw, document = '', confidence = 50, extraction = 'generic' }) {
  const note = normalizeInvoiceNumber(identifier);
  if (!note || value == null) return null;
  return {
    side,
    fileName,
    identifier: note,
    description: cleanDescription(description) || 'Fornecedor não identificado',
    date: date || '',
    value: Math.abs(value),
    raw,
    document: onlyDigits(document),
    confidence,
    extraction
  };
}

function parseSefazMsLine(line, fileName, side) {
  const regex = new RegExp(`(\\d{11,14})\\s+(\\d{1,12})\\s+(${PDF_DATE_SOURCE})\\s+(?:[A-Z]{2}\\s+)?(${PDF_MONEY_SOURCE})(?:\\s|$)`, 'i');
  const match = line.match(regex);
  if (!match) return null;
  const prefix = line.slice(0, match.index || 0).replace(/^\s*\d{7,14}\s+/, '');
  return makePdfRecord({ side, fileName, identifier: match[2], description: prefix, date: match[3], value: parseLocaleNumber(match[4]), raw: line, document: match[1], confidence: 96, extraction: 'sefaz-ms' });
}

function parseEntriesLine(line, fileName, side) {
  const dateMatch = line.match(new RegExp(PDF_DATE_SOURCE, 'i'));
  if (!dateMatch) return null;
  const afterDate = line.slice((dateMatch.index || 0) + dateMatch[0].length);
  const noteMatch = afterDate.match(/^\s*(\d{1,12})\b/);
  if (!noteMatch) return null;
  const afterNote = afterDate.slice((noteMatch.index || 0) + noteMatch[0].length);
  const moneyMatches = getMoneyMatches(afterNote);
  if (!moneyMatches.length) return null;
  let supplierPart = afterNote.replace(/^\s*\d+\s+\d+\s+/, '');
  const cfopIndex = supplierPart.search(/\s+\d[-.]\d{3}\s+/);
  if (cfopIndex >= 0) supplierPart = supplierPart.slice(0, cfopIndex);
  else supplierPart = supplierPart.slice(0, moneyMatches[0].index);
  return makePdfRecord({ side, fileName, identifier: noteMatch[1], description: supplierPart, date: dateMatch[0], value: moneyMatches[0].value, raw: line, confidence: 96, extraction: 'entries' });
}

function parseCashbookLine(line, fileName, side) {
  const dateMatch = line.match(new RegExp(PDF_DATE_SOURCE, 'i'));
  if (!dateMatch) return null;
  const afterDate = line.slice((dateMatch.index || 0) + dateMatch[0].length);
  const noteMatch = afterDate.match(/^\s*(\d{1,12})\b/);
  if (!noteMatch) return null;
  const afterNote = afterDate.slice((noteMatch.index || 0) + noteMatch[0].length);
  const moneyMatches = getMoneyMatches(afterNote);
  if (!moneyMatches.length) return null;
  const paymentMatch = line.match(/PAGAMENTO\s+NFS?-?E\s+\d{1,12}\s+(.+)$/i);
  const documentMatches = [...line.matchAll(/\b\d{11,14}\b/g)];
  return makePdfRecord({ side, fileName, identifier: noteMatch[1], description: paymentMatch?.[1] || line, date: dateMatch[0], value: Math.abs(moneyMatches[0].value), raw: line, document: documentMatches.at(-1)?.[0] || '', confidence: 92, extraction: 'cashbook' });
}

function parseGenericPdfLine(line, fileName, side) {
  const dateMatch = line.match(new RegExp(PDF_DATE_SOURCE, 'i'));
  if (!dateMatch) return null;
  const beforeDate = line.slice(0, dateMatch.index || 0);
  const afterDate = line.slice((dateMatch.index || 0) + dateMatch[0].length);
  const afterNote = afterDate.match(/^\s*(\d{1,12})\b/);
  const beforeNumbers = [...beforeDate.matchAll(/\b\d{1,12}\b/g)].filter((match) => ![11, 14].includes(match[0].length));
  const identifier = afterNote?.[1] || beforeNumbers.at(-1)?.[0] || '';
  if (!identifier) return null;
  const moneyMatches = getMoneyMatches(afterNote ? afterDate.slice((afterNote.index || 0) + afterNote[0].length) : afterDate);
  const fallbackMoney = getMoneyMatches(line);
  const chosenMoney = moneyMatches[0] || fallbackMoney.at(-1);
  if (!chosenMoney) return null;
  const documentMatches = [...line.matchAll(/\b\d{11,14}\b/g)];
  return makePdfRecord({ side, fileName, identifier, description: line, date: dateMatch[0], value: Math.abs(chosenMoney.value), raw: line, document: documentMatches.at(-1)?.[0] || '', confidence: 45, extraction: 'generic-date-line' });
}

const INVOICE_ANCHOR_REGEX = /\b(?:NFS?\s*-?\s*E|NF\s*-?\s*E|NF|NOTA(?:\s+FISCAL)?|N[ÚU]MERO\s+(?:DA\s+)?NOTA)\s*(?:N[º°O.]*)?\s*[:#\-]?\s*(\d{1,15})\b/gi;
const VALUE_LABEL_SOURCE = String.raw`(?:valor\s+cont[aá]bil|valor\s+(?:total\s+)?(?:da\s+)?nota|valor\s+total|total\s+(?:da\s+)?nf(?:s?-?e)?|vlr\.?\s*(?:da\s+)?nota|valor\s+do\s+documento|valor\s+l[ií]quido)`;

function extractDateFromContext(text) {
  return String(text || '').match(new RegExp(PDF_DATE_SOURCE, 'i'))?.[0] || '';
}

function moneyCandidatesWithDistance(text, referenceIndex = 0) {
  return getMoneyMatches(text).map((item) => ({
    ...item,
    distance: Math.abs(item.index - referenceIndex)
  }));
}

function findInvoiceValue(lines, lineIndex, anchorEnd) {
  const line = lines[lineIndex] || '';
  const windows = [
    { text: line, offset: 0, confidenceBase: 82 },
    { text: lines[lineIndex + 1] || '', offset: 1, confidenceBase: 68 },
    { text: lines[lineIndex + 2] || '', offset: 2, confidenceBase: 62 },
    { text: lines[lineIndex - 1] || '', offset: -1, confidenceBase: 58 }
  ].filter((item) => item.text);

  // Primeiro procura rótulos claros, como "Valor da Nota", "Valor Contábil" ou "Total NF".
  for (const window of windows) {
    const explicitRegex = new RegExp(`${VALUE_LABEL_SOURCE}\\s*[:=-]?\\s*(${PDF_MONEY_SOURCE})`, 'i');
    const explicit = window.text.match(explicitRegex);
    if (explicit) {
      return {
        value: parseLocaleNumber(explicit[1]),
        confidence: window.offset === 0 ? 100 : 94,
        extraction: 'invoice-anchor-explicit-value',
        context: window.text
      };
    }
  }

  // Sem rótulo, usa o primeiro valor monetário depois do número da NF na mesma linha.
  const afterAnchor = line.slice(anchorEnd);
  const afterValues = getMoneyMatches(afterAnchor);
  if (afterValues.length) {
    return {
      value: afterValues[0].value,
      confidence: 86,
      extraction: 'invoice-anchor-same-line-after',
      context: line
    };
  }

  // Caso o valor esteja antes da NF na mesma linha, escolhe o mais próximo do número.
  const sameLineValues = moneyCandidatesWithDistance(line, anchorEnd).sort((a, b) => a.distance - b.distance);
  if (sameLineValues.length) {
    return {
      value: sameLineValues[0].value,
      confidence: 74,
      extraction: 'invoice-anchor-same-line-nearest',
      context: line
    };
  }

  // Por último, busca o primeiro valor nas duas linhas seguintes.
  for (const window of windows.filter((item) => item.offset > 0)) {
    const values = getMoneyMatches(window.text);
    if (values.length) {
      return {
        value: values[0].value,
        confidence: window.confidenceBase,
        extraction: 'invoice-anchor-near-line',
        context: window.text
      };
    }
  }
  return null;
}

function recordsFromInvoiceAnchors(text, fileName, side) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const records = [];
  lines.forEach((line, lineIndex) => {
    const regex = new RegExp(INVOICE_ANCHOR_REGEX.source, 'gi');
    for (const match of line.matchAll(regex)) {
      const matchIndex = match.index || 0;
      const prefix = normalize(line.slice(Math.max(0, matchIndex - 40), matchIndex));
      const nextCharacter = line.slice(matchIndex + match[0].length, matchIndex + match[0].length + 1);
      // Evita interpretar rótulos de valor (ex.: "Valor da Nota: 900,00" ou "Total NF-e: 1.250,00") como se fossem outra nota.
      if (/(?:valor(?:\s+total)?(?:\s+da|\s+de)?|vlr(?:\s+da)?|total|chave(?:\s+de\s+acesso)?(?:\s+da|\s+de)?)\s*$/.test(prefix)) continue;
      // Se o número capturado continua com ponto ou vírgula, trata-se de um valor monetário, não de número de NF.
      if (/[.,]/.test(nextCharacter)) continue;
      const identifier = match[1];
      const valueResult = findInvoiceValue(lines, lineIndex, matchIndex + match[0].length);
      if (!valueResult || valueResult.value == null) continue;
      const context = [lines[lineIndex - 1], line, lines[lineIndex + 1]].filter(Boolean).join(' | ');
      const documentMatches = [...context.matchAll(/\b\d{11,14}\b/g)];
      const record = makePdfRecord({
        side,
        fileName,
        identifier,
        description: valueResult.context || context,
        date: extractDateFromContext(context),
        value: valueResult.value,
        raw: context,
        document: documentMatches.at(-1)?.[0] || '',
        confidence: valueResult.confidence,
        extraction: valueResult.extraction
      });
      if (record) records.push(record);
    }
  });
  return records;
}

function selectBestRecords(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const key = `${record.fileName}|${record.identifier}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });

  const selected = [];
  grouped.forEach((group) => {
    // Agrupa candidatos pelo valor. Um valor encontrado repetidamente ganha confiança extra.
    const byValue = new Map();
    group.forEach((record) => {
      const valueKey = record.value.toFixed(2);
      if (!byValue.has(valueKey)) byValue.set(valueKey, []);
      byValue.get(valueKey).push(record);
    });
    const ranked = [...byValue.values()].map((sameValue) => {
      const best = [...sameValue].sort((a, b) => b.confidence - a.confidence)[0];
      const score = best.confidence + Math.min(12, (sameValue.length - 1) * 4);
      return { best, score, occurrences: sameValue.length };
    }).sort((a, b) => b.score - a.score || b.best.confidence - a.best.confidence);
    if (ranked[0]) selected.push(ranked[0].best);
  });
  return selected;
}

function recordsFromText(text, fileName, side) {
  const reportType = detectPdfReportType(text);
  const lines = buildLogicalPdfLines(text);
  const parser = reportType === 'sefaz-ms' ? parseSefazMsLine : reportType === 'entries' ? parseEntriesLine : reportType === 'cashbook' ? parseCashbookLine : parseGenericPdfLine;
  const rowRecords = lines.map((line) => parser(line, fileName, side)).filter(Boolean);
  const anchoredRecords = recordsFromInvoiceAnchors(text, fileName, side);
  return selectBestRecords([...anchoredRecords, ...rowRecords]).slice(0, 5000);
}

function parseLocaleNumber(value) {
  if (value == null || value === '') return null;
  let text = String(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (text.includes(',') && text.includes('.')) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  else if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  text = text.replace(/[^0-9.-]/g, ''); const number = Number(text); return Number.isFinite(number) ? number : null;
}

function similarity(a, b) {
  const left = new Set(normalize(a).split(' ').filter((x) => x.length > 2)); const right = new Set(normalize(b).split(' ').filter((x) => x.length > 2));
  if (!left.size || !right.size) return 0; let intersection = 0; left.forEach((word) => { if (right.has(word)) intersection += 1; });
  return intersection / Math.max(left.size, right.size);
}

function chooseBestSameNoteMatch(record, candidates, usedIndexes) {
  let best = null;
  candidates.forEach((candidate, index) => {
    if (usedIndexes.has(index)) return;
    const difference = record.value == null || candidate.value == null ? Number.POSITIVE_INFINITY : Math.abs(record.value - candidate.value);
    const sameDocument = record.document && candidate.document && record.document === candidate.document ? 1 : 0;
    const supplierScore = similarity(record.description, candidate.description);
    const score = (difference <= 0.01 ? 1000 : 0) + sameDocument * 100 + supplierScore * 10 - Math.min(difference, 999999) / 1000000;
    if (!best || score > best.score) best = { candidate, index, difference, score };
  });
  return best;
}

function matchRecords(rowsA, rowsB) {
  const byA = new Map(); const byB = new Map();
  rowsA.forEach((row) => { if (!byA.has(row.identifier)) byA.set(row.identifier, []); byA.get(row.identifier).push(row); });
  rowsB.forEach((row) => { if (!byB.has(row.identifier)) byB.set(row.identifier, []); byB.get(row.identifier).push(row); });
  const keys = [...new Set([...byA.keys(), ...byB.keys()])].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const output = [];
  keys.forEach((identifier) => {
    const groupA = byA.get(identifier) || [];
    const groupB = byB.get(identifier) || [];
    const duplicate = groupA.length > 1 || groupB.length > 1;
    const usedB = new Set();
    groupA.forEach((a) => {
      const best = chooseBestSameNoteMatch(a, groupB, usedB);
      if (!best) {
        output.push({ status: 'missing-b', a, b: null, duplicate, reason: `NF ${a.identifier} não está no Relatório 2.` });
        return;
      }
      usedB.add(best.index);
      const sameValue = best.difference <= 0.01;
      output.push({
        status: sameValue ? 'ok' : 'divergent',
        a,
        b: best.candidate,
        duplicate,
        difference: Number.isFinite(best.difference) ? best.difference : null,
        reason: sameValue ? `NF ${a.identifier} localizada no outro relatório com o mesmo valor.` : `NF ${a.identifier} localizada nos dois relatórios, mas o valor está diferente: ${money.format(a.value)} no Relatório 1 e ${money.format(best.candidate.value)} no Relatório 2.`
      });
    });
    groupB.forEach((b, index) => {
      if (!usedB.has(index)) output.push({ status: 'missing-a', a: null, b, duplicate, reason: `NF ${b.identifier} não está no Relatório 1.` });
    });
  });
  return output;
}

function renderPdfResults(rowsA, rowsB) {
  const rows = pdfState.records; const ok = rows.filter((r) => r.status === 'ok').length; const divergent = rows.filter((r) => r.status === 'divergent').length; const missing = rows.filter((r) => r.status.startsWith('missing')).length; const duplicate = rows.filter((r) => r.duplicate).length;
  $('#pdfTotalCount').textContent = rows.length; $('#pdfOkCount').textContent = ok; $('#pdfDivergentCount').textContent = divergent; $('#pdfMissingCount').textContent = missing; $('#pdfDuplicateCount').textContent = duplicate;
  $('#pdfResultSubtitle').textContent = `${rowsA.length} registros extraídos do Relatório 1 e ${rowsB.length} do Relatório 2.`;
  $('#pdfValidationPanel').innerHTML = `<strong>Regra usada pelo Conferinho:</strong> ele lê cada NF, identifica seu valor e procura esse mesmo número em qualquer lugar do outro relatório. Se encontrar a NF com o mesmo valor, marca como conferida. Se encontrar a NF com outro valor, marca como divergente. Se não encontrar o número, marca como ausente.`;
  $('#pdfResults').classList.remove('hidden'); renderPdfTable(); $('#pdfResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPdfTable() {
  const tbody = $('#pdfResultsBody'); tbody.innerHTML = '';
  const rows = pdfState.records.filter((row) => {
    const filterOk = pdfState.filter === 'all' || (pdfState.filter === 'missing' && row.status.startsWith('missing')) || (pdfState.filter === 'duplicate' ? row.duplicate : row.status === pdfState.filter);
    const searchable = normalize([row.a?.identifier,row.b?.identifier,row.a?.description,row.b?.description,row.a?.fileName,row.b?.fileName,row.reason].join(' '));
    return filterOk && (!pdfState.search || searchable.includes(pdfState.search));
  });
  rows.forEach((row) => {
    const source = row.a || row.b; const labelMap = { ok: 'Conferido', divergent: 'Valor divergente', 'missing-a': 'Não está no Rel. 1', 'missing-b': 'Não está no Rel. 2' };
    const classMap = { ok: 'status-ok', divergent: 'status-divergent', 'missing-a': 'status-missing', 'missing-b': 'status-missing' };
    const supplierA = row.a?.description || '';
    const supplierB = row.b?.description || '';
    const supplierText = supplierA && supplierB && normalize(supplierA) !== normalize(supplierB) ? `${supplierA} / ${supplierB}` : supplierA || supplierB || 'Fornecedor não identificado';
    const duplicateLabel = row.duplicate ? `<span class="status-badge status-duplicate">Nota repetida</span>` : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="status-badge ${classMap[row.status]}">${labelMap[row.status]}</span>${duplicateLabel}</td><td><strong>${escapeHtml(source?.identifier || '—')}</strong></td><td><span class="comparison-reason">${escapeHtml(row.reason || '')}</span><span class="comparison-supplier">${escapeHtml(supplierText)}</span></td><td>${escapeHtml(row.a?.date || '—')}</td><td>${escapeHtml(row.b?.date || '—')}</td><td class="align-right">${row.a?.value == null ? '—' : money.format(row.a.value)}</td><td class="align-right">${row.b?.value == null ? '—' : money.format(row.b.value)}</td><td><span class="file-name">${escapeHtml([row.a?.fileName,row.b?.fileName].filter(Boolean).join(' / '))}</span></td>`;
    tbody.appendChild(tr);
  });
  $('#pdfEmptyResults').classList.toggle('hidden', rows.length > 0); tbody.parentElement.classList.toggle('hidden', rows.length === 0);
}

function exportPdfCsv() {
  if (!pdfState.records.length) return showToast('Faça uma comparação antes de exportar.', true);
  const rows = [['Situação','Número da nota','Resultado da comparação','Fornecedor Relatório 1','Fornecedor Relatório 2','Data Relatório 1','Data Relatório 2','Valor Relatório 1','Valor Relatório 2','Diferença','Nota repetida','Arquivo Relatório 1','Arquivo Relatório 2']];
  pdfState.records.forEach((r) => rows.push([r.status,r.a?.identifier||r.b?.identifier||'',r.reason||'',r.a?.description||'',r.b?.description||'',r.a?.date||'',r.b?.date||'',r.a?.value?.toFixed(2).replace('.',',')||'',r.b?.value?.toFixed(2).replace('.',',')||'',r.difference?.toFixed(2).replace('.',',')||'',r.duplicate?'Sim':'Não',r.a?.fileName||'',r.b?.fileName||'']));
  downloadCsv(`conferinho-comparacao-${new Date().toISOString().slice(0,10)}.csv`, rows);
}

function resetPdf() {
  pdfState.filesA=[];pdfState.filesB=[];pdfState.records=[];pdfState.filter='all';pdfState.search='';
  $('#reportAInput').value='';$('#reportBInput').value='';$('#reportAFileList').innerHTML='';$('#reportBFileList').innerHTML='';$('#pdfSearchInput').value='';$('#pdfResults').classList.add('hidden');$('#pdfProgress').classList.add('hidden');$('#compareBtn').disabled=true;$('#pdfStatusHint').textContent='Estou esperando pelo menos um PDF em cada campo.';showToast('Comparação limpa.');
}

bindDropzone($('#nfseDropzone'), $('#nfseInput'), (f) => /\.xml$/i.test(f.name), setNfseFiles);
function setNfseFiles(files) {
  nfseState.files = files;
  $('#nfseAnalyzeBtn').disabled = !files.length;
  $('#nfseQueueText').innerHTML = files.length ? `<strong>${files.length} XML(s) selecionado(s)</strong><span>Prontos para análise.</span>` : '<strong>Nenhum XML selecionado</strong><span>Você pode mandar muitos arquivos de uma vez.</span>';
  $('#nfseFileList').innerHTML = files.slice(0,30).map((file) => `<span class="file-chip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`).join('') + (files.length > 30 ? `<span class="file-chip">+${files.length-30} arquivos</span>` : '');
}
$('#nfseAnalyzeBtn').addEventListener('click', analyzeNfse);
$('#nfseSearchInput').addEventListener('input', (event) => { nfseState.search = normalize(event.target.value); renderNfseTable(); });
$$('[data-nfse-filter]').forEach((button) => button.addEventListener('click', () => { nfseState.filter = button.dataset.nfseFilter; $$('[data-nfse-filter]').forEach((b) => b.classList.toggle('active', b.dataset.nfseFilter === nfseState.filter)); renderNfseTable(); }));
$('#nfseExportBtn').addEventListener('click', exportNfseCsv); $('#nfsePrintBtn').addEventListener('click', () => window.print());

async function analyzeNfse() {
  if (!nfseState.files.length) return;
  nfseState.notes=[];nfseState.warnings=[];nfseState.processed=0;nfseState.failed=0;
  $('#nfseProgress').classList.remove('hidden');$('#nfseResults').classList.add('hidden');$('#nfseAnalyzeBtn').disabled=true;
  for (let index=0;index<nfseState.files.length;index++) {
    const file=nfseState.files[index];$('#nfseProgressDetail').textContent=`Lendo ${file.name}`;
    try { const notes=parseNfseXml(await file.text(),file.name); if(!notes.length){nfseState.failed++;nfseState.warnings.push(`${file.name}: nenhuma NFS-e reconhecida.`);} else {nfseState.processed++;nfseState.notes.push(...notes);} }
    catch(error){nfseState.failed++;nfseState.warnings.push(`${file.name}: ${error.message}.`);}
    const percent=Math.round(((index+1)/nfseState.files.length)*100);$('#nfseProgressPercent').textContent=`${percent}%`;$('#nfseProgressBar').style.width=`${percent}%`;await yieldBrowser();
  }
  $('#nfseProgressTitle').textContent='Análise concluída';$('#nfseProgressDetail').textContent=`${nfseState.notes.length} NFS-e identificada(s).`;$('#nfseAnalyzeBtn').disabled=false;renderNfseResults();
}

function parseNfseXml(text,fileName) {
  const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw new Error('XML inválido ou malformado');
  let containers=findElements(xml,['InfNfse','infNFSe','infNfse']);
  if(!containers.length){const notes=findElements(xml,['Nfse','NFSe']).filter((node)=>!hasAncestor(node,['Nfse','NFSe']));containers=notes.length?notes:[xml.documentElement];}
  return containers.map((node,index)=>extractNfse(node,fileName,index+1)).filter((note)=>note.serviceValue!==null||note.number!=='Não identificado'||note.provider.name!=='Não identificado');
}
function findElements(root,names){const wanted=new Set(names.map((x)=>x.toLowerCase()));return [...(root?.getElementsByTagName('*')||[])].filter((el)=>wanted.has((el.localName||el.nodeName).toLowerCase()));}
function firstElement(root,names){return findElements(root,names)[0]||null;}
function firstText(root,names){return firstElement(root,names)?.textContent?.trim()||'';}
function hasAncestor(node,names){const wanted=new Set(names.map((x)=>x.toLowerCase()));let parent=node.parentElement;while(parent){if(wanted.has((parent.localName||parent.nodeName).toLowerCase()))return true;parent=parent.parentElement;}return false;}
function extractEntity(node){return{ name:firstText(node,['RazaoSocial','xNome','NomeFantasia','Nome'])||'Não identificado', document:firstText(node,['Cnpj','CNPJ','Cpf','CPF'])||''};}
function parseRetained(raw,amount){if(amount!=null&&amount>0)return true;const value=normalize(raw).toUpperCase();if(['1','S','SIM','TRUE','YES','Y','RETIDO','RETENCAO'].includes(value))return true;if(['2','N','NAO','FALSE','NO','0','NORMAL'].includes(value)||value.includes('NAO'))return false;return value.includes('RET');}
function formatDate(value){if(!value)return'Não identificada';const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})/);if(iso)return`${iso[3]}/${iso[2]}/${iso[1]}`;const compact=value.match(/^(\d{4})(\d{2})(\d{2})/);if(compact)return`${compact[3]}/${compact[2]}/${compact[1]}`;return value;}
function extractNfse(node,fileName,sequence){
  const providerNode=firstElement(node,['PrestadorServico','Prestador','emit','prest']);const customerNode=firstElement(node,['TomadorServico','Tomador','toma']);const serviceNode=firstElement(node,['Servico','serv','DPS']);const valuesNode=firstElement(serviceNode||node,['Valores','valores','valoresServico']);
  const serviceValue=parseLocaleNumber(firstText(valuesNode||serviceNode||node,['ValorServicos','ValorServico','vServ','ValorTotalServicos','valorServicos','vReceb']));
  const retainedRaw=firstText(serviceNode||node,['IssRetido','ISSRetido','issRetido','RetencaoISS','RetemISS','tpRetISSQN','indRetISSQN','indRetISS']);
  const retainedAmount=parseLocaleNumber(firstText(valuesNode||serviceNode||node,['ValorIssRetido','ValorISSRetido','vISSRet','ValorRetencaoISS','valorIssRetido','vISSQNRet']));
  const generalIss=parseLocaleNumber(firstText(valuesNode||serviceNode||node,['ValorIss','ValorISS','vISSQN','vISS','valorIss']));const retained=parseRetained(retainedRaw,retainedAmount);
  const provider=extractEntity(providerNode),customer=extractEntity(customerNode);const number=firstText(node,['Numero','NumeroNfse','NumeroNFSe','nNFSe','nNFS-e','CodigoVerificacao','nNF'])||'Não identificado';const date=formatDate(firstText(node,['DataEmissao','dhEmi','dataEmissao','Competencia','DataEmissaoNfse','dCompet']));
  const missing=[];if(serviceValue===null)missing.push('valor do serviço');if(!retainedRaw&&retainedAmount===null)missing.push('indicador de retenção');
  return{id:`${fileName}-${sequence}`,fileName,number,date,provider,customer,serviceValue,retained,issValue:retainedAmount!==null?retainedAmount:generalIss,serviceCode:firstText(serviceNode||node,['ItemListaServico','CodigoTributacaoMunicipio','CodigoServico','cTribNac','cTribMun']),municipalityCode:firstText(serviceNode||node,['CodigoMunicipio','MunicipioIncidencia','cLocIncid']),status:missing.length?`Campos não localizados: ${missing.join(', ')}`:'Leitura concluída'};
}
function renderNfseResults(){const retained=nfseState.notes.filter((n)=>n.retained);const services=retained.reduce((s,n)=>s+(n.serviceValue||0),0);const iss=retained.reduce((s,n)=>s+(n.issValue||0),0);$('#nfseFilesCount').textContent=nfseState.processed+nfseState.failed;$('#nfseFilesErrorText').textContent=nfseState.failed?`${nfseState.failed} com erro ou não reconhecido(s)`:'Nenhum erro';$('#nfseNotesCount').textContent=nfseState.notes.length;$('#nfseServicesTotal').textContent=money.format(services);$('#nfseRetainedCount').textContent=`${retained.length} nota(s) com retenção`;$('#nfseIssTotal').textContent=money.format(iss);$('#nfseResultSubtitle').textContent=`${nfseState.notes.length} nota(s) em ${nfseState.files.length} arquivo(s).`;renderNfseWarnings();renderNfseTable();$('#nfseResults').classList.remove('hidden');$('#nfseResults').scrollIntoView({behavior:'smooth',block:'start'});}
function renderNfseWarnings(){const box=$('#nfseWarnings'),list=$('#nfseWarningsList');list.innerHTML=nfseState.warnings.map((w)=>`<li>${escapeHtml(w)}</li>`).join('');box.classList.toggle('hidden',!nfseState.warnings.length);}
function renderNfseTable(){const tbody=$('#nfseResultsBody');tbody.innerHTML='';const notes=nfseState.notes.filter((note)=>{if(nfseState.filter==='retained'&&!note.retained)return false;const text=normalize([note.fileName,note.number,note.provider.name,note.provider.document,note.customer.name,note.customer.document,note.serviceCode].join(' '));return!nfseState.search||text.includes(nfseState.search);});notes.forEach((note)=>{const tr=document.createElement('tr');const statusOk=note.status==='Leitura concluída';tr.innerHTML=`<td><span class="file-name" title="${escapeHtml(note.fileName)}">${escapeHtml(note.fileName)}</span></td><td>${escapeHtml(note.number)}</td><td>${escapeHtml(note.date)}</td><td><span class="entity-name">${escapeHtml(note.provider.name)}</span><span class="entity-doc">${escapeHtml(formatDocument(note.provider.document))}</span></td><td><span class="entity-name">${escapeHtml(note.customer.name)}</span><span class="entity-doc">${escapeHtml(formatDocument(note.customer.document))}</span></td><td class="align-right">${note.serviceValue===null?'Não localizado':money.format(note.serviceValue)}</td><td><span class="status-badge ${note.retained?'status-divergent':'status-ok'}">${note.retained?'Sim':'Não'}</span></td><td class="align-right">${note.issValue===null?'Não localizado':money.format(note.issValue)}</td><td><span class="status-badge ${statusOk?'status-ok':'status-missing'}" title="${escapeHtml(note.status)}">${statusOk?'Conferido':'Atenção'}</span></td>`;tbody.appendChild(tr);});$('#nfseEmptyResults').classList.toggle('hidden',notes.length>0);tbody.parentElement.classList.toggle('hidden',notes.length===0);}
function exportNfseCsv(){const notes=nfseState.notes.filter((n)=>n.retained);if(!notes.length)return showToast('Nenhuma NFS-e com ISS retido foi encontrada.',true);const rows=[['Arquivo','Número NFS-e','Data de emissão','Prestador','Documento prestador','Tomador','Documento tomador','Valor do serviço','ISS retido','Valor do ISS','Código do serviço','Código do município','Status']];notes.forEach((n)=>rows.push([n.fileName,n.number,n.date,n.provider.name,n.provider.document,n.customer.name,n.customer.document,n.serviceValue?.toFixed(2).replace('.',',')||'',n.retained?'Sim':'Não',n.issValue?.toFixed(2).replace('.',',')||'',n.serviceCode,n.municipalityCode,n.status]));const totalServices=notes.reduce((s,n)=>s+(n.serviceValue||0),0),totalIss=notes.reduce((s,n)=>s+(n.issValue||0),0);rows.push([]);rows.push(['TOTAL','','','','','','',totalServices.toFixed(2).replace('.',','),'',totalIss.toFixed(2).replace('.',',')]);downloadCsv(`conferinho-nfse-iss-retido-${new Date().toISOString().slice(0,10)}.csv`,rows);}
function resetNfse(){nfseState.files=[];nfseState.notes=[];nfseState.warnings=[];nfseState.processed=0;nfseState.failed=0;nfseState.filter='retained';nfseState.search='';$('#nfseInput').value='';$('#nfseFileList').innerHTML='';$('#nfseSearchInput').value='';$('#nfseAnalyzeBtn').disabled=true;$('#nfseProgress').classList.add('hidden');$('#nfseResults').classList.add('hidden');$('#nfseQueueText').innerHTML='<strong>Nenhum XML selecionado</strong><span>Você pode mandar muitos arquivos de uma vez.</span>';showToast('Análise de NFS-e limpa.');}

// -----------------------------------------------------------------------------
// SOMADOR DE NFs — imagens e PDFs com revisão antes da soma
// -----------------------------------------------------------------------------
const SUM_ACCEPTED_FILE = /\.(pdf|png|jpe?g|webp)$/i;
const SUM_MONEY_PATTERN = String.raw`(?:R\$\s*)?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)[,.]\d{2}`;
const SUM_NF_PATTERN = String.raw`(?:\bNF(?:-?E|S-?E)?\b|\bNFS(?:-?E)?\b|\bNOTA(?:\s+FISCAL)?\b|\bN[ÚU]MERO\s+(?:DA\s+)?NOTA\b)\s*(?:N[º°O.]?\s*)?[:#-]?\s*([0-9][0-9.\/-]{1,18})`;

bindDropzone($('#sumDropzone'), $('#sumInput'), (file) => SUM_ACCEPTED_FILE.test(file.name), setSumFiles);

function setSumFiles(files) {
  sumState.files = files;
  $('#sumAnalyzeBtn').disabled = !files.length;
  $('#sumFileList').innerHTML = files.map((file) => `<span class="file-chip" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>`).join('');
  $('#sumQueueText').innerHTML = files.length
    ? `<strong>${files.length} arquivo(s) pronto(s)</strong><span>O Conferinho vai ler as páginas e procurar NF + valor total.</span>`
    : '<strong>Nenhum arquivo selecionado</strong><span>Use imagens nítidas e sem cortes para melhorar a leitura.</span>';
}

$('#sumAnalyzeBtn').addEventListener('click', analyzeSumFiles);
$('#sumSearchInput').addEventListener('input', (event) => { sumState.search = normalize(event.target.value); renderSumTable(); });
$$('[data-sum-filter]').forEach((button) => button.addEventListener('click', () => {
  sumState.filter = button.dataset.sumFilter;
  $$('[data-sum-filter]').forEach((item) => item.classList.toggle('active', item.dataset.sumFilter === sumState.filter));
  renderSumTable();
}));
$('#sumExportBtn').addEventListener('click', exportSumCsv);
$('#sumPrintBtn').addEventListener('click', () => window.print());
$('#sumAddBtn').addEventListener('click', addManualSumRecord);
$('#sumResultsBody').addEventListener('change', handleSumTableChange);
$('#sumResultsBody').addEventListener('click', handleSumTableClick);

async function analyzeSumFiles() {
  if (!sumState.files.length) return;
  sumState.records = [];
  sumState.warnings = [];
  sumState.pages = 0;
  $('#sumResults').classList.add('hidden');
  $('#sumProgress').classList.remove('hidden');
  $('#sumProgressTitle').textContent = 'Lendo documentos...';
  $('#sumAnalyzeBtn').disabled = true;
  updateSumProgress(0, 'Preparando arquivos');
  try {
    const output = [];
    for (let fileIndex = 0; fileIndex < sumState.files.length; fileIndex++) {
      const file = sumState.files[fileIndex];
      updateSumProgress(fileIndex / sumState.files.length, `Lendo ${file.name}`);
      try {
        const pages = /\.pdf$/i.test(file.name) ? await extractSumPdfPages(file, fileIndex) : await extractSumImage(file, fileIndex);
        sumState.pages += pages.length;
        pages.forEach((page) => output.push(...parseSumPageText(page.text, file.name, page.page, page.method)));
        if (!pages.some((page) => normalize(page.text).length > 20)) sumState.warnings.push(`${file.name}: não foi possível reconhecer texto suficiente.`);
      } catch (error) {
        sumState.warnings.push(`${file.name}: ${error.message}`);
      }
      await yieldBrowser();
    }
    sumState.records = finalizeSumRecords(output);
    if (!sumState.records.length) sumState.warnings.push('Nenhuma combinação segura de número da NF e valor foi encontrada. Você pode adicionar as notas manualmente.');
    updateSumProgress(1, `${sumState.records.length} NF(s) identificada(s)`);
    $('#sumProgressTitle').textContent = 'Leitura concluída';
    renderSumResults();
  } catch (error) {
    showToast(`Não foi possível ler os documentos: ${error.message}`, true);
  } finally {
    $('#sumAnalyzeBtn').disabled = false;
  }
}

function updateSumProgress(ratio, detail) {
  const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  $('#sumProgressPercent').textContent = `${value}%`;
  $('#sumProgressBar').style.width = `${value}%`;
  $('#sumProgressDetail').textContent = detail;
}

async function extractSumPdfPages(file, fileIndex) {
  if (!window.pdfjsLib) throw new Error('A biblioteca de PDF não carregou. Atualize a página com internet ativa.');
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const baseProgress = (fileIndex + (pageNumber - 1) / Math.max(pdf.numPages, 1)) / Math.max(sumState.files.length, 1);
    updateSumProgress(baseProgress, `${file.name} — página ${pageNumber} de ${pdf.numPages}`);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = pdfItemsToLines(content.items).join('\n');
    let method = 'Texto do PDF';
    const moneyCount = (text.match(new RegExp(SUM_MONEY_PATTERN, 'g')) || []).length;
    if ((normalize(text).length < 45 || moneyCount === 0) && window.Tesseract) {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const result = await Tesseract.recognize(canvas, 'por', {
        logger: (event) => {
          if (event.status === 'recognizing text') updateSumProgress(baseProgress, `${file.name} — OCR da página ${pageNumber}: ${Math.round((event.progress || 0) * 100)}%`);
        }
      });
      if (normalize(result.data.text).length > normalize(text).length) text = result.data.text;
      method = 'OCR da página';
    }
    pages.push({ page: pageNumber, text, method });
    await yieldBrowser();
  }
  return pages;
}

async function extractSumImage(file, fileIndex) {
  if (!window.Tesseract) throw new Error('A biblioteca de OCR não carregou. Atualize a página com internet ativa.');
  const result = await Tesseract.recognize(file, 'por', {
    logger: (event) => {
      if (event.status === 'recognizing text') {
        const overall = (fileIndex + (event.progress || 0)) / Math.max(sumState.files.length, 1);
        updateSumProgress(overall, `${file.name} — reconhecendo texto: ${Math.round((event.progress || 0) * 100)}%`);
      }
    }
  });
  return [{ page: 1, text: result.data.text || '', method: 'OCR da imagem' }];
}

function cleanSumInvoiceNumber(raw) {
  const value = onlyDigits(raw);
  if (value.length < 2 || value.length > 15) return '';
  return value.replace(/^0+(?=\d)/, '');
}

function sumMoneyCandidates(text) {
  const regex = new RegExp(SUM_MONEY_PATTERN, 'gi');
  const values = [];
  let match;
  while ((match = regex.exec(text))) {
    const value = parseLocaleNumber(match[0]);
    if (value !== null && value >= 0 && value < 1000000000000) values.push({ raw: match[0], value, index: match.index, end: regex.lastIndex });
  }
  return values;
}

function chooseSumValue(context, nfMatchEnd) {
  const candidates = sumMoneyCandidates(context);
  if (!candidates.length) return null;
  const normalized = normalize(context);
  const labels = ['valor total da nf', 'valor total', 'total da nota', 'valor da nota', 'total nf', 'vlr total', 'valor nf'];
  let labelIndex = -1;
  labels.forEach((label) => { labelIndex = Math.max(labelIndex, normalized.lastIndexOf(label)); });
  if (labelIndex >= 0) {
    const afterLabel = candidates.find((item) => item.index >= labelIndex);
    if (afterLabel) return { ...afterLabel, confidence: 'confirmed', reason: 'Valor localizado próximo ao campo de total' };
  }
  const afterNf = candidates.filter((item) => item.index >= nfMatchEnd);
  const pool = afterNf.length ? afterNf : candidates;
  const selected = pool[pool.length - 1];
  return { ...selected, confidence: candidates.length === 1 ? 'confirmed' : 'review', reason: candidates.length === 1 ? 'Único valor ligado à nota' : 'A linha possui mais de um valor; confira o total selecionado' };
}

function inferSumInvoiceNumber(line, firstMoneyIndex) {
  const beforeMoney = line.slice(0, Math.max(0, firstMoneyIndex));
  const masked = beforeMoney
    .replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/-]?\d{4}-?\d{2}\b/g, ' ')
    .replace(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}-?\d{2}\b/g, ' ')
    .replace(/\b\d{20,}\b/g, ' ');
  const tokens = [...masked.matchAll(/\b\d{2,15}\b/g)].map((match) => cleanSumInvoiceNumber(match[0])).filter(Boolean);
  return tokens[tokens.length - 1] || '';
}


function sumExplicitMatches(line) {
  const regex = new RegExp(SUM_NF_PATTERN, 'gi');
  return [...String(line || '').matchAll(regex)].filter((match) => {
    const prefix = normalize(String(line || '').slice(Math.max(0, match.index - 24), match.index));
    return !/(?:total|valor|vlr|soma)(?:\s+(?:da|de|do))?\s*$/.test(prefix);
  });
}

function parseSumPageText(text, fileName, page, method) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const records = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const normalizedLine = normalize(line);
    if (/\b(total geral|subtotal geral|soma total|quantidade de notas|qtd.? notas)\b/.test(normalizedLine)) continue;

    const allMatches = sumExplicitMatches(line);

    if (allMatches.length) {
      allMatches.forEach((nfMatch, matchIndex) => {
        const nf = cleanSumInvoiceNumber(nfMatch[1]);
        if (!nf) return;
        const nextStart = allMatches[matchIndex + 1]?.index ?? line.length;
        let segment = line.slice(nfMatch.index, nextStart).trim();
        if (!sumMoneyCandidates(segment).length) {
          for (let lookAhead = 1; lookAhead <= 2; lookAhead++) {
            const nextLine = lines[index + lookAhead] || '';
            if (!nextLine || sumExplicitMatches(nextLine).length) break;
            segment += ` ${nextLine}`;
            if (sumMoneyCandidates(segment).length) break;
          }
        }
        const valueInfo = chooseSumValue(segment, nfMatch[0].length);
        if (!valueInfo) return;
        records.push({
          id: `sum-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          nf,
          value: valueInfo.value,
          fileName,
          page,
          method,
          include: true,
          status: valueInfo.confidence,
          note: valueInfo.reason,
          raw: segment.slice(0, 260)
        });
      });
      continue;
    }

    const moneyValues = sumMoneyCandidates(line);
    if (!moneyValues.length) continue;
    if (!/\d/.test(line) || normalizedLine.includes('cnpj') || normalizedLine.includes('cpf')) continue;
    const nf = inferSumInvoiceNumber(line, moneyValues[0].index);
    if (!nf) continue;
    const valueInfo = chooseSumValue(line, 0);
    if (!valueInfo) continue;
    records.push({
      id: `sum-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nf,
      value: valueInfo.value,
      fileName,
      page,
      method,
      include: true,
      status: 'review',
      note: 'NF inferida pela posição na linha; confirme número e valor',
      raw: line.slice(0, 260)
    });
  }
  return records;
}

function finalizeSumRecords(records) {
  const exactSeen = new Set();
  const unique = [];
  records.forEach((record) => {
    const exactKey = `${record.fileName}|${record.page}|${record.nf}|${Number(record.value).toFixed(2)}`;
    if (exactSeen.has(exactKey)) return;
    exactSeen.add(exactKey);
    unique.push(record);
  });
  const byNf = new Map();
  unique.forEach((record) => {
    if (!byNf.has(record.nf)) byNf.set(record.nf, []);
    byNf.get(record.nf).push(record);
  });
  byNf.forEach((group) => {
    if (group.length <= 1) return;
    group.forEach((record, index) => {
      record.status = 'review';
      record.note = index === 0 ? 'Esta NF apareceu mais de uma vez; confira as linhas repetidas' : 'Possível duplicidade: linha desmarcada automaticamente';
      if (index > 0) record.include = false;
    });
  });
  return unique.sort((a, b) => Number(a.nf) - Number(b.nf) || a.fileName.localeCompare(b.fileName));
}

function renderSumResults() {
  $('#sumResultSubtitle').textContent = `${sumState.records.length} linha(s) identificada(s) em ${sumState.files.length} arquivo(s). Revise as marcações antes de usar o total.`;
  renderSumWarnings();
  renderSumTable();
  $('#sumResults').classList.remove('hidden');
  $('#sumResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function sumFilteredRecords() {
  return sumState.records.filter((record) => {
    const filterOk = sumState.filter === 'all'
      || (sumState.filter === 'included' && record.include)
      || (sumState.filter === 'excluded' && !record.include)
      || (sumState.filter === 'review' && record.status === 'review');
    const searchable = normalize([record.nf, record.fileName, record.raw, record.note].join(' '));
    return filterOk && (!sumState.search || searchable.includes(sumState.search));
  });
}

function renderSumTable() {
  const tbody = $('#sumResultsBody');
  tbody.innerHTML = '';
  sumFilteredRecords().forEach((record) => {
    const tr = document.createElement('tr');
    tr.className = record.include ? '' : 'sum-row-excluded';
    const statusLabel = record.status === 'confirmed' ? 'Reconhecida' : record.status === 'manual' ? 'Manual' : 'Revisar';
    const statusClass = record.status === 'confirmed' ? 'status-ok' : record.status === 'manual' ? 'status-duplicate' : 'status-divergent';
    tr.innerHTML = `<td><label class="sum-check"><input type="checkbox" data-sum-action="include" data-id="${escapeHtml(record.id)}" ${record.include ? 'checked' : ''}><span>Somar</span></label></td><td><span class="status-badge ${statusClass}" title="${escapeHtml(record.note)}">${statusLabel}</span><small class="sum-method">${escapeHtml(record.method)}</small></td><td><input class="sum-edit sum-nf-input" data-sum-action="nf" data-id="${escapeHtml(record.id)}" value="${escapeHtml(record.nf)}" inputmode="numeric" aria-label="Número da NF"></td><td class="align-right"><input class="sum-edit sum-value-input" data-sum-action="value" data-id="${escapeHtml(record.id)}" value="${escapeHtml(formatSumInputValue(record.value))}" inputmode="decimal" aria-label="Valor total da NF"></td><td><span class="file-name" title="${escapeHtml(record.fileName)}">${escapeHtml(record.fileName)}</span><small class="sum-method">Página ${escapeHtml(record.page)}</small></td><td><span class="sum-raw" title="${escapeHtml(record.raw)}">${escapeHtml(record.raw)}</span></td><td><button class="sum-delete" data-sum-action="delete" data-id="${escapeHtml(record.id)}" type="button" title="Excluir linha">×</button></td>`;
    tbody.appendChild(tr);
  });
  const visible = sumFilteredRecords().length;
  $('#sumEmptyResults').classList.toggle('hidden', visible > 0);
  tbody.parentElement.classList.toggle('hidden', visible === 0);
  updateSumSummary();
}

function formatSumInputValue(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace('.', ',') : '';
}

function updateSumSummary() {
  const included = sumState.records.filter((record) => record.include && Number.isFinite(Number(record.value)));
  const total = included.reduce((sum, record) => sum + Number(record.value), 0);
  const review = sumState.records.filter((record) => record.status === 'review').length;
  $('#sumPagesCount').textContent = sumState.pages || sumState.files.length;
  $('#sumFilesCountText').textContent = `${sumState.files.length} arquivo(s)`;
  $('#sumNotesCount').textContent = included.length;
  $('#sumReviewCount').textContent = review;
  $('#sumGrandTotal').textContent = money.format(total);
}

function renderSumWarnings() {
  const box = $('#sumWarnings');
  const warnings = [...sumState.warnings];
  if (sumState.records.some((record) => record.status === 'review')) warnings.push('Existem linhas marcadas como “Revisar”. Confira o número e o valor antes de usar o total.');
  $('#sumWarningsList').innerHTML = [...new Set(warnings)].map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
  box.classList.toggle('hidden', warnings.length === 0);
}

function handleSumTableChange(event) {
  const action = event.target.dataset.sumAction;
  const id = event.target.dataset.id;
  if (!action || !id) return;
  const record = sumState.records.find((item) => item.id === id);
  if (!record) return;
  if (action === 'include') record.include = event.target.checked;
  if (action === 'nf') {
    record.nf = cleanSumInvoiceNumber(event.target.value) || event.target.value.trim();
    record.status = record.status === 'manual' ? 'manual' : 'review';
    record.note = 'Número alterado manualmente';
  }
  if (action === 'value') {
    const value = parseLocaleNumber(event.target.value);
    if (value === null) return showToast('Digite um valor válido, por exemplo 1.250,90.', true);
    record.value = value;
    record.status = record.status === 'manual' ? 'manual' : 'review';
    record.note = 'Valor alterado manualmente';
  }
  renderSumTable();
  renderSumWarnings();
}

function handleSumTableClick(event) {
  const button = event.target.closest('[data-sum-action="delete"]');
  if (!button) return;
  sumState.records = sumState.records.filter((record) => record.id !== button.dataset.id);
  renderSumTable();
  renderSumWarnings();
}

function addManualSumRecord() {
  const record = {
    id: `sum-manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    nf: '',
    value: 0,
    fileName: 'Adicionado manualmente',
    page: '—',
    method: 'Digitação manual',
    include: true,
    status: 'manual',
    note: 'Linha adicionada manualmente',
    raw: 'Preencha o número da NF e o valor total'
  };
  sumState.records.unshift(record);
  $('#sumResults').classList.remove('hidden');
  renderSumTable();
  setTimeout(() => $('#sumResultsBody .sum-nf-input')?.focus(), 0);
}

function exportSumCsv() {
  const records = sumState.records.filter((record) => record.include && Number.isFinite(Number(record.value)));
  if (!records.length) return showToast('Nenhuma NF está marcada para entrar na soma.', true);
  const total = records.reduce((sum, record) => sum + Number(record.value), 0);
  const rows = [['Número da NF', 'Valor total', 'Arquivo', 'Página', 'Forma de leitura', 'Situação', 'Observação', 'Trecho reconhecido']];
  records.forEach((record) => rows.push([record.nf, Number(record.value).toFixed(2).replace('.', ','), record.fileName, record.page, record.method, record.status === 'confirmed' ? 'Reconhecida' : record.status === 'manual' ? 'Manual' : 'Revisar', record.note, record.raw]));
  rows.push([]);
  rows.push(['TOTAL DAS NFs', total.toFixed(2).replace('.', ',')]);
  downloadCsv(`conferinho-soma-nfs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function resetSum() {
  sumState.files = [];
  sumState.records = [];
  sumState.warnings = [];
  sumState.pages = 0;
  sumState.filter = 'all';
  sumState.search = '';
  $('#sumInput').value = '';
  $('#sumFileList').innerHTML = '';
  $('#sumSearchInput').value = '';
  $('#sumAnalyzeBtn').disabled = true;
  $('#sumProgress').classList.add('hidden');
  $('#sumResults').classList.add('hidden');
  $('#sumQueueText').innerHTML = '<strong>Nenhum arquivo selecionado</strong><span>Use imagens nítidas e sem cortes para melhorar a leitura.</span>';
  showToast('Somador de NFs limpo.');
}

