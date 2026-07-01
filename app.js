"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pdfState = { filesA: [], filesB: [], records: [], filter: "all", search: "" };
const nfseState = { files: [], notes: [], warnings: [], processed: 0, failed: 0, filter: "retained", search: "" };

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
  const copy = moduleCopy[name];
  $('#heroTitle').innerHTML = copy.title;
  $('#heroText').textContent = copy.text;
  $('#heroBenefits').innerHTML = copy.benefits.map((item) => `<span><b>✓</b> ${escapeHtml(item)}</span>`).join('');
  $('#mascotMessage').textContent = copy.mascot;
  location.hash = 'top';
}

$('#globalResetBtn').addEventListener('click', () => {
  const active = $('.module-button.active')?.dataset.module;
  if (active === 'nfse') resetNfse(); else resetPdf();
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
    let text = content.items.map((item) => item.str).join(' ');
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

function recordsFromText(text, fileName, side) {
  const rawLines = text.split(/\n|(?<=\d)\s{3,}(?=[A-Z0-9])/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length >= 8);
  const lines = rawLines.length > 1 ? rawLines : text.match(/.{1,180}(?:\s|$)/g) || [];
  const records = [];
  lines.forEach((line, index) => {
    const moneyMatches = [...line.matchAll(/(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+\.\d{2}/g)].map((m) => m[0]);
    const dateMatch = line.match(/\b(?:\d{2}[\/.-]\d{2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
    const docMatch = line.match(/\b\d{11,14}\b/);
    const idMatch = line.match(/\b(?:NF[- ]?E?|NOTA|DOC(?:UMENTO)?|N[º°O.]?)?\s*[:#-]?\s*(\d{3,12})\b/i);
    if (!moneyMatches.length && !dateMatch && !docMatch && line.length < 25) return;
    const value = moneyMatches.length ? parseLocaleNumber(moneyMatches[moneyMatches.length - 1]) : null;
    const identifier = (idMatch?.[1] || docMatch?.[0] || `${side}-${index + 1}`).replace(/^0+/, '') || '0';
    const description = line.replace(dateMatch?.[0] || '', '').replace(moneyMatches[moneyMatches.length - 1] || '', '').replace(/\s+/g, ' ').trim();
    records.push({ side, fileName, identifier, description: description || line, date: dateMatch?.[0] || '', value, raw: line });
  });
  if (!records.length && normalize(text)) records.push({ side, fileName, identifier: fileName, description: text.slice(0, 220), date: '', value: null, raw: text });
  return records.slice(0, 3000);
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

function matchRecords(rowsA, rowsB) {
  const usedB = new Set(); const output = [];
  const duplicateKeys = new Set();
  [rowsA, rowsB].forEach((rows) => { const counts = new Map(); rows.forEach((r) => counts.set(r.identifier, (counts.get(r.identifier) || 0) + 1)); counts.forEach((count, key) => { if (count > 1) duplicateKeys.add(key); }); });
  rowsA.forEach((a) => {
    let bestIndex = -1; let bestScore = -1;
    rowsB.forEach((b, index) => {
      if (usedB.has(index)) return;
      const sameId = a.identifier && b.identifier && a.identifier === b.identifier;
      const valueScore = a.value != null && b.value != null && Math.abs(a.value - b.value) < .01 ? .35 : 0;
      const score = (sameId ? 1 : 0) + valueScore + similarity(a.description, b.description);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex >= 0 && bestScore >= .58) {
      const b = rowsB[bestIndex]; usedB.add(bestIndex);
      const sameValue = a.value == null || b.value == null || Math.abs(a.value - b.value) < .01;
      const sameDate = !a.date || !b.date || normalize(a.date) === normalize(b.date);
      const sameDescription = similarity(a.description, b.description) >= .5;
      let status = sameValue && sameDate && sameDescription ? 'ok' : 'divergent';
      if (duplicateKeys.has(a.identifier)) status = 'duplicate';
      output.push({ status, a, b });
    } else output.push({ status: duplicateKeys.has(a.identifier) ? 'duplicate' : 'missing-b', a, b: null });
  });
  rowsB.forEach((b, index) => { if (!usedB.has(index)) output.push({ status: duplicateKeys.has(b.identifier) ? 'duplicate' : 'missing-a', a: null, b }); });
  return output;
}

function renderPdfResults(rowsA, rowsB) {
  const rows = pdfState.records; const ok = rows.filter((r) => r.status === 'ok').length; const divergent = rows.filter((r) => r.status === 'divergent').length; const missing = rows.filter((r) => r.status.startsWith('missing')).length; const duplicate = rows.filter((r) => r.status === 'duplicate').length;
  $('#pdfTotalCount').textContent = rows.length; $('#pdfOkCount').textContent = ok; $('#pdfDivergentCount').textContent = divergent; $('#pdfMissingCount').textContent = missing; $('#pdfDuplicateCount').textContent = duplicate;
  $('#pdfResultSubtitle').textContent = `${rowsA.length} registros extraídos do Relatório 1 e ${rowsB.length} do Relatório 2.`;
  $('#pdfValidationPanel').innerHTML = `<strong>Leitura concluída.</strong> O Conferinho comparou identificadores, descrições, datas e valores. Revise os registros marcados como divergentes ou não localizados.`;
  $('#pdfResults').classList.remove('hidden'); renderPdfTable(); $('#pdfResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPdfTable() {
  const tbody = $('#pdfResultsBody'); tbody.innerHTML = '';
  const rows = pdfState.records.filter((row) => {
    const filterOk = pdfState.filter === 'all' || (pdfState.filter === 'missing' && row.status.startsWith('missing')) || row.status === pdfState.filter;
    const searchable = normalize([row.a?.identifier,row.b?.identifier,row.a?.description,row.b?.description,row.a?.fileName,row.b?.fileName].join(' '));
    return filterOk && (!pdfState.search || searchable.includes(pdfState.search));
  });
  rows.forEach((row) => {
    const source = row.a || row.b; const labelMap = { ok: 'Conferido', divergent: 'Divergente', 'missing-a': 'Só no Relatório 2', 'missing-b': 'Só no Relatório 1', duplicate: 'Possível duplicado' };
    const classMap = { ok: 'status-ok', divergent: 'status-divergent', 'missing-a': 'status-missing', 'missing-b': 'status-missing', duplicate: 'status-duplicate' };
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="status-badge ${classMap[row.status]}">${labelMap[row.status]}</span></td><td>${escapeHtml(source?.identifier || '—')}</td><td>${escapeHtml(row.a?.description || row.b?.description || '—')}</td><td>${escapeHtml(row.a?.date || '—')}</td><td>${escapeHtml(row.b?.date || '—')}</td><td class="align-right">${row.a?.value == null ? '—' : money.format(row.a.value)}</td><td class="align-right">${row.b?.value == null ? '—' : money.format(row.b.value)}</td><td><span class="file-name">${escapeHtml([row.a?.fileName,row.b?.fileName].filter(Boolean).join(' / '))}</span></td>`;
    tbody.appendChild(tr);
  });
  $('#pdfEmptyResults').classList.toggle('hidden', rows.length > 0); tbody.parentElement.classList.toggle('hidden', rows.length === 0);
}

function exportPdfCsv() {
  if (!pdfState.records.length) return showToast('Faça uma comparação antes de exportar.', true);
  const rows = [['Situação','Identificador','Descrição','Data Relatório 1','Data Relatório 2','Valor Relatório 1','Valor Relatório 2','Arquivo Relatório 1','Arquivo Relatório 2']];
  pdfState.records.forEach((r) => rows.push([r.status,r.a?.identifier||r.b?.identifier||'',r.a?.description||r.b?.description||'',r.a?.date||'',r.b?.date||'',r.a?.value?.toFixed(2).replace('.',',')||'',r.b?.value?.toFixed(2).replace('.',',')||'',r.a?.fileName||'',r.b?.fileName||'']));
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
