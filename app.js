/* global pdfjsLib */

const state = {
  sefazFiles: [],
  systemFiles: [],
  results: [],
  activeFilter: 'all',
  demoMode: false,
  meta: { sefazPages: 0, systemPages: 0, parsedSefaz: 0, parsedSystem: 0 }
};

const els = {
  sefazInput: document.querySelector('#sefazInput'),
  systemInput: document.querySelector('#systemInput'),
  sefazDropzone: document.querySelector('#sefazDropzone'),
  systemDropzone: document.querySelector('#systemDropzone'),
  sefazFileList: document.querySelector('#sefazFileList'),
  systemFileList: document.querySelector('#systemFileList'),
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
  toleranceInput: document.querySelector('#toleranceInput'),
  ignoreDateToggle: document.querySelector('#ignoreDateToggle'),
  ignoreAccentsToggle: document.querySelector('#ignoreAccentsToggle'),
  totalCount: document.querySelector('#totalCount'),
  okCount: document.querySelector('#okCount'),
  divergentCount: document.querySelector('#divergentCount'),
  missingCount: document.querySelector('#missingCount'),
  duplicateCount: document.querySelector('#duplicateCount'),
  validationPanel: document.querySelector('#validationPanel'),
  resultSubtitle: document.querySelector('#resultSubtitle'),
  exportBtn: document.querySelector('#exportBtn'),
  printBtn: document.querySelector('#printBtn'),
  toast: document.querySelector('#toast')
};

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function addFiles(group, fileList) {
  const target = group === 'sefaz' ? state.sefazFiles : state.systemFiles;
  for (const file of Array.from(fileList)) {
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

function removeFile(group, index) {
  const target = group === 'sefaz' ? state.sefazFiles : state.systemFiles;
  target.splice(index, 1);
  renderFiles();
  updateReadyState();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderFileGroup(files, container, group) {
  container.innerHTML = files.map((file, index) => `
    <div class="file-card">
      <div class="file-type">PDF</div>
      <div class="file-info"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span>${formatFileSize(file.size)}</span></div>
      <button class="remove-file" data-group="${group}" data-index="${index}" type="button" aria-label="Remover arquivo">×</button>
    </div>
  `).join('');
}

function renderFiles() {
  renderFileGroup(state.sefazFiles, els.sefazFileList, 'sefaz');
  renderFileGroup(state.systemFiles, els.systemFileList, 'system');
}

function updateReadyState() {
  const ready = state.demoMode || (state.sefazFiles.length > 0 && state.systemFiles.length > 0);
  els.compareBtn.disabled = !ready;
  els.statusHint.classList.toggle('ready', ready);
  if (state.demoMode) {
    els.statusHint.innerHTML = '<span class="status-dot"></span>O exemplo está pronto para eu conferir.';
  } else if (ready) {
    els.statusHint.innerHTML = `<span class="status-dot"></span>${state.sefazFiles.length} arquivo(s) da SEFAZ e ${state.systemFiles.length} do sistema.`;
  } else {
    els.statusHint.innerHTML = '<span class="status-dot"></span>Estou esperando pelo menos um arquivo em cada grupo.';
  }
}

function bindDropzone(dropzone, group) {
  ['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', event => addFiles(group, event.dataTransfer.files));
}

els.sefazInput.addEventListener('change', event => addFiles('sefaz', event.target.files));
els.systemInput.addEventListener('change', event => addFiles('system', event.target.files));
bindDropzone(els.sefazDropzone, 'sefaz');
bindDropzone(els.systemDropzone, 'system');

document.addEventListener('click', event => {
  const removeButton = event.target.closest('.remove-file');
  if (removeButton) removeFile(removeButton.dataset.group, Number(removeButton.dataset.index));

  const filterButton = event.target.closest('[data-filter]');
  if (filterButton && (filterButton.classList.contains('filter-tab') || filterButton.classList.contains('summary-card'))) {
    setFilter(filterButton.dataset.filter);
  }
});

els.searchInput.addEventListener('input', renderResults);
els.compareBtn.addEventListener('click', runComparison);
els.resetBtn.addEventListener('click', resetAll);
els.loadDemoBtn.addEventListener('click', loadDemo);
els.exportBtn.addEventListener('click', exportCsv);
els.printBtn.addEventListener('click', () => window.print());

function setProgress(percent, title, detail) {
  els.progressSection.classList.remove('hidden');
  els.progressBar.style.width = `${percent}%`;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
}

async function runComparison() {
  els.compareBtn.disabled = true;
  els.compareBtnText.textContent = 'Processando...';
  els.resultsSection.classList.add('hidden');
  setProgress(3, 'Preparando a comparação...', 'Organizando os arquivos selecionados');

  try {
    let sefazRecords;
    let systemRecords;
    state.meta = { sefazPages: 0, systemPages: 0, parsedSefaz: 0, parsedSystem: 0 };

    if (state.demoMode) {
      await wait(450);
      setProgress(45, 'Lendo a demonstração...', 'Reconhecendo notas e fornecedores');
      await wait(450);
      ({ sefazRecords, systemRecords } = getDemoRecords());
      state.meta = { sefazPages: 2, systemPages: 2, parsedSefaz: sefazRecords.length, parsedSystem: systemRecords.length };
    } else {
      if (!window.pdfjsLib) throw new Error('O leitor de PDF não foi carregado. Verifique sua internet e tente novamente.');
      const totalFiles = state.sefazFiles.length + state.systemFiles.length;
      let processed = 0;
      sefazRecords = [];
      systemRecords = [];

      for (const file of state.sefazFiles) {
        setProgress(5 + (processed / totalFiles) * 67, 'Lendo relatórios da SEFAZ...', file.name);
        const extracted = await extractPdf(file);
        state.meta.sefazPages += extracted.pages;
        const parsed = parseSefaz(extracted.lines, file.name);
        sefazRecords.push(...parsed);
        processed++;
      }

      for (const file of state.systemFiles) {
        setProgress(5 + (processed / totalFiles) * 67, 'Lendo relatórios do sistema...', file.name);
        const extracted = await extractPdf(file);
        state.meta.systemPages += extracted.pages;
        const parsed = parseSystem(extracted.rowsByPage, file.name);
        systemRecords.push(...parsed);
        processed++;
      }

      state.meta.parsedSefaz = sefazRecords.length;
      state.meta.parsedSystem = systemRecords.length;
    }

    setProgress(78, 'Cruzando os documentos...', 'Comparando nota, data, valor e fornecedor');
    await wait(350);
    state.results = compareRecords(sefazRecords, systemRecords);
    setProgress(100, 'Comparação concluída', `${state.results.length} item(ns) organizados`);
    await wait(280);
    els.progressSection.classList.add('hidden');
    renderSummary();
    setFilter('all');
    els.resultsSection.classList.remove('hidden');
    els.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (!sefazRecords.length || !systemRecords.length) {
      toast('Alguns PDFs foram lidos, mas o layout ainda não foi reconhecido. A demo pode receber novos modelos de parser.');
    } else {
      toast('Comparação concluída com sucesso.');
    }
  } catch (error) {
    console.error(error);
    els.progressSection.classList.add('hidden');
    toast(error.message || 'Não foi possível concluir a comparação.');
  } finally {
    els.compareBtn.disabled = false;
    els.compareBtnText.textContent = 'Conferir agora';
  }
}

async function extractPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const allLines = [];
  const rowsByPage = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const grouped = new Map();

    textContent.items.forEach(item => {
      const y = Math.round(item.transform[5] * 2) / 2;
      if (!grouped.has(y)) grouped.set(y, []);
      grouped.get(y).push({ x: item.transform[4], str: item.str });
    });

    const pageRows = [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, items]) => {
        const sortedItems = items.sort((a, b) => a.x - b.x);
        return {
          y,
          items: sortedItems,
          text: sortedItems.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()
        };
      })
      .filter(row => row.text);

    allLines.push(...pageRows.map(row => row.text));
    rowsByPage.push(pageRows);
  }

  return { pages: pdf.numPages, lines: allLines, rowsByPage };
}

function parseSefaz(lines, fileName) {
  const records = [];
  const rowRegex = /^\s*(\d{8,12})\s+(.+?)(\d{14})\s+(\d{1,12})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+\S+)*?\s+([A-Z]{2})\s+([\d.]+,\d{2})\s*$/;

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    const match = normalized.match(rowRegex);
    if (!match) continue;
    records.push({
      side: 'sefaz',
      ie: match[1],
      supplier: cleanSupplier(match[2]),
      cnpj: match[3],
      invoice: normalizeInvoice(match[4]),
      date: match[5],
      uf: match[6],
      amount: parseMoney(match[7]),
      fileName
    });
  }
  return records;
}

function parseSystem(rowsByPage, fileName) {
  const records = [];

  for (const pageRows of rowsByPage) {
    for (const row of pageRows) {
      // Neste layout, o código e a data são impressos juntos na primeira coluna.
      // Itens muito próximos da margem esquerda podem ser números de agrupamento,
      // por isso priorizamos a faixa visual da coluna "Código / Data".
      const leftText = row.items
        .filter(item => item.x >= 8 && item.x < 100)
        .map(item => item.str)
        .join('')
        .replace(/\s+/g, '');
      const identity = leftText.match(/(\d{1,8})(\d{2}\/\d{2}\/\d{4})/);
      if (!identity) continue;

      const noteText = row.items
        .filter(item => item.x >= 90 && item.x < 155)
        .map(item => item.str)
        .join(' ');
      const noteMatch = noteText.match(/\d{1,12}/);
      if (!noteMatch) continue;

      const amountText = row.items
        .filter(item => item.x >= 325 && item.x < 390)
        .map(item => item.str)
        .join(' ');
      const amountMatch = amountText.match(/[\d.]+,\d{2}/);
      if (!amountMatch) continue;

      const supplierRaw = row.items
        .filter(item => item.x >= 175 && item.x < 330)
        .map(item => item.str)
        .join(' ');
      const supplier = cleanSystemSupplier(supplierRaw);

      records.push({
        side: 'system',
        code: identity[1],
        date: identity[2],
        invoice: normalizeInvoice(noteMatch[0]),
        supplier: supplier || 'FORNECEDOR NÃO IDENTIFICADO',
        uf: '',
        amount: parseMoney(amountMatch[0]),
        fileName
      });
    }
  }
  return records;
}

function cleanSystemSupplier(value) {
  let text = String(value || '').toUpperCase();
  text = text.replace(/^\s*\d+/, '');
  text = text.replace(/\b\d-\d{3}\b/g, ' ');
  text = text.replace(/\b\d{1,2}\b/g, ' ');
  text = text.replace(/\d+/g, ' ');
  text = text.replace(/[^A-ZÀ-Ü& ]/g, ' ');
  return cleanSupplier(text);
}

function compareRecords(sefazRecords, systemRecords) {
  const tolerance = parseMoney(els.toleranceInput.value || '0,01');
  const ignoreDate = els.ignoreDateToggle.checked;
  const usedSystem = new Set();
  const results = [];

  const duplicateSefaz = findDuplicates(sefazRecords);
  const duplicateSystem = findDuplicates(systemRecords);

  sefazRecords.forEach((sefaz, sefazIndex) => {
    let best = null;
    systemRecords.forEach((system, systemIndex) => {
      if (usedSystem.has(systemIndex) || sefaz.invoice !== system.invoice) return;
      const amountEqual = Math.abs(sefaz.amount - system.amount) <= tolerance;
      const dateEqual = sefaz.date === system.date;
      const nameScore = supplierSimilarity(sefaz.supplier, system.supplier);
      const ufEqual = !sefaz.uf || !system.uf || sefaz.uf === system.uf;
      let score = 0;
      if (amountEqual) score += 4;
      if (dateEqual) score += 3;
      if (nameScore >= .72) score += 2;
      else if (nameScore >= .48) score += 1;
      if (ufEqual) score += 1;
      if (ignoreDate && amountEqual) score += 1;
      if (!best || score > best.score) best = { system, systemIndex, score, amountEqual, dateEqual, nameScore };
    });

    const duplicate = duplicateSefaz.has(sefazIndex);
    const accepted = best && (best.score >= 5 || (ignoreDate && best.amountEqual && best.nameScore >= .45));

    if (!accepted) {
      results.push(makeResult('missing-system', sefaz, null, duplicate));
      return;
    }

    usedSystem.add(best.systemIndex);
    const supplierEqual = best.nameScore >= .62;
    const status = best.amountEqual && (best.dateEqual || ignoreDate) && supplierEqual ? 'ok' : 'divergent';
    results.push(makeResult(status, sefaz, best.system, duplicate || duplicateSystem.has(best.systemIndex)));
  });

  systemRecords.forEach((system, systemIndex) => {
    if (!usedSystem.has(systemIndex)) results.push(makeResult('missing-sefaz', null, system, duplicateSystem.has(systemIndex)));
  });

  return results.sort((a, b) => {
    const order = { 'missing-system': 0, 'missing-sefaz': 1, divergent: 2, duplicate: 3, ok: 4 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.invoice).localeCompare(String(b.invoice), 'pt-BR', { numeric: true });
  });
}

function makeResult(status, sefaz, system, duplicate = false) {
  const finalStatus = duplicate && status === 'ok' ? 'duplicate' : status;
  return {
    status: finalStatus,
    invoice: sefaz?.invoice || system?.invoice || '',
    supplier: sefaz?.supplier || system?.supplier || '',
    sefazSupplier: sefaz?.supplier || '',
    systemSupplier: system?.supplier || '',
    sefazDate: sefaz?.date || '',
    systemDate: system?.date || '',
    sefazAmount: sefaz?.amount ?? null,
    systemAmount: system?.amount ?? null,
    sefazFile: sefaz?.fileName || '',
    systemFile: system?.fileName || '',
    duplicate
  };
}

function findDuplicates(records) {
  const map = new Map();
  records.forEach((record, index) => {
    const key = `${record.invoice}|${record.date}|${record.amount.toFixed(2)}|${normalizeText(record.supplier)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  });
  const duplicates = new Set();
  map.forEach(indices => { if (indices.length > 1) indices.forEach(index => duplicates.add(index)); });
  return duplicates;
}

function supplierSimilarity(a, b) {
  const tokensA = new Set(normalizeText(a).split(' ').filter(token => token.length > 2 && !LEGAL_TOKENS.has(token)));
  const tokensB = new Set(normalizeText(b).split(' ').filter(token => token.length > 2 && !LEGAL_TOKENS.has(token)));
  if (!tokensA.size || !tokensB.size) return 0;
  let intersection = 0;
  tokensA.forEach(token => { if (tokensB.has(token)) intersection++; });
  return intersection / Math.min(tokensA.size, tokensB.size);
}

const LEGAL_TOKENS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'SERVICO', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

function normalizeText(text) {
  let value = String(text || '').toUpperCase();
  if (els.ignoreAccentsToggle.checked) value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return value.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanSupplier(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/\s+-\s*$/, '').trim();
}

function normalizeInvoice(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

function parseMoney(value) {
  if (typeof value === 'number') return value;
  const normalized = String(value || '0').replace(/R\$\s?/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderSummary() {
  const counts = state.results.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const missing = (counts['missing-system'] || 0) + (counts['missing-sefaz'] || 0);
  els.totalCount.textContent = state.results.length;
  els.okCount.textContent = counts.ok || 0;
  els.divergentCount.textContent = counts.divergent || 0;
  els.missingCount.textContent = missing;
  els.duplicateCount.textContent = state.results.filter(item => item.duplicate).length;
  els.resultSubtitle.textContent = `${state.meta.parsedSefaz} registro(s) extraído(s) da SEFAZ e ${state.meta.parsedSystem} do sistema.`;

  els.validationPanel.innerHTML = `
    <div class="validation-title"><strong>Leitura dos arquivos</strong><span>A ferramenta reuniu todos os PDFs de cada grupo antes de comparar.</span></div>
    <div class="validation-grid">
      <div class="validation-item"><span>Arquivos da SEFAZ</span><strong>${state.demoMode ? 2 : state.sefazFiles.length} arquivo(s) · ${state.meta.sefazPages} página(s)</strong></div>
      <div class="validation-item"><span>Arquivos do sistema</span><strong>${state.demoMode ? 2 : state.systemFiles.length} arquivo(s) · ${state.meta.systemPages} página(s)</strong></div>
      <div class="validation-item"><span>Registros reconhecidos</span><strong>${state.meta.parsedSefaz + state.meta.parsedSystem} registros</strong></div>
      <div class="validation-item"><span>Critério principal</span><strong>Número da nota + valor + fornecedor</strong></div>
    </div>
  `;
}

function setFilter(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  document.querySelectorAll('.summary-card').forEach(button => button.classList.toggle('active', button.dataset.filter === filter || (button.dataset.filter === 'missing' && ['missing-system', 'missing-sefaz'].includes(filter))));
  renderResults();
}

function renderResults() {
  const query = normalizeText(els.searchInput.value);
  const filtered = state.results.filter(item => {
    const matchesFilter = state.activeFilter === 'all'
      || item.status === state.activeFilter
      || (state.activeFilter === 'duplicate' && item.duplicate)
      || (state.activeFilter === 'missing' && ['missing-system', 'missing-sefaz'].includes(item.status));
    const haystack = normalizeText(`${item.invoice} ${item.supplier} ${item.sefazSupplier} ${item.systemSupplier}`);
    return matchesFilter && (!query || haystack.includes(query));
  });

  els.resultsBody.innerHTML = filtered.map(item => {
    const labels = {
      ok: 'Conferido',
      divergent: 'Divergente',
      'missing-system': 'Falta no sistema',
      'missing-sefaz': 'Falta na SEFAZ',
      duplicate: 'Possível duplicado'
    };
    const supplierDetail = item.sefazSupplier && item.systemSupplier && normalizeText(item.sefazSupplier) !== normalizeText(item.systemSupplier)
      ? `Sistema: ${escapeHtml(item.systemSupplier)}`
      : '';
    const amountDifferent = item.sefazAmount !== null && item.systemAmount !== null && Math.abs(item.sefazAmount - item.systemAmount) > parseMoney(els.toleranceInput.value || '0,01');
    return `
      <tr>
        <td><span class="status-pill status-${item.status}">${labels[item.status]}</span></td>
        <td><strong>${escapeHtml(item.invoice)}</strong></td>
        <td class="supplier-cell"><strong>${escapeHtml(item.supplier)}</strong>${supplierDetail ? `<span>${supplierDetail}</span>` : ''}</td>
        <td>${item.sefazDate || '—'}</td>
        <td>${item.systemDate || '—'}</td>
        <td class="align-right ${amountDifferent ? 'value-diff' : ''}">${formatMoney(item.sefazAmount)}</td>
        <td class="align-right ${amountDifferent ? 'value-diff' : ''}">${formatMoney(item.systemAmount)}</td>
        <td class="source-stack">${item.sefazFile ? `<span title="${escapeHtml(item.sefazFile)}">SEFAZ: ${escapeHtml(item.sefazFile)}</span>` : ''}${item.systemFile ? `<span title="${escapeHtml(item.systemFile)}">Sistema: ${escapeHtml(item.systemFile)}</span>` : ''}</td>
      </tr>
    `;
  }).join('');

  els.emptyResults.classList.toggle('hidden', filtered.length > 0);
}

function getDemoRecords() {
  const sefazRecords = [
    { side: 'sefaz', invoice: '10458', date: '03/06/2026', supplier: 'AGRO CAMPO PECAS E MAQUINAS LTDA', cnpj: '11111111000111', uf: 'MS', amount: 1480.00, fileName: 'SEFAZ_01-15_junho.pdf' },
    { side: 'sefaz', invoice: '10471', date: '08/06/2026', supplier: 'AGRO CAMPO PECAS E MAQUINAS LTDA', cnpj: '11111111000111', uf: 'MS', amount: 320.90, fileName: 'SEFAZ_01-15_junho.pdf' },
    { side: 'sefaz', invoice: '8842', date: '11/06/2026', supplier: 'COOPERATIVA RURAL DO PANTANAL', cnpj: '22222222000122', uf: 'MS', amount: 7825.40, fileName: 'SEFAZ_01-15_junho.pdf' },
    { side: 'sefaz', invoice: '910', date: '18/06/2026', supplier: 'FAZENDA BOA ESPERANCA INSUMOS LTDA', cnpj: '33333333000133', uf: 'SP', amount: 9600.00, fileName: 'SEFAZ_16-30_junho.pdf' },
    { side: 'sefaz', invoice: '22208', date: '24/06/2026', supplier: 'POSTO CENTRAL COMBUSTIVEIS LTDA', cnpj: '44444444000144', uf: 'MS', amount: 675.30, fileName: 'SEFAZ_16-30_junho.pdf' },
    { side: 'sefaz', invoice: '22208', date: '24/06/2026', supplier: 'POSTO CENTRAL COMBUSTIVEIS LTDA', cnpj: '44444444000144', uf: 'MS', amount: 675.30, fileName: 'SEFAZ_16-30_junho.pdf' }
  ];
  const systemRecords = [
    { side: 'system', invoice: '10458', date: '03/06/2026', supplier: 'AGRO CAMPO PECAS E MAQUINAS LTDA', uf: 'MS', amount: 1480.00, fileName: 'Entradas_parte_1.pdf' },
    { side: 'system', invoice: '10471', date: '08/06/2026', supplier: 'AGRO CAMPO PECAS E MAQ LTDA', uf: 'MS', amount: 325.90, fileName: 'Entradas_parte_1.pdf' },
    { side: 'system', invoice: '8842', date: '12/06/2026', supplier: 'COOPERATIVA RURAL DO PANTANAL', uf: 'MS', amount: 7825.40, fileName: 'Entradas_parte_1.pdf' },
    { side: 'system', invoice: '910', date: '18/06/2026', supplier: 'FAZENDA BOA ESPERANCA INSUMOS', uf: 'SP', amount: 9600.00, fileName: 'Entradas_parte_2.pdf' },
    { side: 'system', invoice: '33100', date: '27/06/2026', supplier: 'CASA DO PRODUTOR LTDA', uf: 'MS', amount: 410.00, fileName: 'Entradas_parte_2.pdf' }
  ];
  return { sefazRecords, systemRecords };
}

function loadDemo() {
  state.sefazFiles = [];
  state.systemFiles = [];
  state.demoMode = true;
  renderFiles();
  updateReadyState();
  els.resultsSection.classList.add('hidden');
  toast('Demonstração carregada. Clique em “Conferir agora”.');
}

function resetAll() {
  state.sefazFiles = [];
  state.systemFiles = [];
  state.results = [];
  state.demoMode = false;
  state.activeFilter = 'all';
  els.sefazInput.value = '';
  els.systemInput.value = '';
  els.searchInput.value = '';
  els.resultsSection.classList.add('hidden');
  els.progressSection.classList.add('hidden');
  renderFiles();
  updateReadyState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exportCsv() {
  if (!state.results.length) return;
  const headers = ['Situação', 'Nota', 'Fornecedor SEFAZ', 'Fornecedor Sistema', 'Data SEFAZ', 'Data Sistema', 'Valor SEFAZ', 'Valor Sistema', 'Arquivo SEFAZ', 'Arquivo Sistema'];
  const labels = { ok: 'Conferido', divergent: 'Divergente', 'missing-system': 'Falta no sistema', 'missing-sefaz': 'Falta na SEFAZ', duplicate: 'Possível duplicado' };
  const rows = state.results.map(item => [
    labels[item.status], item.invoice, item.sefazSupplier, item.systemSupplier, item.sefazDate, item.systemDate,
    item.sefazAmount === null ? '' : item.sefazAmount.toFixed(2).replace('.', ','),
    item.systemAmount === null ? '' : item.systemAmount.toFixed(2).replace('.', ','),
    item.sefazFile, item.systemFile
  ]);
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `comparacao-relatorios-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Planilha CSV gerada.');
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
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

renderFiles();
updateReadyState();
