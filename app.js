"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pdfState = { filesA: [], filesB: [], records: [], filter: "all", search: "", labels: { A: "SEFAZ", B: "Domínio" }, metrics: null };
const nfseState = { files: [], notes: [], warnings: [], processed: 0, failed: 0, filter: "retained", search: "" };
const sumState = { files: [], records: [], warnings: [], pages: 0, filter: "all", search: "" };

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const moduleCopy = {
  pdf: {
    title: 'A <span>SEFAZ é a base</span>. O Domínio precisa bater.',
    text: "Envie a base oficial da SEFAZ. Eu procuro cada NF no Domínio, somo os desdobramentos e mostro por que a escrituração não está batendo.",
    benefits: ["SEFAZ como fonte oficial", "Domínio auditado por NF", "Causa provável e ação"],
    mascot: "Eu parto da SEFAZ, audito o Domínio e mostro onde investigar cada diferença."
  },
  nfse: {
    title: 'O <span>Conferinho</span> também analisa suas NFS-e.',
    text: "Envie vários XMLs de NFS-e. Eu encontro as notas com retenção de ISS e preparo o total dos serviços e do imposto retido.",
    benefits: ["Vários XMLs de uma vez", "Soma dos serviços retidos", "Relatório em CSV"],
    mascot: "Pode mandar os XMLs que eu separo as retenções."
  },
  sum: {
    title: 'Cole a tabela e o <span>Conferinho</span> soma a coluna Total NF.',
    text: "Copie o print do relatório e pressione Ctrl + V. Eu removo a grade, leio cada linha, identifico o Nº NF e somo somente o Total NF.",
    benefits: ["Lê Nº NF + Total NF", "Vários prints na mesma fila", "Total e relatório revisável"],
    mascot: "Pode colar a tabela: eu leio cada NF e somo a coluna Total NF."
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
  $('#pdfStatusHint').textContent = ready ? `Base SEFAZ com ${pdfState.filesA.length} PDF(s) e escrituração Domínio com ${pdfState.filesB.length} PDF(s) prontas para auditoria.` : 'Envie a base oficial da SEFAZ e o relatório de entradas do Domínio.';
}

$('#compareBtn').addEventListener('click', comparePdfs);
$('#pdfSearchInput').addEventListener('input', (event) => { pdfState.search = normalize(event.target.value); renderPdfTable(); });
$$('[data-pdf-filter]').forEach((button) => button.addEventListener('click', () => { pdfState.filter = button.dataset.pdfFilter; $$('[data-pdf-filter]').forEach((b) => b.classList.toggle('active', b.dataset.pdfFilter === pdfState.filter)); renderPdfTable(); }));
$('#pdfExportBtn').addEventListener('click', exportPdfCsv);
$('#pdfCopySummaryBtn').addEventListener('click', copyPdfExecutiveSummary);
$('#pdfPrintBtn').addEventListener('click', () => window.print());

async function comparePdfs() {
  pdfState.labels.A = 'SEFAZ';
  pdfState.labels.B = 'Domínio';
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
    updatePdfProgress(.86, 'Montando a base oficial da SEFAZ e localizando cada NF no Domínio');
    const rawRowsA = docsA.flatMap((doc) => recordsFromText(doc.text, doc.fileName, 'A'));
    const rawRowsB = docsB.flatMap((doc) => recordsFromText(doc.text, doc.fileName, 'B'));
    updatePdfProgress(.92, 'Somando desdobramentos do Domínio e investigando as diferenças');
    const rowsA = consolidatePdfRecords(rawRowsA, 'A');
    const rowsB = consolidatePdfRecords(rawRowsB, 'B');
    pdfState.records = enrichPdfDecisions(matchRecords(rowsA, rowsB), rowsA, rowsB, rawRowsA, rawRowsB);
    updatePdfProgress(1, 'Auditoria do Domínio concluída com diagnóstico das pendências');
    renderPdfResults(rowsA, rowsB, rawRowsA, rawRowsB);
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

function makePdfRecord({ side, fileName, identifier, description, date, value, raw, document = '', series = '', confidence = 50, extraction = 'generic' }) {
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
    series: String(series || '').replace(/[^0-9A-Za-z-]/g, '').trim(),
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
  const metadataMatch = afterNote.match(/^\s*(\d{1,4})\s+\d{1,3}\s+\d{1,3}\s+/);
  const series = metadataMatch?.[1] || '';
  let supplierPart = afterNote.replace(/^\s*\d+\s+\d+\s+\d+\s+/, '').replace(/^\s*\d+\s+\d+\s+/, '');
  const cfopIndex = supplierPart.search(/\s+\d[-.]\d{3}\s+/);
  if (cfopIndex >= 0) supplierPart = supplierPart.slice(0, cfopIndex);
  else supplierPart = supplierPart.slice(0, moneyMatches[0].index);
  const documentMatches = [...line.matchAll(/\d{11,14}/g)];
  return makePdfRecord({ side, fileName, identifier: noteMatch[1], description: supplierPart, date: dateMatch[0], value: moneyMatches[0].value, raw: line, document: documentMatches.at(-1)?.[0] || '', series, confidence: 96, extraction: 'entries' });
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
    const key = [
      record.fileName,
      record.identifier,
      record.date,
      record.value?.toFixed(2),
      record.document,
      record.series
    ].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  });
  return [...grouped.values()].map((group) => [...group].sort((a, b) => b.confidence - a.confidence)[0]);
}

function recordsFromText(text, fileName, side) {
  const reportType = detectPdfReportType(text);
  const lines = buildLogicalPdfLines(text);
  const parser = reportType === 'sefaz-ms' ? parseSefazMsLine : reportType === 'entries' ? parseEntriesLine : reportType === 'cashbook' ? parseCashbookLine : parseGenericPdfLine;
  const rowRecords = lines.map((line) => parser(line, fileName, side)).filter(Boolean);
  const anchoredRecords = recordsFromInvoiceAnchors(text, fileName, side);

  // Nos relatórios tabulares, cada linha representa um lançamento real. Mantemos todas as
  // linhas, inclusive quando a mesma NF aparece com valores diferentes. Os registros por
  // âncora entram somente como complemento quando o leitor tabular não encontrou a linha.
  if (rowRecords.length) {
    const supplemental = selectBestRecords(anchoredRecords).filter((anchor) => !rowRecords.some((row) =>
      row.identifier === anchor.identifier &&
      Math.abs((row.value || 0) - (anchor.value || 0)) <= 0.01 &&
      (!row.date || !anchor.date || row.date === anchor.date)
    ));
    return [...rowRecords, ...supplemental].slice(0, 5000);
  }
  return selectBestRecords(anchoredRecords).slice(0, 5000);
}

function meaningfulSupplierText(value) {
  return normalize(value)
    .replace(/\b(?:ltda|me|eireli|sa|s a|icms|iss|valor|total|nota|fiscal|relatorio|pagina|cfop|modelo|serie)\b/g, ' ')
    .replace(/\b\d+[.,/-]?\d*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canJoinConsolidationCluster(record, cluster) {
  const representative = cluster[0];
  if (record.document && representative.document && record.document !== representative.document) return false;
  if (record.series && representative.series && record.series !== representative.series) return false;
  const left = meaningfulSupplierText(record.description);
  const right = meaningfulSupplierText(representative.description);
  if (left && right && left.length >= 5 && right.length >= 5 && similarity(left, right) < 0.18) return false;
  return true;
}

function consolidatePdfRecords(records, side) {
  const byInvoice = new Map();
  records.forEach((record) => {
    if (!byInvoice.has(record.identifier)) byInvoice.set(record.identifier, []);
    byInvoice.get(record.identifier).push(record);
  });

  const consolidated = [];
  byInvoice.forEach((invoiceRecords, identifier) => {
    const clusters = [];
    [...invoiceRecords].sort((a, b) => (a.document || '').localeCompare(b.document || '') || (a.series || '').localeCompare(b.series || '') || (a.date || '').localeCompare(b.date || '')).forEach((record) => {
      const cluster = clusters.find((candidate) => canJoinConsolidationCluster(record, candidate));
      if (cluster) cluster.push(record); else clusters.push([record]);
    });

    clusters.forEach((components, clusterIndex) => {
      const representative = [...components].sort((a, b) => b.confidence - a.confidence)[0];
      const values = components.map((item) => Number(item.value || 0));
      const uniqueFiles = [...new Set(components.map((item) => item.fileName).filter(Boolean))];
      const uniqueDates = [...new Set(components.map((item) => item.date).filter(Boolean))];
      const uniqueDocuments = [...new Set(components.map((item) => item.document).filter(Boolean))];
      const uniqueSeries = [...new Set(components.map((item) => item.series).filter(Boolean))];
      const identicalSignatureCount = new Map();
      components.forEach((item) => {
        const signature = [item.value?.toFixed(2), item.date, meaningfulSupplierText(item.description)].join('|');
        identicalSignatureCount.set(signature, (identicalSignatureCount.get(signature) || 0) + 1);
      });
      const hasIdenticalComponents = [...identicalSignatureCount.values()].some((count) => count > 1);
      consolidated.push({
        ...representative,
        side,
        identifier,
        value: Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100,
        fileName: uniqueFiles.join(' + '),
        date: uniqueDates.length === 1 ? uniqueDates[0] : uniqueDates.join(', '),
        document: uniqueDocuments.length === 1 ? uniqueDocuments[0] : representative.document || '',
        series: uniqueSeries.length === 1 ? uniqueSeries[0] : representative.series || '',
        components: components.map((item, index) => ({
          id: `${side}-${identifier}-${clusterIndex}-${index}`,
          value: item.value,
          date: item.date,
          fileName: item.fileName,
          description: item.description,
          document: item.document,
          series: item.series,
          raw: item.raw
        })),
        componentCount: components.length,
        consolidated: components.length > 1,
        hasIdenticalComponents,
        confidence: Math.min(...components.map((item) => Number(item.confidence || 0))),
        consolidationKey: `${identifier}|${uniqueDocuments.join(',')}|${uniqueSeries.join(',')}|${clusterIndex}`
      });
    });
  });
  return consolidated.sort((a, b) => Number(a.identifier) - Number(b.identifier) || a.identifier.localeCompare(b.identifier));
}

function parseLocaleNumber(value) {
  if (value == null || value === '') return null;
  let text = String(value).replace(/R\$/gi, '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length > 2 && parts.at(-1).length === 2 ? `${parts.slice(0, -1).join('')}.${parts.at(-1)}` : text.replace(/\./g, '').replace(',', '.');
  } else if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length > 2 && parts.at(-1).length === 2) text = `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
  }
  text = text.replace(/[^0-9.-]/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
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
    const conflictingDocument = record.document && candidate.document && record.document !== candidate.document ? 1 : 0;
    const sameSeries = record.series && candidate.series && record.series === candidate.series ? 1 : 0;
    const conflictingSeries = record.series && candidate.series && record.series !== candidate.series ? 1 : 0;
    const supplierScore = similarity(record.description, candidate.description);
    const score = (difference <= 0.01 ? 1000 : 0) + sameDocument * 160 + sameSeries * 60 + supplierScore * 25 - conflictingDocument * 400 - conflictingSeries * 120 - Math.min(difference, 999999) / 1000000;
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
    // Depois da consolidação, mais de um grupo com o mesmo número indica possível conflito
    // de fornecedor/série — isso é diferente de uma NF apenas desdobrada em várias linhas.
    const duplicate = groupA.length > 1 || groupB.length > 1;
    const usedB = new Set();
    groupA.forEach((a) => {
      const best = chooseBestSameNoteMatch(a, groupB, usedB);
      if (!best) {
        output.push({ status: 'missing-b', a, b: null, duplicate, grouped: !!a.consolidated, reason: `NF ${a.identifier} consta na SEFAZ, mas não está no Domínio.` });
        return;
      }
      usedB.add(best.index);
      const sameValue = best.difference <= 0.01;
      const grouped = !!(a.consolidated || best.candidate.consolidated);
      output.push({
        status: sameValue ? 'ok' : 'divergent',
        a,
        b: best.candidate,
        duplicate,
        grouped,
        difference: Number.isFinite(best.difference) ? best.difference : null,
        reason: sameValue
          ? grouped
            ? `NF ${a.identifier} da SEFAZ foi conferida após somar os lançamentos desdobrados do Domínio.`
            : `NF ${a.identifier} da SEFAZ foi localizada no Domínio com o mesmo valor.`
          : grouped
            ? `NF ${a.identifier} foi consolidada, mas o total está diferente: ${money.format(a.value)} na SEFAZ e ${money.format(best.candidate.value)} no Domínio.`
            : `NF ${a.identifier} existe na SEFAZ e no Domínio, mas os valores estão diferentes: ${money.format(a.value)} na SEFAZ e ${money.format(best.candidate.value)} no Domínio.`
      });
    });
    groupB.forEach((b, index) => {
      if (!usedB.has(index)) output.push({ status: 'missing-a', a: null, b, duplicate, grouped: !!b.consolidated, reason: `NF ${b.identifier} está escriturada no Domínio, mas não possui correspondência na base SEFAZ.` });
    });
  });
  return output;
}

function formatSignedMoney(value) {
  if (Math.abs(value) <= 0.009) return money.format(0);
  return `${value > 0 ? '+' : '−'} ${money.format(Math.abs(value))}`;
}

function pdfStatusLabel(status, grouped = false) {
  if (grouped && status === 'ok') return 'Correta após soma';
  if (grouped && status === 'divergent') return 'Valor incorreto após soma';
  return ({
    ok: 'Escriturada corretamente',
    divergent: 'Valor incorreto no Domínio',
    'missing-a': 'Lançamento extra no Domínio',
    'missing-b': 'Não escriturada no Domínio'
  })[status] || status;
}

function pdfPriorityLabel(priority) {
  return ({ critical: 'Crítica', high: 'Alta', medium: 'Revisar', ok: 'Conferida' })[priority] || 'Revisar';
}

function buildPdfCause(row) {
  if (row.status === 'missing-b') return 'A NF oficial não foi localizada na escrituração.';
  if (row.status === 'missing-a') return 'Existe um lançamento no Domínio sem correspondência na base SEFAZ.';
  if (row.status === 'divergent') {
    const sefaz = row.a?.value || 0;
    const dominio = row.b?.value || 0;
    return dominio > sefaz
      ? 'O valor escriturado no Domínio ficou maior que o valor oficial.'
      : 'O valor escriturado no Domínio ficou menor que o valor oficial.';
  }
  if (row.duplicate) return 'O mesmo número de NF apareceu em grupos que podem pertencer a documentos diferentes.';
  if (row.exactComponentDuplicate) return 'Há lançamentos idênticos dentro da composição, com risco de duplicidade.';
  if (row.lowConfidence) return 'A leitura automática desta NF teve baixa confiança.';
  if (row.grouped) return 'O Domínio dividiu a NF em vários lançamentos, mas a soma ficou correta.';
  return 'A NF oficial foi encontrada no Domínio com o mesmo valor.';
}

function buildPdfChecklist(row) {
  if (row.status === 'missing-b') return [
    'Confirmar se o XML ou a nota foi importado no Domínio.',
    'Verificar competência, filtros, empresa e modelo do documento.',
    'Pesquisar número, série e CNPJ antes de escriturar manualmente.'
  ];
  if (row.status === 'missing-a') return [
    'Confirmar se o lançamento pertence ao mesmo período e à mesma empresa.',
    'Verificar número digitado, série, CNPJ e possível nota cancelada.',
    'Validar o XML antes de manter ou excluir o lançamento do Domínio.'
  ];
  if (row.status === 'divergent') {
    const sefaz = row.a?.value || 0;
    const dominio = row.b?.value || 0;
    if (dominio > sefaz) return [
      'Abrir a composição e procurar lançamento duplicado ou soma em dobro.',
      'Conferir acréscimos, frete, descontos e o campo Valor Contábil.',
      'Comparar o total do XML com o valor consolidado no Domínio.'
    ];
    return [
      'Abrir a composição e procurar lançamento, parcela ou item faltante.',
      'Conferir descontos indevidos e o campo Valor Contábil.',
      'Reimportar ou complementar a escrituração se o XML estiver correto.'
    ];
  }
  if (row.duplicate) return [
    'Separar os registros por CNPJ, série e fornecedor.',
    'Evitar somar documentos diferentes que possuem o mesmo número.',
    'Confirmar manualmente qual grupo corresponde à NF da SEFAZ.'
  ];
  if (row.exactComponentDuplicate) return [
    'Comparar data, valor e fornecedor dos lançamentos repetidos.',
    'Confirmar se são desdobramentos legítimos ou duplicidade real.',
    'Excluir somente depois de validar o documento original.'
  ];
  if (row.lowConfidence) return [
    'Abrir o PDF e confirmar visualmente número, série e valor.',
    'Gerar o relatório novamente com melhor qualidade, se necessário.',
    'Não corrigir o Domínio antes de validar a leitura.'
  ];
  return ['Nenhuma correção necessária.'];
}

function buildPdfAction(row) {
  const valueSefaz = row.a?.value || 0;
  const valueDominio = row.b?.value || 0;
  const difference = Math.abs(valueDominio - valueSefaz);
  let action = '';

  if (row.status === 'missing-b') {
    action = `Localize a NF no Domínio. Se ela não tiver sido importada e o documento for válido, importe ou escriture ${money.format(valueSefaz)} e registre a causa da ausência.`;
  } else if (row.status === 'missing-a') {
    action = `Valide por que ${money.format(valueDominio)} está escriturado sem aparecer na base SEFAZ. Mantenha somente após confirmar XML, período e situação da nota.`;
  } else if (row.status === 'divergent') {
    const consolidationNote = row.grouped ? 'A soma dos desdobramentos já foi considerada. ' : '';
    action = valueDominio > valueSefaz
      ? `${consolidationNote}Reduza ou corrija ${money.format(difference)} no Domínio depois de identificar duplicidade, acréscimo ou valor contábil indevido.`
      : `${consolidationNote}Localize os ${money.format(difference)} que faltam no Domínio e corrija lançamento parcial, desconto ou falha de importação.`;
  } else if (row.duplicate) {
    action = 'Identifique o documento correto pelo CNPJ e pela série antes de consolidar ou corrigir qualquer valor.';
  } else if (row.exactComponentDuplicate) {
    action = 'Confirme se a repetição é um desdobramento legítimo. Se não for, remova o lançamento duplicado no Domínio.';
  } else if (row.lowConfidence) {
    action = 'Revise a linha no PDF antes de tomar qualquer decisão fiscal.';
  } else if (row.grouped) {
    action = 'Nenhuma correção necessária: a soma dos lançamentos do Domínio reproduziu o valor oficial da SEFAZ.';
  } else {
    action = 'Nenhuma correção necessária: a NF da SEFAZ está corretamente escriturada no Domínio.';
  }

  if (row.duplicate && row.status !== 'ok') action = `Antes da correção, separe os grupos pelo CNPJ e pela série. ${action}`;
  if (row.exactComponentDuplicate && row.status !== 'ok') action += ' Revise também os lançamentos idênticos da composição.';
  if (row.lowConfidence && row.status !== 'ok') action += ' Confirme primeiro se o número e o valor foram lidos corretamente.';
  return action;
}
function enrichPdfDecisions(records, rowsA, rowsB, rawRowsA = rowsA, rawRowsB = rowsB) {
  const totalA = rawRowsA.reduce((sum, row) => sum + (row.value || 0), 0);
  const totalB = rawRowsB.reduce((sum, row) => sum + (row.value || 0), 0);
  const base = Math.max(totalA, 1);
  const criticalThreshold = Math.max(1000, base * 0.01);
  const enriched = records.map((row, index) => {
    const valueA = row.a?.value || 0;
    const valueB = row.b?.value || 0;
    const impact = row.status === 'divergent' ? Math.abs(valueB - valueA) : row.status === 'missing-b' ? valueA : row.status === 'missing-a' ? valueB : 0;
    const signedDifference = valueB - valueA;
    const confidences = [row.a?.confidence, row.b?.confidence].filter((value) => Number.isFinite(value));
    const confidence = confidences.length ? Math.min(...confidences) : 0;
    const lowConfidence = confidence < 65;
    const exactComponentDuplicate = !!(row.a?.hasIdenticalComponents || row.b?.hasIdenticalComponents);
    const grouped = !!(row.grouped || row.a?.consolidated || row.b?.consolidated);
    const needsAction = row.status !== 'ok' || row.duplicate || exactComponentDuplicate || lowConfidence;
    let priority = 'ok';
    if (row.status === 'missing-b') priority = impact >= criticalThreshold ? 'critical' : 'high';
    else if (row.status === 'divergent') priority = impact >= criticalThreshold ? 'critical' : 'high';
    else if (row.status === 'missing-a') priority = impact >= criticalThreshold ? 'high' : 'medium';
    else if (row.duplicate || exactComponentDuplicate) priority = 'high';
    else if (lowConfidence) priority = 'medium';
    const enrichedRow = {
      ...row,
      grouped,
      exactComponentDuplicate,
      id: `pdf-${Date.now()}-${index}-${row.a?.identifier || row.b?.identifier || index}`,
      impact,
      signedDifference,
      confidence,
      lowConfidence,
      needsAction,
      priority,
      resolved: false,
      note: ''
    };
    enrichedRow.cause = buildPdfCause(enrichedRow);
    enrichedRow.checklist = buildPdfChecklist(enrichedRow);
    enrichedRow.action = buildPdfAction(enrichedRow);
    return enrichedRow;
  });

  const baseRows = enriched.filter((row) => !!row.a);
  const correctBaseRows = baseRows.filter((row) => row.status === 'ok' && !row.needsAction);
  const locatedBaseRows = baseRows.filter((row) => !!row.b);
  const missingInDomainRows = enriched.filter((row) => row.status === 'missing-b');
  const divergentRows = enriched.filter((row) => row.status === 'divergent');
  const extraDomainRows = enriched.filter((row) => row.status === 'missing-a');
  const correctRate = rowsA.length ? (correctBaseRows.length / rowsA.length) * 100 : 0;
  const locatedRate = rowsA.length ? (locatedBaseRows.length / rowsA.length) * 100 : 0;
  const reconciledSefazValue = correctBaseRows.reduce((sum, row) => sum + (row.a?.value || 0), 0);
  const valueCorrectRate = totalA ? (reconciledSefazValue / totalA) * 100 : 0;

  pdfState.metrics = {
    totalA,
    totalB,
    rowsA: rawRowsA.length,
    rowsB: rawRowsB.length,
    consolidatedA: rowsA.length,
    consolidatedB: rowsB.length,
    groupedA: rowsA.filter((row) => row.consolidated).length,
    groupedB: rowsB.filter((row) => row.consolidated).length,
    groupedRowsA: rawRowsA.length - rowsA.length,
    groupedRowsB: rawRowsB.length - rowsB.length,
    netDifference: totalB - totalA,
    missingOnlyA: missingInDomainRows.reduce((sum, row) => sum + row.impact, 0),
    missingOnlyB: extraDomainRows.reduce((sum, row) => sum + row.impact, 0),
    divergentSigned: divergentRows.reduce((sum, row) => sum + row.signedDifference, 0),
    divergentImpact: divergentRows.reduce((sum, row) => sum + row.impact, 0),
    baseNfs: rowsA.length,
    domainNfs: rowsB.length,
    correctBaseCount: correctBaseRows.length,
    locatedBaseCount: locatedBaseRows.length,
    missingInDomainCount: missingInDomainRows.length,
    divergentCount: divergentRows.length,
    extraDomainCount: extraDomainRows.length,
    correctRate,
    locatedRate,
    reconciledSefazValue,
    valueCorrectRate,
    criticalThreshold
  };
  return enriched;
}

function filteredPdfRows() {
  const priorityRank = { critical: 0, high: 1, medium: 2, ok: 3 };
  const diagnosisRank = (row) => row.status === 'missing-b' ? 0 : row.status === 'divergent' ? 1 : row.status === 'missing-a' ? 2 : (row.duplicate || row.exactComponentDuplicate || row.lowConfidence) ? 3 : 4;
  return pdfState.records.filter((row) => {
    let filterOk = false;
    if (pdfState.filter === 'all') filterOk = true;
    else if (pdfState.filter === 'missing') filterOk = row.status.startsWith('missing');
    else if (pdfState.filter === 'grouped') filterOk = row.grouped;
    else if (pdfState.filter === 'duplicate') filterOk = row.duplicate || row.exactComponentDuplicate;
    else if (pdfState.filter === 'pending') filterOk = row.needsAction && !row.resolved;
    else if (pdfState.filter === 'critical') filterOk = row.priority === 'critical' && !row.resolved;
    else if (pdfState.filter === 'resolved') filterOk = row.resolved;
    else if (pdfState.filter === 'ok') filterOk = !row.needsAction;
    else filterOk = row.status === pdfState.filter;
    const componentText = [...(row.a?.components || []), ...(row.b?.components || [])].map((item) => [item.value, item.date, item.fileName, item.description, item.series].join(' ')).join(' ');
    const searchable = normalize([row.a?.identifier,row.b?.identifier,row.a?.description,row.b?.description,row.a?.fileName,row.b?.fileName,row.reason,row.cause,row.action,(row.checklist || []).join(' '),row.note,componentText].join(' '));
    return filterOk && (!pdfState.search || searchable.includes(pdfState.search));
  }).sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return diagnosisRank(a) - diagnosisRank(b) || (priorityRank[a.priority] - priorityRank[b.priority]) || (b.impact - a.impact) || Number((a.a || a.b)?.identifier || 0) - Number((b.a || b.b)?.identifier || 0);
  });
}

function renderPdfResults(rowsA, rowsB, rawRowsA = rowsA, rawRowsB = rowsB) {
  const groupedB = rowsB.filter((row) => row.consolidated).length;
  $('#pdfResultSubtitle').textContent = `A base oficial contém ${rowsA.length} NF(s). O Domínio contém ${rowsB.length} NF(s) consolidadas a partir de ${rawRowsB.length} lançamento(s); ${groupedB} NF(s) do Domínio precisaram de soma automática.`;
  $('#pdfValidationPanel').innerHTML = `<strong>Regra desta conciliação:</strong> cada NF da SEFAZ é tratada como uma obrigação de escrituração. O Conferinho procura essa NF no Domínio, soma os desdobramentos e classifica o resultado. Itens que existem somente no Domínio aparecem como verificação complementar, pois não possuem correspondência na base oficial.`;
  refreshPdfDecisionDashboard();
  $('#pdfResults').classList.remove('hidden');
  renderPdfTable();
  $('#pdfResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function refreshPdfDecisionDashboard() {
  const rows = pdfState.records;
  const metrics = pdfState.metrics || { totalA: 0, totalB: 0, rowsA: 0, rowsB: 0, netDifference: 0, missingOnlyA: 0, missingOnlyB: 0, divergentSigned: 0, baseNfs: 0, correctBaseCount: 0, correctRate: 0, missingInDomainCount: 0, divergentCount: 0, extraDomainCount: 0 };
  const correctBase = rows.filter((row) => row.a && row.status === 'ok' && !row.needsAction).length;
  const divergent = rows.filter((row) => row.status === 'divergent').length;
  const missingInDomain = rows.filter((row) => row.status === 'missing-b').length;
  const groupedDomain = rows.filter((row) => row.b?.consolidated).length;
  const resolved = rows.filter((row) => row.needsAction && row.resolved).length;
  const actionRows = rows.filter((row) => row.needsAction);
  const pendingRows = actionRows.filter((row) => !row.resolved);
  const criticalRows = pendingRows.filter((row) => row.priority === 'critical');
  const openImpact = pendingRows.reduce((sum, row) => sum + row.impact, 0);
  const reviewRows = pendingRows.filter((row) => row.lowConfidence).length;
  const extraDomain = rows.filter((row) => row.status === 'missing-a').length;

  $('#pdfTotalCount').textContent = metrics.baseNfs ?? 0;
  $('#pdfOkCount').textContent = correctBase;
  $('#pdfDivergentCount').textContent = divergent;
  $('#pdfMissingCount').textContent = missingInDomain;
  const extraCounter = $('#pdfExtraCount');
  if (extraCounter) extraCounter.textContent = extraDomain;
  const groupedCounter = $('#pdfGroupedCount');
  if (groupedCounter) groupedCounter.textContent = groupedDomain;
  $('#pdfPendingCount').textContent = pendingRows.length;
  $('#pdfResolvedCount').textContent = `${resolved} resolvida(s)`;
  $('#pdfPendingBadge').textContent = `${pendingRows.length} pendência(s)`;

  $('#pdfTotalALabel').textContent = 'Base oficial da SEFAZ';
  $('#pdfTotalBLabel').textContent = 'Total escriturado no Domínio';
  $('#pdfTotalAValue').textContent = money.format(metrics.totalA);
  $('#pdfTotalBValue').textContent = money.format(metrics.totalB);
  $('#pdfTotalARecords').textContent = `${metrics.baseNfs || 0} NF(s) oficiais em ${metrics.rowsA || 0} linha(s)`;
  $('#pdfTotalBRecords').textContent = `${metrics.rowsB || 0} lançamento(s) → ${metrics.domainNfs || 0} NF(s); ${extraDomain} extra(s)`;
  $('#pdfNetDifference').textContent = `${(metrics.correctRate || 0).toFixed(1).replace('.', ',')}%`;
  $('#pdfNetDirection').textContent = `${metrics.correctBaseCount || 0} de ${metrics.baseNfs || 0} NFs da SEFAZ corretas no Domínio`;
  $('#pdfOpenImpact').textContent = money.format(openImpact);
  const netCard = $('#pdfNetCard');
  netCard.classList.remove('positive','negative');
  netCard.classList.toggle('coverage-good', (metrics.correctRate || 0) >= 99.99);
  netCard.classList.toggle('coverage-warning', (metrics.correctRate || 0) < 99.99 && (metrics.correctRate || 0) >= 80);
  netCard.classList.toggle('coverage-danger', (metrics.correctRate || 0) < 80);

  const decisionCard = $('#pdfDecisionCard');
  decisionCard.classList.remove('decision-success','decision-warning','decision-danger');
  const coverageText = `${(metrics.correctRate || 0).toFixed(1).replace('.', ',')}% da base oficial está correta no Domínio`;
  if (!pendingRows.length && !actionRows.length) {
    decisionCard.classList.add('decision-success');
    $('#pdfDecisionIcon').textContent = '✓';
    $('#pdfDecisionLevel').textContent = 'ESCRITURAÇÃO CONCILIADA';
    $('#pdfDecisionTitle').textContent = 'O Domínio reproduz integralmente a base da SEFAZ.';
    $('#pdfDecisionText').textContent = `${metrics.baseNfs || 0} NF(s) oficiais foram localizadas com os valores corretos. ${groupedDomain} NF(s) precisaram de soma automática e nenhuma diferença foi encontrada.`;
    $('#pdfDecisionNext').innerHTML = '<strong>Próximo passo</strong><span>Salve o relatório como evidência da conferência e prossiga com o fechamento fiscal.</span>';
  } else if (!pendingRows.length && actionRows.length) {
    decisionCard.classList.add('decision-warning');
    $('#pdfDecisionIcon').textContent = '↻';
    $('#pdfDecisionLevel').textContent = 'PENDÊNCIAS TRATADAS — REVALIDAR';
    $('#pdfDecisionTitle').textContent = 'Todas as ocorrências foram marcadas como resolvidas.';
    $('#pdfDecisionText').textContent = `O relatório original possuía ${actionRows.length} diferença(s). Depois de corrigir o Domínio, gere um novo relatório e faça a conciliação novamente para confirmar que a base chegou a 100%.`;
    $('#pdfDecisionNext').innerHTML = '<strong>Próximo passo</strong><span>Reemita o relatório do Domínio após as correções e rode uma nova auditoria. Marcar como resolvida registra o tratamento, mas não altera os arquivos já analisados.</span>';
  } else if (criticalRows.length) {
    decisionCard.classList.add('decision-danger');
    $('#pdfDecisionIcon').textContent = '!';
    $('#pdfDecisionLevel').textContent = 'NÃO FECHAR AINDA';
    $('#pdfDecisionTitle').textContent = `${coverageText}.`;
    $('#pdfDecisionText').textContent = `Faltam ${missingInDomain} NF(s) da SEFAZ no Domínio, ${divergent} possuem valor incorreto e ${extraDomain} lançamento(s) existem somente no Domínio. Há ${money.format(openImpact)} ainda sem explicação.`;
    $('#pdfDecisionNext').innerHTML = `<strong>Ordem de investigação</strong><span>1. NFs da SEFAZ não escrituradas · 2. Valores incorretos no Domínio · 3. Duplicidades e leitura · 4. Lançamentos extras no Domínio${reviewRows ? ' · 5. Confirmar leituras incertas' : ''}</span>`;
  } else {
    decisionCard.classList.add('decision-warning');
    $('#pdfDecisionIcon').textContent = '→';
    $('#pdfDecisionLevel').textContent = 'REVISAR ANTES DO FECHAMENTO';
    $('#pdfDecisionTitle').textContent = `${coverageText}.`;
    $('#pdfDecisionText').textContent = `A escrituração ainda possui ${pendingRows.length} pendência(s): ${missingInDomain} não escriturada(s), ${divergent} com valor incorreto e ${extraDomain} extra(s) no Domínio.`;
    $('#pdfDecisionNext').innerHTML = '<strong>Próximo passo</strong><span>Abra cada ocorrência, valide a causa provável, corrija o Domínio ou documente a justificativa e marque como resolvida.</span>';
  }

  const diagnosisRank = (row) => row.status === 'missing-b' ? 0 : row.status === 'divergent' ? 1 : row.status === 'missing-a' ? 2 : 3;
  const priorityList = $('#pdfPriorityList');
  const ranked = [...pendingRows].sort((a,b) => diagnosisRank(a)-diagnosisRank(b) || ({critical:0,high:1,medium:2,ok:3}[a.priority]-({critical:0,high:1,medium:2,ok:3}[b.priority])) || b.impact-a.impact).slice(0,5);
  priorityList.innerHTML = ranked.length ? ranked.map((row) => {
    const source = row.a || row.b;
    return `<button class="priority-item priority-${row.priority}" type="button" data-focus-record="${escapeHtml(row.id)}"><span class="priority-marker"></span><span class="priority-copy"><strong>NF ${escapeHtml(source?.identifier || '—')} · ${escapeHtml(pdfStatusLabel(row.status, row.grouped))}</strong><small><b>${escapeHtml(row.cause)}</b> ${escapeHtml(row.action)}</small></span><b>${row.impact ? money.format(row.impact) : 'Revisar'}</b></button>`;
  }).join('') : '<div class="priority-empty"><span>✓</span><strong>Nenhuma ação pendente</strong><small>A escrituração do Domínio está conciliada com a base SEFAZ.</small></div>';

  $('#pdfReconciliationText').textContent = Math.abs(metrics.netDifference) <= 0.009
    ? 'Os totais gerais podem estar iguais mesmo com erros que se compensam. A composição abaixo separa o que falta no Domínio, os valores incorretos e os lançamentos sem base na SEFAZ.'
    : `O total do Domínio difere da SEFAZ em ${money.format(Math.abs(metrics.netDifference))}. A composição abaixo mostra quais tipos de ocorrência formam essa diferença.`;
  $('#pdfReconciliationEquation').innerHTML = `
    <span><small>SEFAZ não escriturada</small><b>− ${money.format(metrics.missingOnlyA)}</b></span>
    <i>+</i>
    <span><small>Valores incorretos no Domínio</small><b>${formatSignedMoney(metrics.divergentSigned)}</b></span>
    <i>+</i>
    <span><small>Lançamentos extras no Domínio</small><b>+ ${money.format(metrics.missingOnlyB)}</b></span>
    <i>=</i>
    <span class="equation-total"><small>Diferença final Domínio − SEFAZ</small><b>${formatSignedMoney(metrics.netDifference)}</b></span>`;
}

function pdfCompositionSideHtml(record, label) {
  if (!record) return `<section class="composition-side composition-missing"><h5>${escapeHtml(label)}</h5><p>NF ausente neste relatório.</p></section>`;
  const components = record.components?.length ? record.components : [record];
  const items = components.map((item, index) => {
    const meta = [item.date, item.series ? `Série ${item.series}` : '', item.fileName].filter(Boolean).join(' · ');
    return `<li><span><strong>Lançamento ${index + 1}</strong><small>${escapeHtml(meta || 'Sem detalhes adicionais')}</small></span><b>${money.format(item.value || 0)}</b></li>`;
  }).join('');
  return `<section class="composition-side"><div class="composition-head"><h5>${escapeHtml(label)}</h5><span>${components.length} lançamento(s)</span><b>${money.format(record.value || 0)}</b></div><ol>${items}</ol></section>`;
}

function renderPdfTable() {
  const tbody = $('#pdfResultsBody');
  tbody.innerHTML = '';
  const rows = filteredPdfRows();
  rows.forEach((row) => {
    const source = row.a || row.b;
    const supplierA = row.a?.description || '';
    const supplierB = row.b?.description || '';
    const supplierText = supplierA && supplierB && normalize(supplierA) !== normalize(supplierB) ? `${supplierA} / ${supplierB}` : supplierA || supplierB || 'Fornecedor não identificado';
    const statusClass = row.status === 'ok' ? 'status-ok' : row.status === 'divergent' ? 'status-divergent' : 'status-missing';
    const extraBadges = `${row.grouped ? '<span class="status-badge status-grouped">Σ Domínio consolidado</span>' : ''}${row.duplicate ? '<span class="status-badge status-duplicate">Mesmo nº em grupos diferentes</span>' : ''}${row.exactComponentDuplicate ? '<span class="status-badge status-review">Possível duplicidade</span>' : ''}${row.lowConfidence ? `<span class="status-badge status-review">Leitura ${row.confidence}%</span>` : ''}`;
    const valueA = row.a?.value == null ? '—' : money.format(row.a.value);
    const valueB = row.b?.value == null ? '—' : money.format(row.b.value);
    const countA = row.a?.componentCount || (row.a ? 1 : 0);
    const countB = row.b?.componentCount || (row.b ? 1 : 0);
    const deltaText = row.status === 'divergent' ? `Domínio − SEFAZ: ${formatSignedMoney(row.signedDifference)}` : row.status === 'ok' ? (row.grouped ? 'Soma do Domínio igual ao valor oficial' : 'Valor correto no Domínio') : row.status === 'missing-b' ? `Falta escriturar: ${money.format(row.impact)}` : `Valor sem base SEFAZ: ${money.format(row.impact)}`;
    const detailText = [row.a?.date ? `SEFAZ: ${row.a.date}` : '', row.b?.date ? `Domínio: ${row.b.date}` : '', row.a?.fileName || '', row.b?.fileName || ''].filter(Boolean).join(' · ');
    const compositionCount = countA + countB;
    const detailsContent = row.grouped
      ? `<div class="composition-grid">${pdfCompositionSideHtml(row.a, 'SEFAZ — base oficial')}${pdfCompositionSideHtml(row.b, 'Domínio — escrituração')}</div>`
      : `<span>${escapeHtml(detailText || 'Sem detalhes adicionais')}</span>`;
    const checklist = (row.checklist || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const tr = document.createElement('tr');
    tr.dataset.recordId = row.id;
    tr.classList.toggle('decision-row-resolved', row.resolved);
    tr.innerHTML = `
      <td><span class="priority-badge priority-${row.priority}">${escapeHtml(pdfPriorityLabel(row.priority))}</span></td>
      <td><span class="status-badge ${statusClass}">${escapeHtml(pdfStatusLabel(row.status, row.grouped))}</span>${extraBadges}<strong class="decision-nf">NF ${escapeHtml(source?.identifier || '—')}</strong><span class="decision-supplier" title="${escapeHtml(supplierText)}">${escapeHtml(supplierText)}</span>${source?.series ? `<small class="decision-series">Série ${escapeHtml(source.series)}</small>` : ''}</td>
      <td><div class="value-compare"><span><small>SEFAZ · deveria estar</small><b>${valueA}</b>${countA > 1 ? `<em>${countA} registros consolidados</em>` : ''}</span><span class="value-arrow">→</span><span><small>Domínio · foi escriturado</small><b>${valueB}</b>${countB > 1 ? `<em>${countB} lançamentos somados</em>` : ''}</span></div><span class="value-delta">${escapeHtml(deltaText)}</span><details class="record-details ${row.grouped ? 'composition-details' : ''}"><summary>${row.grouped ? `Ver composição (${compositionCount} registros)` : 'Ver datas e arquivos'}</summary>${detailsContent}</details></td>
      <td class="align-right"><strong class="impact-value">${row.impact ? money.format(row.impact) : '—'}</strong></td>
      <td><strong class="diagnosis-cause">${escapeHtml(row.cause || '')}</strong><span class="action-text">${escapeHtml(row.action)}</span><details class="investigation-details"><summary>O que conferir</summary><ol>${checklist}</ol></details></td>
      <td><label class="resolution-check"><input type="checkbox" data-resolve-record="${escapeHtml(row.id)}" ${row.resolved ? 'checked' : ''}/><span>${row.resolved ? 'Resolvida' : 'Pendente'}</span></label><textarea class="resolution-note" data-note-record="${escapeHtml(row.id)}" rows="2" placeholder="Registre a causa encontrada e a correção realizada">${escapeHtml(row.note || '')}</textarea></td>`;
    tbody.appendChild(tr);
  });
  $('#pdfEmptyResults').classList.toggle('hidden', rows.length > 0);
  tbody.parentElement.classList.toggle('hidden', rows.length === 0);
}

$('#pdfResultsBody').addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-resolve-record]');
  if (!checkbox) return;
  const row = pdfState.records.find((record) => record.id === checkbox.dataset.resolveRecord);
  if (!row) return;
  row.resolved = checkbox.checked;
  refreshPdfDecisionDashboard();
  if (['pending','resolved','critical'].includes(pdfState.filter)) renderPdfTable();
  else {
    const tr = checkbox.closest('tr');
    tr?.classList.toggle('decision-row-resolved', row.resolved);
    const label = checkbox.parentElement?.querySelector('span');
    if (label) label.textContent = row.resolved ? 'Resolvida' : 'Pendente';
  }
});

$('#pdfResultsBody').addEventListener('input', (event) => {
  const field = event.target.closest('[data-note-record]');
  if (!field) return;
  const row = pdfState.records.find((record) => record.id === field.dataset.noteRecord);
  if (row) row.note = field.value;
});

$('#pdfPriorityList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-focus-record]');
  if (!button) return;
  const row = pdfState.records.find((record) => record.id === button.dataset.focusRecord);
  if (!row) return;
  pdfState.filter = 'all';
  pdfState.search = normalize((row.a || row.b)?.identifier || '');
  $('#pdfSearchInput').value = (row.a || row.b)?.identifier || '';
  $$('[data-pdf-filter]').forEach((item) => item.classList.toggle('active', item.dataset.pdfFilter === 'all'));
  renderPdfTable();
  $('.table-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function buildPdfExecutiveSummary() {
  if (!pdfState.records.length || !pdfState.metrics) return '';
  const metrics = pdfState.metrics;
  const pending = pdfState.records.filter((row) => row.needsAction && !row.resolved);
  const critical = pending.filter((row) => row.priority === 'critical');
  const openImpact = pending.reduce((sum, row) => sum + row.impact, 0);
  const diagnosisRank = (row) => row.status === 'missing-b' ? 0 : row.status === 'divergent' ? 1 : row.status === 'missing-a' ? 2 : 3;
  const top = [...pending].sort((a,b) => diagnosisRank(a)-diagnosisRank(b) || b.impact-a.impact).slice(0,5);
  const lines = [
    'CONFERINHO — CONCILIAÇÃO DE ENTRADAS',
    'Base oficial: SEFAZ | Escrituração auditada: Domínio',
    '',
    `Base SEFAZ: ${money.format(metrics.totalA)} em ${metrics.baseNfs || 0} NF(s)`,
    `Total Domínio: ${money.format(metrics.totalB)} em ${metrics.domainNfs || 0} NF(s) consolidadas`,
    `Conciliação correta da base: ${(metrics.correctRate || 0).toFixed(1).replace('.', ',')}% (${metrics.correctBaseCount || 0} de ${metrics.baseNfs || 0} NFs)`,
    `Não escrituradas no Domínio: ${metrics.missingInDomainCount || 0}`,
    `Com valor incorreto: ${metrics.divergentCount || 0}`,
    `Lançamentos extras no Domínio: ${metrics.extraDomainCount || 0}`,
    `Diferença final Domínio − SEFAZ: ${formatSignedMoney(metrics.netDifference)}`,
    `Pendências abertas: ${pending.length}`,
    `Ocorrências críticas: ${critical.length}`,
    `Valor ainda sem explicação: ${money.format(openImpact)}`,
    ''
  ];
  if (!pending.length) lines.push('Conclusão: a escrituração do Domínio está conciliada com a base oficial da SEFAZ.');
  else {
    lines.push('PRIORIDADES DE INVESTIGAÇÃO:');
    top.forEach((row, index) => lines.push(`${index + 1}. NF ${(row.a || row.b)?.identifier || '—'} — ${pdfStatusLabel(row.status, row.grouped)} — ${row.impact ? money.format(row.impact) : 'revisar leitura'}. Causa provável: ${row.cause} Ação: ${row.action}`));
  }
  return lines.join('\n');
}

async function copyPdfExecutiveSummary() {
  const text = buildPdfExecutiveSummary();
  if (!text) return showToast('Faça a conciliação de entradas antes de copiar o resumo.', true);
  try {
    await navigator.clipboard.writeText(text);
    showToast('Resumo executivo copiado.');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('Resumo executivo copiado.');
  }
}


function pdfCompositionText(record) {
  if (!record) return '';
  const components = record.components?.length ? record.components : [record];
  return components.map((item, index) => `${index + 1}) ${Number(item.value || 0).toFixed(2).replace('.', ',')} | ${item.date || 'sem data'} | ${item.series ? `série ${item.series}` : 'sem série'} | ${item.fileName || ''}`).join(' ; ');
}

function exportPdfCsv() {
  if (!pdfState.records.length || !pdfState.metrics) return showToast('Faça a conciliação de entradas antes de exportar.', true);
  const m = pdfState.metrics;
  const pending = pdfState.records.filter((row) => row.needsAction && !row.resolved);
  const rows = [
    ['CONFERINHO — CONCILIAÇÃO DE ENTRADAS | DIAGNÓSTICO E PLANO DE AÇÃO'],
    ['Base oficial', 'SEFAZ'],
    ['Escrituração auditada', 'Domínio'],
    ['Total SEFAZ', m.totalA.toFixed(2).replace('.',',')],
    ['Total Domínio', m.totalB.toFixed(2).replace('.',',')],
    ['Conciliação correta da base (%)', (m.correctRate || 0).toFixed(2).replace('.',',')],
    ['NFs na base SEFAZ', m.baseNfs || 0],
    ['NFs corretas no Domínio', m.correctBaseCount || 0],
    ['Não escrituradas no Domínio', m.missingInDomainCount || 0],
    ['Com valor incorreto', m.divergentCount || 0],
    ['Extras no Domínio', m.extraDomainCount || 0],
    ['Diferença final Domínio - SEFAZ', m.netDifference.toFixed(2).replace('.',',')],
    ['Pendências abertas', pending.length],
    ['Valor ainda sem explicação', pending.reduce((sum,row)=>sum+row.impact,0).toFixed(2).replace('.',',')],
    [],
    ['Prioridade','Diagnóstico','Número da NF','Valor oficial SEFAZ','Valor escriturado Domínio','Lançamentos SEFAZ','Lançamentos Domínio','Domínio consolidado','Composição SEFAZ','Composição Domínio','Diferença / impacto','Domínio - SEFAZ','Fornecedor / descrição','Causa provável','O que conferir','Ação recomendada','Tratamento','Anotação','Confiança da leitura','Possível repetição','Data SEFAZ','Data Domínio','Arquivo SEFAZ','Arquivo Domínio']
  ];
  pdfState.records.forEach((row) => rows.push([
    pdfPriorityLabel(row.priority),
    pdfStatusLabel(row.status, row.grouped),
    row.a?.identifier || row.b?.identifier || '',
    row.a?.value?.toFixed(2).replace('.',',') || '',
    row.b?.value?.toFixed(2).replace('.',',') || '',
    row.a?.componentCount || (row.a ? 1 : 0),
    row.b?.componentCount || (row.b ? 1 : 0),
    row.b?.consolidated ? 'Sim' : 'Não',
    pdfCompositionText(row.a),
    pdfCompositionText(row.b),
    row.impact?.toFixed(2).replace('.',',') || '0,00',
    row.signedDifference?.toFixed(2).replace('.',',') || '0,00',
    row.a?.description || row.b?.description || '',
    row.cause || '',
    (row.checklist || []).join(' | '),
    row.action,
    row.resolved ? 'Resolvida' : row.needsAction ? 'Pendente' : 'Correta',
    row.note || '',
    `${row.confidence}%`,
    row.duplicate || row.exactComponentDuplicate ? 'Sim' : 'Não',
    row.a?.date || '',
    row.b?.date || '',
    row.a?.fileName || '',
    row.b?.fileName || ''
  ]));
  downloadCsv(`conferinho-conciliacao-entradas-${new Date().toISOString().slice(0,10)}.csv`, rows);
}

function resetPdf() {
  pdfState.filesA=[];pdfState.filesB=[];pdfState.records=[];pdfState.filter='all';pdfState.search='';pdfState.metrics=null;pdfState.labels={A:'SEFAZ',B:'Domínio'};
  $('#reportAInput').value='';$('#reportBInput').value='';$('#reportAFileList').innerHTML='';$('#reportBFileList').innerHTML='';$('#reportALabel').value='SEFAZ';$('#reportBLabel').value='Domínio';$('#pdfSearchInput').value='';$('#pdfResults').classList.add('hidden');$('#pdfProgress').classList.add('hidden');$('#compareBtn').disabled=true;$('#pdfStatusHint').textContent='Envie a base oficial da SEFAZ e o relatório de entradas do Domínio.';showToast('Conciliação de entradas limpa.');
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
const SUM_MONEY_PATTERN = String.raw`(?:R\$\s*)?(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)[,.]\d{2}`;
const SUM_NF_PATTERN = String.raw`(?:\bNF(?:-?E|S-?E)?\b|\bNFS(?:-?E)?\b|\bNOTA(?:\s+FISCAL)?\b|\bN[ÚU]MERO\s+(?:DA\s+)?NOTA\b)\s*(?:N[º°O.]?\s*)?[:#-]?\s*([0-9][0-9.\/-]{1,18})`;

let sumPasteCounter = 0;

bindDropzone($('#sumDropzone'), $('#sumInput'), (file) => SUM_ACCEPTED_FILE.test(file.name), (files) => addSumFiles(files, 'seleção'));

function sumFileFingerprint(file) {
  return [file.name, file.size, file.lastModified, file.type].join('|');
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Tamanho não informado';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function invalidateSumReading() {
  sumState.records = [];
  sumState.warnings = [];
  sumState.pages = 0;
  $('#sumProgress').classList.add('hidden');
  $('#sumResults').classList.add('hidden');
}

function addSumFiles(files, source = 'seleção') {
  const accepted = [...files].filter((file) => SUM_ACCEPTED_FILE.test(file.name) || file.type.startsWith('image/') || file.type === 'application/pdf');
  if (!accepted.length) return showToast('Não encontrei imagem ou PDF para adicionar.', true);

  const existing = new Set(sumState.files.map(sumFileFingerprint));
  const fresh = accepted.filter((file) => !existing.has(sumFileFingerprint(file)));
  if (!fresh.length) return showToast('Esse arquivo já está na lista.', true);

  sumState.files.push(...fresh);
  $('#sumInput').value = '';
  invalidateSumReading();
  renderSumQueue();
  showToast(`${fresh.length} ${fresh.length === 1 ? 'arquivo adicionado' : 'arquivos adicionados'} por ${source}.`);
}

function renderSumQueue() {
  const files = sumState.files;
  const list = $('#sumFileList');
  list.innerHTML = '';

  files.forEach((file, index) => {
    const card = document.createElement('article');
    card.className = 'sum-preview-card';
    card.innerHTML = `<span class="sum-preview-number">${index + 1}</span><button class="sum-preview-remove" type="button" data-sum-file-remove="${index}" aria-label="Remover ${escapeHtml(file.name)}" title="Remover arquivo">×</button><div class="sum-preview-media"></div><div class="sum-preview-info"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${escapeHtml(formatFileSize(file.size))}</span></div>`;
    const media = $('.sum-preview-media', card);
    if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) {
      const image = document.createElement('img');
      const objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      image.alt = `Prévia de ${file.name}`;
      image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
      image.addEventListener('error', () => URL.revokeObjectURL(objectUrl), { once: true });
      media.appendChild(image);
    } else {
      media.innerHTML = '<span class="sum-preview-pdf">PDF</span>';
    }
    list.appendChild(card);
  });

  $('#sumAnalyzeBtn').disabled = !files.length;
  $('#sumClearFilesBtn').classList.toggle('hidden', !files.length);
  $('#sumQueueText').innerHTML = files.length
    ? `<strong>${files.length} ${files.length === 1 ? 'arquivo pronto' : 'arquivos prontos'}</strong><span>Você pode continuar colando mais prints com Ctrl + V antes de iniciar a leitura.</span>`
    : '<strong>Nenhum arquivo selecionado</strong><span>Copie um print, volte para esta tela e pressione Ctrl + V.</span>';
}

function removeSumFile(index) {
  if (!Number.isInteger(index) || index < 0 || index >= sumState.files.length) return;
  sumState.files.splice(index, 1);
  invalidateSumReading();
  renderSumQueue();
  showToast('Arquivo removido da fila.');
}

function clearSumFiles() {
  sumState.files = [];
  $('#sumInput').value = '';
  invalidateSumReading();
  renderSumQueue();
  showToast('Arquivos removidos da fila.');
}

function isEditablePasteTarget(target) {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
}

function clipboardImageFiles(event) {
  const items = [...(event.clipboardData?.items || [])];
  return items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item, index) => {
      const blob = item.getAsFile();
      if (!blob) return null;
      const subtype = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      sumPasteCounter += 1;
      return new File([blob], `print-colado-${String(sumPasteCounter).padStart(2, '0')}.${subtype}`, {
        type: blob.type || 'image/png',
        lastModified: Date.now() + index
      });
    })
    .filter(Boolean);
}

function handleSumPaste(event) {
  const activeModule = $('.module-button.active')?.dataset.module;
  if (activeModule !== 'sum' || isEditablePasteTarget(event.target)) return;
  const files = clipboardImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  addSumFiles(files, 'Ctrl + V');
  const dropzone = $('#sumDropzone');
  dropzone.classList.remove('paste-ready');
  dropzone.classList.add('paste-success');
  setTimeout(() => dropzone.classList.remove('paste-success'), 700);
}

document.addEventListener('paste', handleSumPaste);
document.addEventListener('keydown', (event) => {
  if ($('.module-button.active')?.dataset.module !== 'sum' || isEditablePasteTarget(event.target)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') $('#sumDropzone').classList.add('paste-ready');
});
document.addEventListener('keyup', () => $('#sumDropzone').classList.remove('paste-ready'));
window.addEventListener('blur', () => $('#sumDropzone').classList.remove('paste-ready'));

$('#sumDropzone').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  $('#sumInput').click();
});
$('#sumFileList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-sum-file-remove]');
  if (button) removeSumFile(Number(button.dataset.sumFileRemove));
});
$('#sumClearFilesBtn').addEventListener('click', clearSumFiles);
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

renderSumQueue();

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

let sumOcrWorkerPromise = null;
let sumOcrProgressHandler = null;

async function getSumOcrWorker() {
  if (!window.Tesseract) throw new Error('A biblioteca de OCR não carregou. Atualize a página com internet ativa.');
  if (!sumOcrWorkerPromise) {
    sumOcrWorkerPromise = Tesseract.createWorker('por', 1, {
      logger: (event) => { if (sumOcrProgressHandler) sumOcrProgressHandler(event); }
    }).catch((error) => {
      sumOcrWorkerPromise = null;
      throw error;
    });
  }
  return sumOcrWorkerPromise;
}

async function recognizeSumCanvas(canvas, progressHandler, pageSegmentation = '6') {
  const worker = await getSumOcrWorker();
  sumOcrProgressHandler = progressHandler;
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(pageSegmentation),
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    return await worker.recognize(canvas);
  } finally {
    sumOcrProgressHandler = null;
  }
}

function sumOtsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  gray.forEach((value) => { histogram[value] += 1; });
  const total = gray.length;
  let sum = 0;
  for (let index = 0; index < 256; index++) sum += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let bestThreshold = 180;
  for (let threshold = 0; threshold < 256; threshold++) {
    backgroundWeight += histogram[threshold];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; bestThreshold = threshold; }
  }
  return Math.max(125, Math.min(220, bestThreshold));
}

function isolateSumTableLines(binary, width, height) {
  const lineMask = new Uint8Array(binary.length);
  const minimumHorizontalRun = Math.max(60, Math.round(width * 0.025));
  const minimumVerticalRun = Math.max(45, Math.round(height * 0.04));
  let horizontalSegments = 0;
  let verticalSegments = 0;

  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const dark = x < width && binary[y * width + x];
      if (dark && start < 0) start = x;
      if ((!dark || x === width) && start >= 0) {
        const end = x;
        if (end - start >= minimumHorizontalRun) {
          horizontalSegments += 1;
          for (let xx = start; xx < end; xx++) lineMask[y * width + xx] = 1;
        }
        start = -1;
      }
    }
  }

  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const dark = y < height && binary[y * width + x];
      if (dark && start < 0) start = y;
      if ((!dark || y === height) && start >= 0) {
        const end = y;
        if (end - start >= minimumVerticalRun) {
          verticalSegments += 1;
          for (let yy = start; yy < end; yy++) lineMask[yy * width + x] = 1;
        }
        start = -1;
      }
    }
  }

  const withoutLines = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) withoutLines[index] = binary[index] && !lineMask[index] ? 1 : 0;
  return {
    binary: withoutLines,
    tableLike: horizontalSegments >= 3 || verticalSegments >= 3
  };
}

function closeSumBinary(binary, width, height) {
  const dilated = new Uint8Array(binary.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!binary[y * width + x]) continue;
      for (let yy = y; yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = x; xx <= Math.min(width - 1, x + 1); xx++) dilated[yy * width + xx] = 1;
      }
    }
  }
  const closed = new Uint8Array(binary.length);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const position = y * width + x;
      if (dilated[position] && dilated[position + 1] && dilated[position + width] && dilated[position + width + 1]) closed[position] = 1;
    }
  }
  return closed;
}

function preprocessSumCanvas(source, sourceWidth, sourceHeight) {
  const longest = Math.max(sourceWidth, sourceHeight);
  const scale = Math.max(1, Math.min(4, 3600 / Math.max(longest, 1)));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const originalCanvas = document.createElement('canvas');
  originalCanvas.width = width;
  originalCanvas.height = height;
  const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true });
  originalContext.imageSmoothingEnabled = true;
  originalContext.imageSmoothingQuality = 'high';
  originalContext.drawImage(source, 0, 0, width, height);

  const imageData = originalContext.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const gray = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < pixels.length; index += 4, pixel++) {
    gray[pixel] = Math.round(pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114);
  }

  const threshold = sumOtsuThreshold(gray);
  const binary = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index++) binary[index] = gray[index] < threshold ? 1 : 0;
  const isolated = isolateSumTableLines(binary, width, height);
  const cleaned = closeSumBinary(isolated.binary, width, height);

  const processedCanvas = document.createElement('canvas');
  processedCanvas.width = width;
  processedCanvas.height = height;
  const processedContext = processedCanvas.getContext('2d');
  const output = processedContext.createImageData(width, height);
  for (let position = 0; position < cleaned.length; position++) {
    const value = cleaned[position] ? 0 : 255;
    const outputIndex = position * 4;
    output.data[outputIndex] = value;
    output.data[outputIndex + 1] = value;
    output.data[outputIndex + 2] = value;
    output.data[outputIndex + 3] = 255;
  }
  processedContext.putImageData(output, 0, 0);
  return { originalCanvas, processedCanvas, tableLike: isolated.tableLike };
}

async function loadSumImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sumRecognizedTextScore(text) {
  const normalized = normalize(text);
  const moneyCount = sumMoneyCandidates(text).length;
  const dateCount = (String(text || '').match(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g) || []).length;
  return normalized.length + moneyCount * 80 + dateCount * 30;
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
    const moneyCount = sumMoneyCandidates(text).length;
    if ((normalize(text).length < 45 || moneyCount === 0) && window.Tesseract) {
      const viewport = page.getViewport({ scale: 2.2 });
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = Math.ceil(viewport.width);
      sourceCanvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: sourceCanvas.getContext('2d'), viewport }).promise;
      const prepared = preprocessSumCanvas(sourceCanvas, sourceCanvas.width, sourceCanvas.height);
      const result = await recognizeSumCanvas(prepared.processedCanvas, (event) => {
        if (event.status === 'recognizing text') updateSumProgress(baseProgress, `${file.name} — OCR da página ${pageNumber}: ${Math.round((event.progress || 0) * 100)}%`);
      }, prepared.tableLike ? '6' : '3');
      if (sumRecognizedTextScore(result.data.text) > sumRecognizedTextScore(text)) text = result.data.text;
      method = prepared.tableLike ? 'OCR de tabela (grade removida)' : 'OCR da página';
    }
    pages.push({ page: pageNumber, text, method });
    await yieldBrowser();
  }
  return pages;
}

async function extractSumImage(file, fileIndex) {
  const image = await loadSumImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const prepared = preprocessSumCanvas(image, width, height);
  if (typeof image.close === 'function') image.close();

  const progress = (event) => {
    if (event.status === 'recognizing text') {
      const overall = (fileIndex + (event.progress || 0)) / Math.max(sumState.files.length, 1);
      updateSumProgress(overall, `${file.name} — lendo linhas e valores: ${Math.round((event.progress || 0) * 100)}%`);
    }
  };

  const first = await recognizeSumCanvas(prepared.processedCanvas, progress, prepared.tableLike ? '6' : '3');
  let text = first.data.text || '';
  let method = prepared.tableLike ? 'OCR de tabela (grade removida)' : 'OCR da imagem tratada';

  if (sumMoneyCandidates(text).length === 0 || normalize(text).length < 25) {
    updateSumProgress(fileIndex / Math.max(sumState.files.length, 1), `${file.name} — fazendo uma segunda leitura`);
    const fallback = await recognizeSumCanvas(prepared.originalCanvas, progress, '3');
    if (sumRecognizedTextScore(fallback.data.text) > sumRecognizedTextScore(text)) {
      text = fallback.data.text || text;
      method = 'OCR alternativo da imagem';
    }
  }
  return [{ page: 1, text, method }];
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


function isSumReportTable(text) {
  const header = normalize(text).replace(/[º°]/g, 'o').replace(/[^a-z0-9]+/g, ' ');
  const hasInvoiceColumn = /\b(?:no ?nf|numero (?:da )?(?:nota|nf)|nf e?)\b/.test(header) || header.includes('nonf');
  const hasTotalColumn = /\b(?:total nf|valor total|total da nf|total nota)\b/.test(header);
  return hasInvoiceColumn && hasTotalColumn;
}

function parseSumReportTableRow(line, tableMode) {
  const source = String(line || '');
  const allValues = sumMoneyCandidates(source);
  if (!allValues.length) return null;
  const selectedValue = allValues[allValues.length - 1];

  const prefixBeforeValue = source.slice(0, selectedValue.index);
  const dateMatches = [...prefixBeforeValue.matchAll(/\b\d{1,2}\D{1,3}\d{1,2}\D{1,3}\d{2,4}\b/g)];
  const dateMatch = dateMatches[dateMatches.length - 1];
  const yearMatches = [...prefixBeforeValue.matchAll(/\b20\d{2}\b/g)];
  const yearMatch = yearMatches[yearMatches.length - 1];
  const dateStart = dateMatch?.index ?? (yearMatch?.index != null ? Math.max(0, yearMatch.index - 9) : selectedValue.index);
  const beforeDate = source.slice(0, dateStart);
  const compactBeforeDate = beforeDate.replace(/[|,;]+/g, ' ').replace(/\s+/g, ' ').trim();

  const documentMatches = [...compactBeforeDate.matchAll(/\b\d{11,14}\b/g)];
  const lastDocument = documentMatches[documentMatches.length - 1];
  const invoiceArea = lastDocument && lastDocument.index != null
    ? compactBeforeDate.slice(lastDocument.index + lastDocument[0].length)
    : compactBeforeDate;
  const invoiceTokens = [...invoiceArea.matchAll(/\b\d{2,15}\b/g)]
    .map((match) => cleanSumInvoiceNumber(match[0]))
    .filter(Boolean);
  const nf = lastDocument ? invoiceTokens[0] : invoiceTokens[invoiceTokens.length - 1];
  if (!nf) return null;

  const afterDate = normalize(source.slice(dateStart));
  const stateAfterDate = /\b(?:ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)\b/.test(afterDate);
  const rowLooksTabular = documentMatches.length > 0 && Boolean(dateMatch || yearMatch) && stateAfterDate;
  if (!tableMode && !rowLooksTabular) return null;

  return {
    nf,
    value: selectedValue.value,
    note: tableMode
      ? 'Lido diretamente das colunas Nº NF e Total NF'
      : 'Linha de relatório identificada por CNPJ, NF, data, UF e valor',
    raw: source.slice(0, 260)
  };
}

function parseSumPageText(text, fileName, page, method) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const records = [];
  const tableMode = isSumReportTable(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const normalizedLine = normalize(line);
    if (/\b(total geral|subtotal geral|soma total|quantidade de notas|qtd.? notas)\b/.test(normalizedLine)) continue;

    const tableRecord = parseSumReportTableRow(line, tableMode);
    if (tableRecord) {
      records.push({
        id: `sum-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        nf: tableRecord.nf,
        value: tableRecord.value,
        fileName,
        page,
        method,
        include: true,
        status: 'confirmed',
        note: tableRecord.note,
        raw: tableRecord.raw
      });
      continue;
    }

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
  $('#sumSearchInput').value = '';
  $('#sumProgress').classList.add('hidden');
  $('#sumResults').classList.add('hidden');
  renderSumQueue();
  showToast('Somador de NFs limpo.');
}

