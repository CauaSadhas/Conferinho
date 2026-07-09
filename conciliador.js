"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const STORAGE_KEY = "conferinho_recebimentos_v25_session";
  const LEGACY_STORAGE_KEY = "conferinho_recebimentos_v20_session";
  const DISPLAY_STORAGE_KEY = "conferinho_v25_display_preferences";
  const TOLERANCE = 0.05;

  const state = {
    excelFile: null,
    pdfFile: null,
    receipts: [],
    invoices: [],
    ignored: [],
    possibilities: [],
    decisions: {},
    manualLinks: [],
    history: [],
    result: null,
    view: "clear",
    search: "",
    easyOnly: false,
    hideResolved: true,
    selected: new Set(),
    detail: null,
    signature: "",
    meta: {},
    page: "assistant",
    queueIndex: 0,
    queueFilter: "all",
    queueSearch: "",
    builderInvoice: "",
    builderSelected: new Set(),
    builderOutcome: "",
    consultMatches: [],
    progressBaseline: 0,
    initialClearCount: 0,
    sessionStartResolved: 0,
    sessionGoal: 10,
    lastMilestone: 0,
    goalCelebrated: false,
    focusMode: false,
    nextRecommendedPage: "quick",
    guidedNext: { page: "quick", bucket: "strong" },
    queueRecommendedCode: "",
    readingSize: "comfortable",
    calmMode: true,
    detailSelections: {},
  };

  const VIEW_HELP = {
    clear: "Vínculos que fecharam pelo número da nota, CPF/CNPJ e valor. Use esta lista como evidência do que já está correto.",
    doubts: "Casos com pagamento parcial, valor superior, cadastro divergente, nota compartilhada ou sugestão ainda não confirmada.",
    notes: "Notas que ainda não possuem pagamento suficiente. A coluna de possibilidades ajuda a localizar valores que podem completar a nota.",
    payments: "Entradas da planilha que ainda não possuem uma NFS-e confirmada. Veja a nota informada e as possibilidades encontradas.",
    possibilities: "Pares nota ↔ pagamento ordenados por compatibilidade. Confirme em lote somente os vínculos que realmente fizerem sentido.",
    decisions: "Histórico das decisões registradas durante a conferência e dos vínculos confirmados manualmente.",
  };

  const PAGE_GUIDES = {
    assistant: ["📥", "Comece pela Caixa inteligente", "O sistema separou o que já está resolvido, o que só precisa de confirmação e o que realmente exige uma decisão."],
    dashboard: ["🧭", "Olhe primeiro o essencial", "Veja o progresso, a quantidade pendente e a próxima melhor ação. Abra detalhes somente quando precisar."],
    quick: ["⚡", "Resolva os casos mais fáceis primeiro", "Confirme apenas os vínculos fortes. Cada confirmação reduz a fila imediatamente."],
    triage: ["🗂️", "Use a visão do topo para eliminar em lote", "Filtre, marque os casos claros e deixe os casos realmente difíceis para a fila individual."],
    builder: ["🧩", "Use a Mesa de vínculos", "Escolha a nota à esquerda, marque os pagamentos à direita e acompanhe a diferença em tempo real."],
    queue: ["🎯", "Um caso por vez, sem pressa", "Use o modo foco, escolha uma conclusão e continue. Você não precisa analisar toda a fila de uma vez."],
    consult: ["🔎", "Pesquise antes de decidir", "Digite uma nota, pagamento, cliente ou valor para entender a história completa do vínculo."],
    finish: ["✅", "Feche o trabalho com tranquilidade", "O relatório separa o que foi resolvido do que permanece pendente e mantém toda a trilha de auditoria."],
  };

  function loadDisplayPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(DISPLAY_STORAGE_KEY) || "{}");
      state.readingSize = saved.readingSize === "large" ? "large" : "comfortable";
      state.calmMode = saved.calmMode !== false;
    } catch (_) {
      state.readingSize = "comfortable";
      state.calmMode = true;
    }
  }

  function applyDisplayPreferences() {
    document.body.classList.toggle("reading-large", state.readingSize === "large");
    document.body.classList.toggle("calm-mode", state.calmMode);
    qa("[data-reading-size]").forEach((button) => button.classList.toggle("active", button.dataset.readingSize === state.readingSize));
    const calm = q("#calmModeToggle");
    if (calm) calm.checked = state.calmMode;
    try { localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({ readingSize: state.readingSize, calmMode: state.calmMode })); } catch (_) {}
  }

  function renderPageGuide(page) {
    const guide = PAGE_GUIDES[page] || PAGE_GUIDES.dashboard;
    if (q("#concPageGuideIcon")) q("#concPageGuideIcon").textContent = guide[0];
    if (q("#concPageGuideTitle")) q("#concPageGuideTitle").textContent = guide[1];
    if (q("#concPageGuideText")) q("#concPageGuideText").textContent = guide[2];
  }

  function notify(message, error = false) {
    const toast = q("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show${error ? " error" : ""}`;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { toast.className = "toast"; }, 3400);
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function norm(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function digits(value) { return String(value ?? "").replace(/\D/g, ""); }
  function round2(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }
  function sum(items, getter = (item) => item) { return round2(items.reduce((total, item) => total + Number(getter(item) || 0), 0)); }
  function moneyValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) return round2(value);
    let text = String(value ?? "").trim();
    if (!text) return 0;
    text = text.replace(/R\$/gi, "").replace(/\s/g, "");
    if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
    else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, "");
    text = text.replace(/[^0-9.-]/g, "");
    const number = Number(text);
    return Number.isFinite(number) ? round2(number) : 0;
  }

  function formatDate(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toLocaleDateString("pt-BR");
    if (typeof value === "number" && window.XLSX?.SSF) {
      const parts = XLSX.SSF.parse_date_code(value);
      if (parts) return `${String(parts.d).padStart(2, "0")}/${String(parts.m).padStart(2, "0")}/${parts.y}`;
    }
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const br = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (br) return `${br[1].padStart(2, "0")}/${br[2].padStart(2, "0")}/${br[3].length === 2 ? `20${br[3]}` : br[3]}`;
    return text;
  }

  function dateToTime(value) {
    const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function formatDoc(value) {
    const d = digits(value);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    return String(value || "");
  }

  function invoiceRefs(value) {
    const text = String(value ?? "").trim();
    if (!text || ["N/D", "ND", "NAO INFORMADO", "NÃO INFORMADO"].includes(norm(text))) return [];
    return [...new Set((text.match(/\d{4,}/g) || []).map((item) => String(Number(item))).filter(Boolean))];
  }

  function headerKey(value) { return norm(value); }
  function findColumn(headers, ...candidates) {
    const normalized = headers.map(headerKey);
    for (const candidate of candidates) {
      const index = normalized.indexOf(headerKey(candidate));
      if (index >= 0) return index;
    }
    return -1;
  }

  function nameSimilarity(a, b) {
    const left = norm(a); const right = norm(b);
    if (!left || !right) return 0;
    if (left === right) return 100;
    const aTokens = new Set(left.split(" ").filter((item) => item.length > 1 && !["LTDA", "ME", "EPP", "EIRELI"].includes(item)));
    const bTokens = new Set(right.split(" ").filter((item) => item.length > 1 && !["LTDA", "ME", "EPP", "EIRELI"].includes(item)));
    const intersection = [...aTokens].filter((item) => bTokens.has(item)).length;
    const union = new Set([...aTokens, ...bTokens]).size || 1;
    const tokenScore = intersection / union;
    const containment = left.includes(right) || right.includes(left) ? 1 : 0;
    return Math.round(Math.max(tokenScore, containment * 0.92) * 100);
  }

  function bindDropzone(dropzone, input, accept, handler) {
    if (!dropzone || !input) return;
    input.addEventListener("change", () => handler([...input.files].filter(accept)));
    ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
      event.preventDefault(); dropzone.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
      event.preventDefault(); dropzone.classList.remove("dragging");
    }));
    dropzone.addEventListener("drop", (event) => handler([...event.dataTransfer.files].filter(accept)));
  }

  function updateReady() {
    const ready = Boolean(state.excelFile && state.pdfFile);
    q("#receiptsAnalyzeBtn").disabled = !ready;
    q("#receiptsStatusHint").textContent = ready
      ? `${state.excelFile.name} e ${state.pdfFile.name} prontos para conciliação.`
      : "Envie o Excel e o PDF para iniciar.";
  }

  function setExcel(files) {
    state.excelFile = files[0] || null;
    q("#receiptsExcelFileList").innerHTML = state.excelFile ? `<span class="file-chip">${esc(state.excelFile.name)}</span>` : "";
    updateReady();
  }

  function setPdf(files) {
    state.pdfFile = files[0] || null;
    q("#receiptsPdfFileList").innerHTML = state.pdfFile ? `<span class="file-chip">${esc(state.pdfFile.name)}</span>` : "";
    updateReady();
  }

  function progress(ratio, detail) {
    const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    q("#receiptsProgressPercent").textContent = `${value}%`;
    q("#receiptsProgressBar").style.width = `${value}%`;
    q("#receiptsProgressDetail").textContent = detail;
  }

  async function parseReceiptsExcel(file) {
    if (!window.XLSX) throw new Error("A biblioteca de Excel não carregou. Atualize a página com internet ativa.");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
    let headerIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
      const keys = new Set(rows[index].map(headerKey));
      if (keys.has("CNPJ CPF") && keys.has("NOTA FISCAL") && keys.has("RECEBIDO")) { headerIndex = index; break; }
    }
    if (headerIndex < 0) throw new Error("Não encontrei o cabeçalho do Excel. Ele precisa ter CNPJ/CPF, Nota Fiscal e Recebido.");
    const headers = rows[headerIndex].map((item) => String(item || "").trim());
    const columns = {
      company: findColumn(headers, "Minha Empresa (Razão Social)"),
      companyDoc: findColumn(headers, "Minha Empresa (CNPJ)"),
      creditDate: findColumn(headers, "Data de Crédito ou Débito (No Extrato)"),
      document: findColumn(headers, "CNPJ/CPF"),
      client: findColumn(headers, "Cliente"),
      legalName: findColumn(headers, "Razão Social"),
      issueDate: findColumn(headers, "Emissão"),
      category: findColumn(headers, "Categoria"),
      bank: findColumn(headers, "Conta Corrente"),
      invoice: findColumn(headers, "Nota Fiscal"),
      origin: findColumn(headers, "Origem"),
      accountValue: findColumn(headers, "Valor da Conta"),
      received: findColumn(headers, "Recebido"),
      open: findColumn(headers, "A Receber"),
      internalNumber: findColumn(headers, "Número"),
    };
    ["document", "client", "invoice", "origin", "received"].forEach((key) => {
      if (columns[key] < 0) throw new Error(`Coluna obrigatória não encontrada no Excel: ${key}.`);
    });
    const get = (row, index) => index >= 0 ? row[index] : "";
    const records = [];
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const useful = [columns.document, columns.client, columns.invoice, columns.origin, columns.received]
        .some((column) => column >= 0 && String(get(row, column) ?? "").trim() !== "");
      if (!useful) continue;
      const client = String(get(row, columns.client) || "").trim();
      const legalName = String(get(row, columns.legalName) || "").trim();
      const received = moneyValue(get(row, columns.received));
      const origin = String(get(row, columns.origin) || "").trim();
      records.push({
        id: records.length + 1,
        sourceRow: rowIndex + 1,
        creditDate: formatDate(get(row, columns.creditDate)),
        issueDate: formatDate(get(row, columns.issueDate)),
        document: String(get(row, columns.document) || "").trim(),
        docNorm: digits(get(row, columns.document)),
        client,
        legalName,
        displayName: legalName || client,
        nameNorm: norm(legalName || client),
        invoiceRaw: String(get(row, columns.invoice) || "").trim(),
        refs: invoiceRefs(get(row, columns.invoice)),
        origin,
        originNorm: norm(origin),
        received,
        accountValue: moneyValue(get(row, columns.accountValue)),
        openAmount: moneyValue(get(row, columns.open)),
        bank: String(get(row, columns.bank) || "").trim(),
        category: String(get(row, columns.category) || "").trim(),
        internalNumber: String(get(row, columns.internalNumber) || "").trim(),
      });
    }
    if (!records.length) throw new Error("A planilha foi lida, mas não encontrei lançamentos.");
    const first = rows.slice(headerIndex + 1).find((row) => String(get(row, columns.company) || "").trim());
    const company = first ? String(get(first, columns.company) || "").trim() : "";
    const companyDoc = first ? String(get(first, columns.companyDoc) || "").trim() : "";
    return { records, metadata: { company, companyDoc, headerRow: headerIndex + 1, totalRows: records.length } };
  }

  function pdfItemsToLines(items) {
    const fragments = (items || []).filter((item) => String(item.str || "").trim()).map((item) => ({
      text: String(item.str || "").trim(), x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0), width: Number(item.width || 0),
    })).sort((a, b) => Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x);
    const rows = [];
    fragments.forEach((fragment) => {
      let row = rows.find((candidate) => Math.abs(candidate.y - fragment.y) <= 2.5);
      if (!row) { row = { y: fragment.y, items: [] }; rows.push(row); }
      row.items.push(fragment);
    });
    return rows.sort((a, b) => b.y - a.y).map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = ""; let previousEnd = null;
      row.items.forEach((item) => {
        const gap = previousEnd == null ? 0 : item.x - previousEnd;
        if (line && gap > 1.5) line += " ";
        line += item.text; previousEnd = item.x + item.width;
      });
      return line.replace(/\s+/g, " ").trim();
    }).filter(Boolean);
  }

  async function parseInvoicesPdf(file) {
    if (!window.pdfjsLib) throw new Error("A biblioteca de PDF não carregou. Atualize a página com internet ativa.");
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = []; const rawPages = []; const lines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      progress(.38 + (pageNumber / pdf.numPages) * .24, `Lendo página ${pageNumber} de ${pdf.numPages} do relatório da prefeitura`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageLines = pdfItemsToLines(content.items);
      const rawText = content.items.map((item) => String(item.str || "").trim()).filter(Boolean).join("\n");
      lines.push(...pageLines); pages.push(pageLines.join("\n")); rawPages.push(rawText);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const layoutText = pages.join("\n");
    const rawText = rawPages.join("\n");
    const text = `${rawText}\n${layoutText}`;
    if (norm(text).length < 100) throw new Error("O PDF não possui texto pesquisável. Baixe novamente o relatório diretamente da prefeitura.");
    const found = new Map();
    const rowPattern = /^(\d{4,})\s+(?:(\d+)\s+)?(\d{2}\/\d{2}\/\d{4})\s+((?:\d{3}\.\d{3}\.\d{3}-\d{2})|(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}))\s+(.+?)\s+(\d{1,2},\d{2})%\s+R\$\s*([\d.]+,\d{2})(?:\s|$)/i;
    lines.forEach((line) => {
      const match = line.match(rowPattern);
      if (!match) return;
      found.set(String(Number(match[1])), {
        number: String(Number(match[1])), issueDate: match[3], document: match[4], docNorm: digits(match[4]),
        customer: match[5].trim(), nameNorm: norm(match[5]), amount: moneyValue(match[7]), sourceLine: line,
      });
    });
    if (found.size < 5) {
      const flexible = /(?:^|\n)(\d{4,})\s*\n?\s*(\d{2}\/\d{2}\/\d{4})\s+((?:\d{3}\.\d{3}\.\d{3}-\d{2})|(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}))\s+([^\n]+?)(?:\n|\s)+(?:R\$\s*[\d.,]+\s*)?(\d{1,2},\d{2})%\s*(?:\n|\s)+R\$\s*([\d.]+,\d{2})/gim;
      let match;
      while ((match = flexible.exec(text))) {
        const customer = match[4].replace(/\s+/g, " ").trim();
        found.set(String(Number(match[1])), {
          number: String(Number(match[1])), issueDate: match[2], document: match[3], docNorm: digits(match[3]),
          customer, nameNorm: norm(customer), amount: moneyValue(match[6]), sourceLine: match[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
    // Fallback adicional: percorre a ordem original dos itens do PDF. Isso é
    // importante em relatórios girados, nos quais as colunas podem se misturar
    // quando agrupadas apenas pelas coordenadas visuais.
    const rawTokens = rawText.split(/\n+/).map((item) => item.trim()).filter(Boolean);
    const dateDocumentLine = /^(\d{2}\/\d{2}\/\d{4})\s+((?:\d{3}\.\d{3}\.\d{3}-\d{2})|(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}))\s+(.+)$/;
    for (let index = 0; index < rawTokens.length; index += 1) {
      if (!/^\d{4,}$/.test(rawTokens[index])) continue;
      const number = String(Number(rawTokens[index]));
      let identity = null; let identityIndex = -1;
      for (let offset = 1; offset <= 3 && index + offset < rawTokens.length; offset += 1) {
        const candidate = rawTokens[index + offset].match(dateDocumentLine);
        if (candidate) { identity = candidate; identityIndex = index + offset; break; }
      }
      if (!identity) continue;
      let percentIndex = -1;
      for (let cursor = identityIndex + 1; cursor <= Math.min(identityIndex + 8, rawTokens.length - 1); cursor += 1) {
        if (/^\d{1,2},\d{2}%$/.test(rawTokens[cursor])) { percentIndex = cursor; break; }
      }
      if (percentIndex < 0) continue;
      let amountText = "";
      for (let cursor = percentIndex + 1; cursor <= Math.min(percentIndex + 4, rawTokens.length - 1); cursor += 1) {
        const amountMatch = rawTokens[cursor].match(/^R\$\s*([\d.]+,\d{2})$/);
        if (amountMatch) { amountText = amountMatch[1]; break; }
      }
      if (!amountText) continue;
      const customer = identity[3].replace(/\s+/g, " ").trim();
      found.set(number, {
        number, issueDate: identity[1], document: identity[2], docNorm: digits(identity[2]),
        customer, nameNorm: norm(customer), amount: moneyValue(amountText),
        sourceLine: `${rawTokens[index]} ${rawTokens[identityIndex]} ${amountText}`,
      });
    }
    if (!found.size) throw new Error("Não reconheci as NFS-e. Use o relatório 'Relação de Notas Fiscais de Serviços Eletrônicas'.");
    const records = [...found.values()].sort((a, b) => Number(a.number) - Number(b.number));
    const periodMatch = text.match(/Per[ií]odo\s+de\s+Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i);
    const summaryMatch = text.match(/Qtde\s+de\s+Notas:\s*(\d+)\s+Total:\s*R\$\s*([\d.,]+)/i);
    return {
      records,
      metadata: {
        pages: pdf.numPages,
        period: periodMatch ? `${periodMatch[1]} a ${periodMatch[2]}` : "",
        reportedCount: summaryMatch ? Number(summaryMatch[1]) : 0,
        reportedTotal: summaryMatch ? moneyValue(summaryMatch[2]) : 0,
      },
    };
  }

  function findExactSubsets(items, target, maxItems = 4, maxSolutions = 3) {
    const targetCents = Math.round(target * 100); const toleranceCents = Math.round(TOLERANCE * 100);
    const candidates = [...items].filter((item) => item.received > 0 && item.received <= target + TOLERANCE)
      .sort((a, b) => Math.abs(a.received - target) - Math.abs(b.received - target)).slice(0, 20);
    const solutions = [];
    function visit(start, chosen, cents) {
      if (solutions.length >= maxSolutions) return;
      if (chosen.length && Math.abs(cents - targetCents) <= toleranceCents) { solutions.push([...chosen]); return; }
      if (chosen.length >= maxItems || cents > targetCents + toleranceCents) return;
      for (let index = start; index < candidates.length; index += 1) {
        chosen.push(candidates[index].id);
        visit(index + 1, chosen, cents + Math.round(candidates[index].received * 100));
        chosen.pop();
        if (solutions.length >= maxSolutions) return;
      }
    }
    visit(0, [], 0);
    return solutions;
  }

  function possibilityScore(invoice, receipts) {
    const amount = sum(receipts, (item) => item.received);
    const needed = Math.max(0, round2(invoice.amount - invoice.confirmedTotal - invoice.manualTotal));
    const sameDoc = receipts.every((receipt) => receipt.docNorm && receipt.docNorm === invoice.docNorm);
    const exactRef = receipts.some((receipt) => receipt.refs.includes(invoice.number));
    const nameScore = Math.max(...receipts.map((receipt) => nameSimilarity(receipt.displayName, invoice.customer)), 0);
    const distance = Math.abs(amount - needed); const denominator = Math.max(needed, 1);
    const amountFit = Math.max(0, 1 - distance / denominator);
    const invoiceTime = dateToTime(invoice.issueDate);
    const dateScores = receipts.map((receipt) => {
      const time = dateToTime(receipt.creditDate); if (!time || !invoiceTime) return 0;
      const days = Math.abs(time - invoiceTime) / 86400000;
      return Math.max(0, 10 - Math.min(10, days / 3));
    });
    let score = (sameDoc ? 35 : 0) + (exactRef ? 25 : 0) + Math.round(nameScore * .18) + Math.round(amountFit * 22) + Math.round(Math.max(...dateScores, 0));
    if (sameDoc && distance <= TOLERANCE) score = Math.max(score, 97);
    if (exactRef && distance <= TOLERANCE) score = Math.max(score, 94);
    return Math.min(100, score);
  }

  function reconcileBase() {
    const invoiceNumbers = new Set(state.invoices.map((invoice) => invoice.number));
    const includeCredits = q("#receiptsIncludeCredits").checked;
    state.ignored = [];
    state.receipts.forEach((receipt) => {
      const allowed = receipt.originNorm === "RECEBIMENTO DE CONTA A RECEBER"
        || (includeCredits && receipt.originNorm === "LANCAMENTO DE CREDITO");
      receipt.active = allowed && receipt.received > TOLERANCE;
      receipt.baseInvoice = ""; receipt.manualInvoice = ""; receipt.finalInvoice = ""; receipt.assignment = ""; receipt.confidence = 0; receipt.linkReason = "";
      if (!receipt.active) {
        receipt.ignoredReason = receipt.originNorm.includes("TRANSFERENCIA ENTRE CONTAS")
          ? "Transferência interna entre contas"
          : receipt.received <= TOLERANCE ? "Valor zerado ou abaixo da tolerância" : `Origem não incluída: ${receipt.origin || "não informada"}`;
        state.ignored.push(receipt);
      }
    });
    const active = state.receipts.filter((receipt) => receipt.active);
    state.invoices.forEach((invoice) => {
      invoice.confirmedReceiptIds = []; invoice.manualReceiptIds = []; invoice.confirmedTotal = 0; invoice.manualTotal = 0;
      invoice.status = "Nota sem recebimento"; invoice.confidence = 0; invoice.criterion = "Sem correspondência";
      invoice.explanation = "Nenhum pagamento confirmado foi localizado para esta nota.";
      invoice.action = "Verifique se o cliente pagou em outro período ou se o número da nota não foi informado na planilha.";
      const direct = active.filter((receipt) => receipt.refs.length === 1 && receipt.refs[0] === invoice.number);
      const exactDoc = direct.filter((receipt) => receipt.docNorm && receipt.docNorm === invoice.docNorm);
      let selected = [];
      if (direct.length) {
        const exactTotal = sum(exactDoc, (receipt) => receipt.received);
        const allTotal = sum(direct, (receipt) => receipt.received);
        if (exactDoc.length && Math.abs(exactTotal - invoice.amount) <= TOLERANCE) selected = exactDoc;
        else if (exactDoc.length) {
          const solutions = findExactSubsets(exactDoc, invoice.amount);
          if (solutions.length === 1) selected = exactDoc.filter((receipt) => solutions[0].includes(receipt.id));
          else if (Math.abs(allTotal - invoice.amount) <= TOLERANCE) selected = direct;
          else selected = exactDoc;
        } else selected = direct;
        selected.forEach((receipt) => {
          receipt.baseInvoice = invoice.number; receipt.finalInvoice = invoice.number; receipt.assignment = "Automática";
          receipt.confidence = receipt.docNorm === invoice.docNorm ? 100 : 78;
          receipt.linkReason = receipt.docNorm === invoice.docNorm
            ? "O número da NFS-e estava informado, o CPF/CNPJ confere e o valor foi considerado na soma da nota."
            : "O número da NFS-e estava informado e o valor foi considerado, mas o CPF/CNPJ precisa de conferência.";
        });
        invoice.confirmedReceiptIds = selected.map((receipt) => receipt.id);
        invoice.confirmedTotal = sum(selected, (receipt) => receipt.received);
        const difference = round2(invoice.amount - invoice.confirmedTotal);
        const extras = direct.filter((receipt) => !selected.includes(receipt));
        const docMismatch = selected.some((receipt) => receipt.docNorm !== invoice.docNorm);
        if (Math.abs(difference) <= TOLERANCE) {
          if (extras.length) {
            invoice.status = "Conciliado com lançamentos indevidos"; invoice.confidence = 100;
            invoice.criterion = "Número, CPF/CNPJ e valor";
            invoice.explanation = `A nota fechou, mas ${extras.length} lançamento(s) adicional(is) também usam este número.`;
            invoice.action = "Mantenha os pagamentos corretos nesta nota e corrija a referência dos lançamentos adicionais.";
          } else if (docMismatch) {
            invoice.status = "Conciliado com divergência cadastral"; invoice.confidence = 78;
            invoice.criterion = "Número da nota e valor";
            invoice.explanation = "O valor fecha, porém o CPF/CNPJ do pagamento é diferente do tomador da nota.";
            invoice.action = "Confirme o cliente e corrija o cadastro ou a referência da nota na planilha.";
          } else {
            invoice.status = "Conciliado"; invoice.confidence = 100; invoice.criterion = "Número, CPF/CNPJ e valor";
            invoice.explanation = "O número da nota, o CPF/CNPJ e a soma dos recebimentos conferem.";
            invoice.action = "Nenhuma correção imediata é necessária.";
          }
        } else if (difference > TOLERANCE) {
          invoice.status = "Recebimento parcial"; invoice.confidence = docMismatch ? 68 : 94; invoice.criterion = "Número da nota";
          invoice.explanation = `Foram localizados ${brl.format(invoice.confirmedTotal)}, mas a nota vale ${brl.format(invoice.amount)}.`;
          invoice.action = `Localize o saldo de ${brl.format(difference)} ou confirme que o pagamento aconteceu em outro período.`;
        } else {
          invoice.status = "Recebimento superior"; invoice.confidence = docMismatch ? 64 : 88; invoice.criterion = "Número da nota";
          invoice.explanation = `Os pagamentos ligados à nota ultrapassam o valor emitido em ${brl.format(Math.abs(difference))}.`;
          invoice.action = "Verifique parcelas duplicadas, juros ou pagamentos que pertencem a outra NFS-e.";
        }
      } else {
        const shared = active.filter((receipt) => receipt.refs.length > 1 && receipt.refs.includes(invoice.number));
        if (shared.length) {
          invoice.status = "Lançamento com múltiplas notas"; invoice.confidence = 40; invoice.criterion = "Número citado em pagamento compartilhado";
          invoice.explanation = `A nota aparece em ${shared.length} pagamento(s) que citam mais de uma NFS-e.`;
          invoice.action = "Distribua o valor do pagamento entre as notas corretas antes de concluir.";
        }
      }
    });

    // Restaura vínculos manuais válidos sem sobrescrever vínculos automáticos.
    state.manualLinks = state.manualLinks.filter((link) => state.invoices.some((invoice) => invoice.number === link.invoice));
    state.manualLinks.forEach((link) => {
      const invoice = state.invoices.find((item) => item.number === link.invoice);
      const linked = active.filter((receipt) => link.receiptIds.includes(receipt.id) && !receipt.baseInvoice && !receipt.manualInvoice);
      linked.forEach((receipt) => {
        receipt.manualInvoice = invoice.number; receipt.finalInvoice = invoice.number; receipt.assignment = "Confirmada manualmente"; receipt.confidence = 100;
        receipt.linkReason = link.comment || "Vínculo confirmado pelo usuário na Central de Conciliação.";
      });
      invoice.manualReceiptIds.push(...linked.map((receipt) => receipt.id));
      invoice.manualTotal = round2(invoice.manualTotal + sum(linked, (receipt) => receipt.received));
    });

    state.invoices.forEach((invoice) => {
      invoice.receivedTotal = round2(invoice.confirmedTotal + invoice.manualTotal);
      invoice.difference = round2(invoice.amount - invoice.receivedTotal);
      if (invoice.manualReceiptIds.length) {
        if (Math.abs(invoice.difference) <= TOLERANCE) {
          invoice.status = "Conciliado manualmente"; invoice.confidence = 100; invoice.criterion = "Decisão do usuário";
          invoice.explanation = "Os pagamentos selecionados pelo usuário completam o valor da NFS-e.";
          invoice.action = "Vínculo registrado na trilha de auditoria.";
        } else if (invoice.difference > TOLERANCE) {
          invoice.status = "Recebimento parcial"; invoice.confidence = 90; invoice.criterion = "Vínculo manual parcial";
          invoice.explanation = `Após os vínculos confirmados, ainda faltam ${brl.format(invoice.difference)}.`;
          invoice.action = "Continue procurando pagamentos ou registre o motivo do saldo.";
        } else {
          invoice.status = "Recebimento superior"; invoice.confidence = 80; invoice.criterion = "Vínculo manual";
          invoice.explanation = `Os pagamentos confirmados excedem a nota em ${brl.format(Math.abs(invoice.difference))}.`;
          invoice.action = "Desfaça o vínculo incorreto ou distribua o pagamento entre outras notas.";
        }
      }
    });

    // Aplica as conclusões humanas sem apagar a realidade financeira.
    state.invoices.forEach((invoice) => {
      const decision = decisionFor(noteKey(invoice));
      if (!decision) return;
      if (decision.code === "pagamento_parcial_confirmado" || decision.code === "parcial_confirmado") {
        invoice.status = "Pagamento parcial confirmado";
        invoice.confidence = 100;
        invoice.criterion = "Decisão do usuário";
        invoice.explanation = `Os pagamentos localizados foram conferidos. O saldo de ${brl.format(Math.max(0, invoice.difference))} permanece em aberto para acompanhamento.`;
        invoice.action = "Caso encerrado na conferência; acompanhar o saldo em competência futura.";
      } else if (decision.code === "nota_pagamento_nao_localizado" || decision.code === "sem_pagamento") {
        invoice.status = "Pagamento não localizado nesta competência";
        invoice.confidence = 100;
        invoice.criterion = "Decisão do usuário";
        invoice.explanation = "A NFS-e foi conferida, mas nenhum pagamento foi localizado nos recebimentos desta competência.";
        invoice.action = "Acompanhar o recebimento em período futuro; não é necessário revisar novamente nesta conciliação.";
      }
    });
    active.forEach((receipt) => {
      const decision = decisionFor(paymentKey(receipt));
      if (!decision || receipt.finalInvoice) return;
      if (["pagamento_outra_competencia", "outro_mes"].includes(decision.code)) {
        receipt.assignment = "Pagamento de outra competência";
        receipt.confidence = 100;
        receipt.linkReason = decision.comment || "Pagamento classificado pelo usuário como pertencente a NFS-e de outra competência.";
      } else if (decision.code === "pagamento_sem_nota_competencia") {
        receipt.assignment = "NFS-e não localizada nesta competência";
        receipt.confidence = 100;
        receipt.linkReason = decision.comment || "Pagamento conferido, mas a NFS-e não foi localizada nesta competência.";
      } else if (decision.code === "nao_receita") {
        receipt.assignment = "Não classificado como receita";
        receipt.confidence = 100;
        receipt.linkReason = decision.comment || "Lançamento marcado pelo usuário como não pertencente à receita conciliada.";
      }
    });

    buildPossibilities(invoiceNumbers);
    state.result = buildMetrics();
  }

  function buildPossibilities(invoiceNumbers) {
    const activeUnlinked = state.receipts.filter((receipt) => receipt.active && !receipt.finalInvoice && !isResolvedDecision(paymentKey(receipt)));
    const pairs = new Map();
    state.invoices.filter((invoice) => invoice.difference > TOLERANCE && !isResolvedDecision(noteKey(invoice))).forEach((invoice) => {
      const eligible = activeUnlinked.filter((receipt) => {
        const sameDoc = receipt.docNorm && receipt.docNorm === invoice.docNorm;
        const exactRef = receipt.refs.includes(invoice.number);
        const nameScore = nameSimilarity(receipt.displayName, invoice.customer);
        const claimedOtherValid = receipt.refs.some((ref) => invoiceNumbers.has(ref) && ref !== invoice.number);
        return exactRef || sameDoc || (!claimedOtherValid && nameScore >= 68);
      });
      const sameDoc = eligible.filter((receipt) => receipt.docNorm && receipt.docNorm === invoice.docNorm);
      const solutions = findExactSubsets(sameDoc, invoice.difference);
      solutions.forEach((ids, index) => {
        const receipts = sameDoc.filter((receipt) => ids.includes(receipt.id));
        const score = possibilityScore(invoice, receipts);
        const key = `${invoice.number}:${ids.slice().sort((a, b) => a - b).join("+")}`;
        pairs.set(key, {
          key: `possibility:${key}`, invoice: invoice.number, receiptIds: ids, score,
          noteCustomer: invoice.customer, noteAmount: invoice.amount, noteBalance: invoice.difference,
          paymentCustomer: receipts.map((receipt) => receipt.displayName).join(" + "), paymentAmount: sum(receipts, (receipt) => receipt.received),
          reason: `${receipts.length > 1 ? `Combinação de ${receipts.length} pagamentos` : "Pagamento"} com o mesmo CPF/CNPJ e soma exata do saldo.`,
          evidence: ["mesmo CPF/CNPJ", "valor exato", receipts.length > 1 ? "combinação de parcelas" : "um único pagamento"],
        });
        if (index > 1) return;
      });
      eligible.slice(0, 30).forEach((receipt) => {
        const score = possibilityScore(invoice, [receipt]);
        if (score < 52) return;
        const sameDocFlag = receipt.docNorm && receipt.docNorm === invoice.docNorm;
        const exactRef = receipt.refs.includes(invoice.number);
        const nameScore = nameSimilarity(receipt.displayName, invoice.customer);
        const distance = Math.abs(receipt.received - invoice.difference);
        const evidence = [];
        if (exactRef) evidence.push("número da nota citado");
        if (sameDocFlag) evidence.push("mesmo CPF/CNPJ");
        else if (nameScore >= 68) evidence.push(`nome ${nameScore}% semelhante`);
        evidence.push(distance <= TOLERANCE ? "valor exato" : `diferença de ${brl.format(distance)}`);
        const key = `${invoice.number}:${receipt.id}`;
        const current = pairs.get(key);
        const item = {
          key: `possibility:${key}`, invoice: invoice.number, receiptIds: [receipt.id], score,
          noteCustomer: invoice.customer, noteAmount: invoice.amount, noteBalance: invoice.difference,
          paymentCustomer: receipt.displayName, paymentAmount: receipt.received,
          reason: evidence.join(", "), evidence,
        };
        if (!current || current.score < score) pairs.set(key, item);
      });
    });
    state.possibilities = [...pairs.values()].sort((a, b) => b.score - a.score || Math.abs(a.noteBalance - a.paymentAmount) - Math.abs(b.noteBalance - b.paymentAmount));
    state.invoices.forEach((invoice) => {
      const top = state.possibilities.find((item) => item.invoice === invoice.number);
      invoice.topPossibility = top || null;
      if (invoice.difference > TOLERANCE && top && top.score >= 90 && invoice.receivedTotal <= TOLERANCE) {
        invoice.status = "Correspondência sugerida"; invoice.confidence = top.score; invoice.criterion = "CPF/CNPJ, nome e valor";
        invoice.explanation = `Existe uma possibilidade forte: pagamento(s) ID ${top.receiptIds.join(", ")} no total de ${brl.format(top.paymentAmount)}.`;
        invoice.action = "Confira a possibilidade e confirme o vínculo na lista de possibilidades.";
      }
    });
  }

  function buildMetrics() {
    const clear = state.invoices.filter((invoice) => ["Conciliado", "Conciliado manualmente"].includes(invoice.status));
    const notesOpen = state.invoices.filter((invoice) => invoice.difference > TOLERANCE);
    const doubts = state.invoices.filter((invoice) => !["Conciliado", "Conciliado manualmente", "Nota sem recebimento"].includes(invoice.status));
    const paymentsOpen = state.receipts.filter((receipt) => receipt.active && !receipt.finalInvoice);
    return {
      clear, notesOpen, doubts, paymentsOpen,
      totalInvoices: state.invoices.length,
      invoiceTotal: sum(state.invoices, (invoice) => invoice.amount),
      receiptTotal: sum(state.receipts.filter((receipt) => receipt.active), (receipt) => receipt.received),
      clearValue: sum(clear, (invoice) => invoice.amount),
      noteOpenValue: sum(notesOpen, (invoice) => Math.max(0, invoice.difference)),
      doubtValue: sum(doubts, (invoice) => invoice.amount),
      paymentOpenValue: sum(paymentsOpen, (receipt) => receipt.received),
      strongPossibilities: state.possibilities.filter((item) => item.score >= 90),
    };
  }

  function sessionSignature() {
    return [state.excelFile, state.pdfFile].map((file) => file ? `${file.name}:${file.size}:${file.lastModified}` : "").join("|");
  }

  function persist() {
    if (!state.signature) return;
    try {
      const savedAt = new Date();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        signature: state.signature, decisions: state.decisions, manualLinks: state.manualLinks,
        progressBaseline: state.progressBaseline, initialClearCount: state.initialClearCount,
        sessionGoal: state.sessionGoal, savedAt: savedAt.toISOString(),
      }));
      const status = q("#autosaveStatusText");
      if (status) status.textContent = `Salvo automaticamente às ${savedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {}
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
      if (saved?.signature === state.signature) {
        state.decisions = saved.decisions || {}; state.manualLinks = saved.manualLinks || [];
        state.progressBaseline = Number(saved.progressBaseline || 0);
        state.initialClearCount = Number(saved.initialClearCount || 0);
        state.sessionGoal = Number(saved.sessionGoal || 10);
        return true;
      }
    } catch {}
    return false;
  }

  function snapshot(action) {
    state.history.push({ action, decisions: JSON.parse(JSON.stringify(state.decisions)), manualLinks: JSON.parse(JSON.stringify(state.manualLinks)) });
    if (state.history.length > 30) state.history.shift();
    q("#receiptsUndoBtn").disabled = false;
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) return;
    state.decisions = previous.decisions; state.manualLinks = previous.manualLinks;
    q("#receiptsUndoBtn").disabled = !state.history.length;
    reconcileBase(); persist(); renderAll(); notify(`Ação desfeita: ${previous.action}.`);
  }

  function noteKey(invoice) { return `note:${invoice.number}`; }
  function paymentKey(receipt) { return `payment:${receipt.id}`; }

  function decisionFor(key) { return state.decisions[key] || null; }
  function isResolvedDecision(key) {
    const decision = decisionFor(key);
    return Boolean(decision && decision.code !== "revisar");
  }


  function baseWorkRows() {
    if (!state.result) return [];
    const map = new Map();
    const addNote = (invoice, group) => {
      const key = noteKey(invoice);
      if (!map.has(key)) map.set(key, { key, type: "note", group, invoice, amount: Math.max(invoice.amount, Math.abs(invoice.difference || 0)), search: norm(JSON.stringify(invoice)) });
    };
    state.result.doubts.forEach((invoice) => addNote(invoice, "doubts"));
    state.result.notesOpen.forEach((invoice) => addNote(invoice, "notes"));
    state.result.paymentsOpen.forEach((receipt) => {
      const key = paymentKey(receipt);
      map.set(key, { key, type: "payment", group: "payments", receipt, amount: receipt.received, search: norm(JSON.stringify(receipt)) });
    });
    return [...map.values()];
  }

  function allPendingQueueRows() {
    return baseWorkRows().filter((row) => !isResolvedDecision(row.key));
  }

  function progressStats() {
    const currentPendingRows = allPendingQueueRows();
    const currentPending = currentPendingRows.length;
    const baseline = Math.max(Number(state.progressBaseline || 0), currentPending);
    const automatic = Math.max(0, Number(state.initialClearCount || state.result?.clear?.length || 0));
    const humanResolved = Math.max(0, baseline - currentPending);
    const total = Math.max(1, automatic + baseline);
    const overallResolved = Math.min(total, automatic + humanResolved);
    const overallPercent = Math.round((overallResolved / total) * 100);
    const humanPercent = baseline ? Math.round((humanResolved / baseline) * 100) : 100;
    const sessionSolved = Math.max(0, humanResolved - Number(state.sessionStartResolved || 0));
    const remainingValue = state.result
      ? round2(Math.max(Number(state.result.noteOpenValue || 0), Number(state.result.paymentOpenValue || 0)))
      : 0;
    return { currentPendingRows, currentPending, baseline, automatic, humanResolved, total, overallResolved, overallPercent, humanPercent, sessionSolved, remainingValue };
  }

  function nextMilestone(percent) {
    if (percent < 25) return 25;
    if (percent < 50) return 50;
    if (percent < 75) return 75;
    if (percent < 100) return 100;
    return 100;
  }

  function showCelebration(title, message, icon = "✨") {
    const layer = q("#progressCelebration");
    if (!layer) return;
    q("#celebrationIcon").textContent = icon;
    q("#celebrationTitle").textContent = title;
    q("#celebrationText").textContent = message;
    layer.classList.add("show");
    clearTimeout(showCelebration.timer);
    showCelebration.timer = setTimeout(() => layer.classList.remove("show"), 1700);
  }

  function feedbackAfterProgress(before, actionCount = 1) {
    const after = progressStats();
    const delta = Math.max(0, after.humanResolved - before.humanResolved);
    if (!delta) return;
    const plural = delta === 1 ? "caso resolvido" : "casos resolvidos";
    notify(`Boa! ${delta} ${plural}. Restam ${after.currentPending}.`);
    const reached = [25, 50, 75, 100].filter((mark) => before.humanPercent < mark && after.humanPercent >= mark).pop();
    if (reached) {
      state.lastMilestone = reached;
      const titles = { 25: "Primeiro quarto concluído", 50: "Metade do caminho", 75: "Reta final", 100: "Conciliação concluída" };
      const icons = { 25: "🌱", 50: "🚀", 75: "🔥", 100: "✅" };
      showCelebration(titles[reached], reached === 100 ? "Todos os casos que exigiam decisão humana foram tratados." : `Você já concluiu ${reached}% do trabalho de conferência.`, icons[reached]);
    } else if (!state.goalCelebrated && after.sessionSolved >= state.sessionGoal) {
      state.goalCelebrated = true;
      showCelebration("Meta da sessão alcançada", `Você resolveu ${after.sessionSolved} casos nesta sessão.`, "🏁");
    }
  }

  function recommendedPage(stats = progressStats()) {
    const strong = state.result?.strongPossibilities?.filter((item) => !decisionFor(item.key)).length || 0;
    if (strong > 0) return "quick";
    if (stats.currentPending > 12) return "triage";
    if (stats.currentPending > 0) return "queue";
    return "finish";
  }

  function renderProgressHub() {
    if (!state.result) return;
    const stats = progressStats();
    const strong = state.result.strongPossibilities.filter((item) => !isResolvedDecision(item.key)).length;
    state.nextRecommendedPage = recommendedPage(stats);
    const ring = q("#conciliationProgressRing");
    if (ring) ring.style.setProperty("--progress", stats.overallPercent);
    q("#conciliationProgressPercent").textContent = `${stats.overallPercent}%`;
    q("#conciliationProgressBar").style.width = `${stats.overallPercent}%`;
    q("#progressAutomaticCount").textContent = stats.automatic;
    q("#progressHumanCount").textContent = stats.humanResolved;
    q("#progressRemainingCount").textContent = stats.currentPending;
    q("#progressRemainingValue").textContent = brl.format(stats.remainingValue);
    q("#sessionSolvedCount").textContent = stats.sessionSolved;
    q("#sessionGoalCount").textContent = state.sessionGoal;
    q("#sessionGoalSelect").value = String(state.sessionGoal);
    q("#sessionGoalBar").style.width = `${Math.min(100, Math.round((stats.sessionSolved / Math.max(1, state.sessionGoal)) * 100))}%`;
    q("#journeyQuickText").textContent = strong ? `${strong} possibilidade(s) forte(s)` : "Etapa concluída";
    q("#journeyTriageText").textContent = stats.currentPending ? `${stats.currentPending} pendência(s)` : "Etapa concluída";
    q("#journeyQueueText").textContent = stats.currentPending ? `${Math.min(stats.currentPending, 12)} caso(s) prioritário(s)` : "Etapa concluída";
    q("#journeyFinishText").textContent = stats.currentPending ? "Aguardando pendências" : "Pronto para baixar";
    const messages = {
      quick: ["Comece pelos ganhos rápidos", `Há ${strong} possibilidade(s) forte(s) que podem reduzir a fila com pouco esforço.`],
      triage: ["Elimine vários casos de uma vez", `A Central de triagem reúne ${stats.currentPending} pendência(s) para decisão em lote.`],
      queue: ["Agora restam apenas os casos que exigem atenção", `Você já resolveu ${stats.humanResolved}. Trabalhe um caso por vez sem perder o ritmo.`],
      finish: ["Conciliação concluída", "As pendências foram tratadas. Revise a trilha de auditoria e baixe o relatório final."],
    };
    const [title, detail] = messages[state.nextRecommendedPage];
    q("#conciliationProgressTitle").textContent = title;
    q("#conciliationProgressText").textContent = detail;
    q("#conciliationContinueBtn").textContent = state.nextRecommendedPage === "finish" ? "Ir para finalizar" : "Continuar de onde parei";
    q("#sideFinishBadge").textContent = `${stats.overallPercent}%`;
    qa("[data-journey-page]").forEach((button) => {
      const page = button.dataset.journeyPage;
      const done = (page === "quick" && strong === 0) || ((page === "triage" || page === "queue") && stats.currentPending === 0) || (page === "finish" && stats.currentPending === 0);
      button.classList.toggle("done", done);
      button.classList.toggle("current", page === state.nextRecommendedPage);
    });
    qa("[data-conc-page]").forEach((button) => {
      const page = button.dataset.concPage;
      button.classList.toggle("done", (page === "quick" && strong === 0) || ((page === "triage" || page === "queue") && stats.currentPending === 0));
    });
  }


  function unresolvedInvoicesBy(predicate) {
    return (state.invoices || []).filter((invoice) => predicate(invoice) && !isResolvedDecision(noteKey(invoice)));
  }

  function guidedWorkPlan() {
    if (!state.result) return { strong: [], partial: [], notes: [], payments: [], complex: [], total: 0, minutes: 0 };
    const strong = state.result.strongPossibilities.filter((item) =>
      !isResolvedDecision(item.key) && item.receiptIds.every((id) => !state.receipts.find((receipt) => receipt.id === id)?.finalInvoice)
    );
    const partial = unresolvedInvoicesBy((invoice) => invoice.status === "Recebimento parcial" || (invoice.receivedTotal > TOLERANCE && invoice.difference > TOLERANCE));
    const partialKeys = new Set(partial.map((invoice) => invoice.number));
    const notes = unresolvedInvoicesBy((invoice) =>
      invoice.difference > TOLERANCE && !partialKeys.has(invoice.number) && (invoice.status === "Nota sem recebimento" || invoice.receivedTotal <= TOLERANCE)
    );
    const payments = state.result.paymentsOpen.filter((receipt) => !isResolvedDecision(paymentKey(receipt)));
    const classifiedNotes = new Set([...partial, ...notes].map((invoice) => invoice.number));
    const complex = state.result.doubts.filter((invoice) => !classifiedNotes.has(invoice.number) && !isResolvedDecision(noteKey(invoice)));
    const total = new Set([
      ...partial.map((invoice) => noteKey(invoice)),
      ...notes.map((invoice) => noteKey(invoice)),
      ...payments.map((receipt) => paymentKey(receipt)),
      ...complex.map((invoice) => noteKey(invoice)),
    ]).size;
    const minutes = Math.max(1, Math.ceil(strong.length * 0.25 + partial.length * 0.7 + notes.length * 0.8 + payments.length * 0.8 + complex.length * 1.4));
    return { strong, partial, notes, payments, complex, total, minutes };
  }

  function safePossibilities() {
    if (!state.result) return [];
    const high = state.result.strongPossibilities.filter((item) => !isResolvedDecision(item.key));
    const receiptUse = new Map();
    high.forEach((item) => item.receiptIds.forEach((id) => receiptUse.set(id, (receiptUse.get(id) || 0) + 1)));
    const invoiceUse = new Map();
    high.forEach((item) => invoiceUse.set(item.invoice, (invoiceUse.get(item.invoice) || 0) + 1));
    return high.filter((item) => {
      const invoice = state.invoices.find((note) => note.number === item.invoice);
      const receipts = state.receipts.filter((receipt) => item.receiptIds.includes(receipt.id));
      if (!invoice || !receipts.length || receipts.some((receipt) => receipt.finalInvoice)) return false;
      const exactAmount = Math.abs(sum(receipts, (receipt) => receipt.received) - invoice.difference) <= TOLERANCE;
      const sameDoc = receipts.every((receipt) => receipt.docNorm && invoice.docNorm && receipt.docNorm === invoice.docNorm);
      const noDispute = receipts.every((receipt) => receiptUse.get(receipt.id) === 1) && invoiceUse.get(item.invoice) === 1;
      const noOtherReference = receipts.every((receipt) => !receipt.refs.some((ref) => ref !== invoice.number));
      return item.score >= 97 && exactAmount && sameDoc && noDispute && noOtherReference;
    });
  }

  function followUpSummary() {
    const followCodes = new Set(["pagamento_parcial_confirmado", "parcial_confirmado", "pagamento_outra_competencia", "outro_mes", "nota_pagamento_nao_localizado", "sem_pagamento", "pagamento_sem_nota_competencia"]);
    const rows = [];
    Object.entries(state.decisions).forEach(([key, decision]) => {
      if (!followCodes.has(decision.code)) return;
      if (key.startsWith("note:")) {
        const invoice = state.invoices.find((item) => noteKey(item) === key);
        rows.push({ key, type: "note", value: Math.max(0, invoice?.difference || invoice?.amount || 0), label: invoice ? `NFS-e ${invoice.number}` : decision.item, decision });
      } else if (key.startsWith("payment:")) {
        const receipt = state.receipts.find((item) => paymentKey(item) === key);
        rows.push({ key, type: "payment", value: receipt?.received || 0, label: receipt ? `Pagamento ID ${receipt.id}` : decision.item, decision });
      }
    });
    return { rows, count: rows.length, value: sum(rows, (row) => row.value) };
  }

  function dataQualitySummary() {
    const active = state.receipts.filter((receipt) => receipt.active);
    const missingDoc = active.filter((receipt) => !receipt.docNorm).length;
    const missingInvoice = active.filter((receipt) => !receipt.refs.length).length;
    const missingName = active.filter((receipt) => !norm(receipt.displayName)).length;
    const duplicates = new Map();
    active.forEach((receipt) => {
      const key = `${receipt.creditDate}|${receipt.docNorm}|${round2(receipt.received)}|${norm(receipt.invoiceRaw)}`;
      duplicates.set(key, (duplicates.get(key) || 0) + 1);
    });
    const duplicateRows = [...duplicates.values()].filter((count) => count > 1).reduce((total, count) => total + count, 0);
    return { missingDoc, missingInvoice, missingName, duplicateRows, ignored: state.ignored.length };
  }

  function smartDecisionRows(plan = guidedWorkPlan()) {
    const keys = new Set();
    const rows = [];
    [...plan.partial, ...plan.notes, ...plan.complex].forEach((invoice) => {
      const key = noteKey(invoice);
      if (!keys.has(key)) { keys.add(key); rows.push({ type: "note", value: Math.max(0, invoice.difference || invoice.amount), invoice }); }
    });
    plan.payments.forEach((receipt) => {
      const key = paymentKey(receipt);
      if (!keys.has(key)) { keys.add(key); rows.push({ type: "payment", value: receipt.received, receipt }); }
    });
    return rows;
  }

  function renderSmartInbox(plan, stats) {
    const safe = safePossibilities();
    const follow = followUpSummary();
    const decisions = smartDecisionRows(plan);
    const strongValue = sum(plan.strong, (item) => item.paymentAmount);
    const decisionValue = sum(decisions, (row) => row.value);
    const setText = (selector, value) => { const node = q(selector); if (node) node.textContent = value; };
    setText("#smartAutomaticCount", state.result.clear.length);
    setText("#smartAutomaticValue", brl.format(state.result.clearValue));
    setText("#smartConfirmCount", plan.strong.length);
    setText("#smartConfirmValue", brl.format(strongValue));
    setText("#smartDecisionCount", decisions.length);
    setText("#smartDecisionValue", brl.format(decisionValue));
    setText("#smartFollowCount", follow.count);
    setText("#smartFollowValue", brl.format(follow.value));
    setText("#smartSafeCount", safe.length);
    const safeButton = q("#smartSafeConfirmBtn");
    if (safeButton) {
      safeButton.disabled = safe.length === 0;
      safeButton.textContent = safe.length ? `Revisar e confirmar ${safe.length} seguro(s)` : "Nenhum vínculo 100% seguro pendente";
    }
    const preview = q("#smartSafePreview");
    if (preview) preview.innerHTML = safe.length
      ? safe.slice(0, 4).map((item) => `<span>NFS-e ${esc(item.invoice)} ↔ ID ${item.receiptIds.join("+")} · ${brl.format(item.paymentAmount)}</span>`).join("") + (safe.length > 4 ? `<span>+ ${safe.length - 4} vínculo(s)</span>` : "")
      : `<span>Os casos restantes continuam disponíveis para revisão, sem confirmação automática.</span>`;
    const quality = dataQualitySummary();
    const qualityTarget = q("#dataQualityItems");
    if (qualityTarget) {
      const items = [
        [quality.missingDoc, "pagamento(s) sem CPF/CNPJ", "Documento ausente reduz a segurança do vínculo."],
        [quality.missingInvoice, "pagamento(s) sem número de nota", "O sistema dependerá de nome, documento e valor."],
        [quality.duplicateRows, "possível(is) lançamento(s) duplicado(s)", "Confira antes de aceitar valores repetidos."],
        [quality.ignored, "lançamento(s) ignorado(s)", "Transferências e origens não incluídas ficaram fora da receita."],
      ];
      qualityTarget.innerHTML = items.map(([count, title, detail]) => `<article class="${count ? "warn" : "good"}"><strong>${count}</strong><div><span>${esc(title)}</span><small>${esc(detail)}</small></div></article>`).join("");
    }
    setText("#sideAssistantBadge", stats.currentPending);
  }

  function confirmSafePossibilities() {
    const items = safePossibilities();
    if (!items.length) { notify("Nenhum vínculo passou por todos os testes de segurança."); return; }
    const total = sum(items, (item) => item.paymentAmount);
    const message = `${items.length} vínculo(s), total de ${brl.format(total)}. Todos possuem documento igual, soma exata e nenhuma disputa com outra nota. Confirmar?`;
    if (!window.confirm(message)) return;
    confirmPossibilities(items.map((item) => item.key), "Confirmado pela Caixa inteligente após validação de CPF/CNPJ, soma exata e ausência de disputa.");
  }

  function guidedRecommendation(plan = guidedWorkPlan()) {
    if (plan.strong.length) return {
      bucket: "strong", page: "quick", icon: "⚡", title: `Confirme ${plan.strong.length} sugestão(ões) de alta segurança`,
      text: "São os vínculos mais rápidos de revisar. Confira os dados visíveis e confirme em lote somente os que estiverem claros.",
      reason: "Começar aqui reduz a fila com o menor esforço e sem esconder nenhuma evidência.", button: "Revisar sugestões seguras",
    };
    if (plan.partial.length) return {
      bucket: "partial", page: "builder", icon: "◐", title: `Classifique ${plan.partial.length} pagamento(s) parcial(is)`,
      text: "Confirme os pagamentos encontrados e deixe o saldo faltante registrado no relatório.",
      reason: "Esses casos já possuem parte do valor localizado e costumam ser rápidos de concluir.", button: "Tratar pagamentos parciais",
    };
    const notesWithPossibility = plan.notes.filter((invoice) => state.possibilities.some((item) => item.invoice === invoice.number));
    if (notesWithPossibility.length) return {
      bucket: "notes", page: "builder", icon: "🧩", title: `Verifique ${notesWithPossibility.length} nota(s) com recebimentos possíveis`,
      text: "A Mesa de vínculos mostrará a nota de um lado e os pagamentos candidatos do outro, com soma em tempo real.",
      reason: "Há evidências que podem transformar notas sem pagamento em vínculos confirmados.", button: "Abrir a Mesa de vínculos",
    };
    if (plan.payments.length) return {
      bucket: "payments", page: "queue", icon: "R$", title: `Classifique ${plan.payments.length} pagamento(s) sem nota`,
      text: "Veja quem pagou, documento, valor, data, referência e possíveis NFS-e sem precisar voltar ao Excel.",
      reason: "O sistema apresenta uma decisão por vez para manter o trabalho leve e seguro.", button: "Resolver pagamentos sem nota",
    };
    if (plan.notes.length) return {
      bucket: "notes", page: "builder", icon: "⌕", title: `Conclua ${plan.notes.length} nota(s) sem pagamento localizado`,
      text: "Procure um recebimento ou registre que o pagamento não foi localizado nesta competência.",
      reason: "Uma conclusão definitiva retira o caso da fila, mantendo o saldo e a justificativa no relatório.", button: "Tratar notas sem pagamento",
    };
    if (plan.complex.length) return {
      bucket: "complex", page: "queue", icon: "🧠", title: `Restam ${plan.complex.length} caso(s) que exigem atenção`,
      text: "Agora vale analisar um por vez. Todas as informações necessárias aparecem na mesma tela.",
      reason: "Os ganhos rápidos já terminaram; esta é a etapa final da conferência humana.", button: "Resolver casos difíceis",
    };
    return {
      bucket: "finish", page: "finish", icon: "✅", title: "A conciliação está pronta para fechar",
      text: "Revise o resumo, baixe o Excel completo e mantenha a trilha de auditoria.",
      reason: "Não existem pendências que exijam uma nova decisão humana.", button: "Finalizar e baixar relatório",
    };
  }

  function openGuidedBucket(bucket) {
    const plan = guidedWorkPlan();
    if (bucket === "strong") return goPage("quick");
    if (bucket === "partial" || bucket === "notes") {
      const list = bucket === "partial" ? plan.partial : plan.notes;
      if (list[0]) state.builderInvoice = list[0].number;
      state.builderSelected.clear();
      return goPage("builder");
    }
    if (bucket === "payments" || bucket === "complex") {
      state.queueFilter = bucket === "payments" ? "payments" : "doubts";
      state.queueIndex = 0;
      state.queueSearch = "";
      if (q("#queueFilter")) q("#queueFilter").value = state.queueFilter;
      if (q("#queueSearchInput")) q("#queueSearchInput").value = "";
      return goPage("queue");
    }
    return goPage("finish");
  }

  function renderAssistant() {
    if (!state.result) return;
    const plan = guidedWorkPlan();
    const recommendation = guidedRecommendation(plan);
    const stats = progressStats();
    state.guidedNext = { page: recommendation.page, bucket: recommendation.bucket };
    const setText = (selector, value) => { const node = q(selector); if (node) node.textContent = value; };
    setText("#guidedEstimatedTime", plan.total ? `cerca de ${plan.minutes} min` : "concluído");
    setText("#guidedStrongCount", plan.strong.length);
    setText("#guidedPartialCount", plan.partial.length);
    setText("#guidedNotesCount", plan.notes.length);
    setText("#guidedPaymentsCount", plan.payments.length);
    setText("#guidedComplexCount", plan.complex.length);
    setText("#guidedNextIcon", recommendation.icon);
    setText("#guidedNextTitle", recommendation.title);
    setText("#guidedNextText", recommendation.text);
    setText("#guidedNextReason", `Por que agora: ${recommendation.reason}`);
    setText("#guidedContinueBtn", recommendation.button);
    setText("#guidedProgressText", `${stats.humanResolved} de ${stats.baseline} pendência(s) tratadas por você`);
    const bar = q("#guidedProgressBar"); if (bar) bar.style.width = `${stats.humanPercent}%`;
    renderSmartInbox(plan, stats);
    qa("[data-guided-bucket]").forEach((button) => {
      const bucket = button.dataset.guidedBucket;
      const count = plan[bucket]?.length || 0;
      button.classList.toggle("done", count === 0);
      button.classList.toggle("current", bucket === recommendation.bucket);
      button.disabled = count === 0;
    });
  }

  function showGuidedWelcome(force = false) {
    const modal = q("#guidedWelcomeModal");
    if (!modal) return;
    let seen = false;
    try { seen = localStorage.getItem("conferinho_v25_welcome_seen") === "1"; } catch (_) {}
    if (!force && seen) return;
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }

  function hideGuidedWelcome() {
    const modal = q("#guidedWelcomeModal");
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    try { localStorage.setItem("conferinho_v25_welcome_seen", "1"); } catch (_) {}
  }

  function renderRecentDecisions() {
    const target = q("#dashboardRecentDecisions");
    if (!target) return;
    const items = Object.values(state.decisions).slice(-6).reverse();
    if (!items.length) {
      target.innerHTML = `<div class="conc-recent-empty">Quando você resolver um caso, ele aparecerá aqui. Isso ajuda a enxergar o avanço sem precisar abrir o relatório.</div>`;
      return;
    }
    target.innerHTML = items.map((item) => `<div class="conc-recent-item"><span>✓</span><div><strong>${esc(item.item || item.label || "Caso resolvido")}</strong><small>${esc(item.label || "Decisão registrada")} · ${esc(item.at || "agora")}${item.comment ? ` · ${esc(item.comment)}` : ""}</small></div></div>`).join("");
  }

  function currentRows() {
    if (!state.result) return [];
    if (state.view === "clear") return state.result.clear.map((invoice) => ({ key: noteKey(invoice), type: "note", invoice }));
    if (state.view === "doubts") return state.result.doubts.map((invoice) => ({ key: noteKey(invoice), type: "note", invoice }));
    if (state.view === "notes") return state.result.notesOpen.map((invoice) => ({ key: noteKey(invoice), type: "note", invoice }));
    if (state.view === "payments") return state.result.paymentsOpen.map((receipt) => ({ key: paymentKey(receipt), type: "payment", receipt }));
    if (state.view === "possibilities") return state.possibilities.map((possibility) => ({ key: possibility.key, type: "possibility", possibility }));
    const decisionRows = Object.entries(state.decisions).map(([key, decision]) => ({ key, type: "decision", decision }));
    const linkRows = state.manualLinks.map((link, index) => ({ key: `manual:${index}`, type: "manual", link }));
    return [...decisionRows, ...linkRows].sort((a, b) => String(b.decision?.at || b.link?.at || "").localeCompare(String(a.decision?.at || a.link?.at || "")));
  }

  function filteredRows() {
    let rows = currentRows();
    const term = norm(state.search);
    if (term) rows = rows.filter((row) => norm(JSON.stringify(row)).includes(term));
    if (state.easyOnly) {
      rows = rows.filter((row) => {
        if (row.type === "possibility") return row.possibility.score >= 90;
        if (row.type === "note") return row.invoice.confidence >= 90;
        return false;
      });
    }
    if (state.hideResolved && state.view !== "decisions") rows = rows.filter((row) => !isResolvedDecision(row.key));
    return rows;
  }

  function statusClass(status) {
    if (["Conciliado", "Conciliado manualmente"].includes(status)) return "ok";
    if (["Nota sem recebimento", "Recebimento superior"].includes(status)) return "bad";
    if (["Recebimento parcial", "Correspondência sugerida", "Conciliado com divergência cadastral", "Conciliado com lançamentos indevidos", "Lançamento com múltiplas notas"].includes(status)) return "warn";
    return "info";
  }

  function assignedReceipts(invoice) {
    const ids = [...invoice.confirmedReceiptIds, ...invoice.manualReceiptIds];
    return state.receipts.filter((receipt) => ids.includes(receipt.id));
  }

  function possibilityText(invoice) {
    const options = state.possibilities.filter((item) => item.invoice === invoice.number).slice(0, 3);
    if (!options.length) return "Nenhuma possibilidade forte encontrada";
    return options.map((item) => `${item.score}% · ID ${item.receiptIds.join("+")} · ${brl.format(item.paymentAmount)}`).join(" | ");
  }

  function renderNoteRow(row) {
    const invoice = row.invoice; const linked = assignedReceipts(invoice); const decision = decisionFor(row.key);
    const payments = linked.length ? linked.map((receipt) => `ID ${receipt.id} (${brl.format(receipt.received)})`).join(", ") : "Nenhum confirmado";
    return `<tr class="${decision ? "is-resolved" : ""} ${invoice.confidence >= 90 ? "high-confidence" : ""}">
      <td class="receipts-check-cell"><input class="receipts-check" type="checkbox" data-select-key="${esc(row.key)}" ${state.selected.has(row.key) ? "checked" : ""}></td>
      <td><span class="receipts-status ${statusClass(invoice.status)}">${esc(invoice.status)}</span><span class="receipts-secondary">${esc(invoice.criterion)}</span></td>
      <td><span class="receipts-primary">NFS-e ${esc(invoice.number)}</span><span class="receipts-secondary">${esc(invoice.customer)}</span><span class="receipts-secondary">${esc(formatDoc(invoice.document))} · ${esc(invoice.issueDate)}</span></td>
      <td class="receipts-money">${brl.format(invoice.amount)}</td>
      <td class="receipts-money">${brl.format(invoice.receivedTotal)}<span class="receipts-secondary">${esc(payments)}</span></td>
      <td class="receipts-money">${brl.format(invoice.difference)}</td>
      <td><div class="receipts-confidence"><div class="receipts-confidence-bar"><i style="width:${Math.max(0, invoice.confidence)}%"></i></div><b>${invoice.confidence}%</b></div><span class="receipts-secondary">${esc(invoice.explanation)}</span></td>
      <td><span class="receipts-secondary">${esc(invoice.action)}</span>${invoice.difference > TOLERANCE ? `<span class="receipts-combo">Possibilidades: ${esc(possibilityText(invoice))}</span>` : ""}${decision ? `<span class="receipts-decision-note">Decisão: ${esc(decision.label)}</span>` : ""}</td>
      <td><div class="receipts-row-actions"><button class="receipts-row-button" data-detail-type="note" data-detail-id="${esc(invoice.number)}">Ver detalhes</button></div></td>
    </tr>`;
  }

  function renderPaymentRow(row) {
    const receipt = row.receipt; const decision = decisionFor(row.key);
    const related = state.possibilities.filter((item) => item.receiptIds.includes(receipt.id)).slice(0, 3);
    return `<tr class="${decision ? "is-resolved" : ""}">
      <td class="receipts-check-cell"><input class="receipts-check" type="checkbox" data-select-key="${esc(row.key)}" ${state.selected.has(row.key) ? "checked" : ""}></td>
      <td><span class="receipts-status bad">Sem nota confirmada</span><span class="receipts-secondary">ID ${receipt.id} · linha ${receipt.sourceRow}</span></td>
      <td><span class="receipts-primary">${esc(receipt.displayName || "Cliente não informado")}</span><span class="receipts-secondary">${esc(formatDoc(receipt.document))}</span><span class="receipts-secondary">Crédito em ${esc(receipt.creditDate || "data não informada")}</span></td>
      <td class="receipts-money">${brl.format(receipt.received)}</td>
      <td><span class="receipts-primary">${esc(receipt.invoiceRaw || "N/D")}</span><span class="receipts-secondary">Referência informada no Excel</span></td>
      <td colspan="2"><span class="receipts-secondary">${related.length ? related.map((item) => `${item.score}% · NFS-e ${item.invoice}`).join(" | ") : "Nenhuma NFS-e com compatibilidade suficiente foi encontrada."}</span></td>
      <td><span class="receipts-secondary">${receipt.refs.length ? "O número informado não produziu um vínculo seguro." : "A planilha não informou uma nota válida para este recebimento."}</span>${decision ? `<span class="receipts-decision-note">Decisão: ${esc(decision.label)}</span>` : ""}</td>
      <td><div class="receipts-row-actions"><button class="receipts-row-button" data-detail-type="payment" data-detail-id="${receipt.id}">Ver detalhes</button></div></td>
    </tr>`;
  }

  function renderPossibilityRow(row) {
    const item = row.possibility; const decision = decisionFor(row.key);
    return `<tr class="${decision ? "is-resolved" : ""} ${item.score >= 90 ? "high-confidence" : ""}">
      <td class="receipts-check-cell"><input class="receipts-check" type="checkbox" data-select-key="${esc(row.key)}" ${state.selected.has(row.key) ? "checked" : ""}></td>
      <td><div class="receipts-confidence"><div class="receipts-confidence-bar"><i style="width:${item.score}%"></i></div><b>${item.score}%</b></div><span class="receipts-secondary">Compatibilidade</span></td>
      <td><span class="receipts-primary">NFS-e ${esc(item.invoice)}</span><span class="receipts-secondary">${esc(item.noteCustomer)}</span><span class="receipts-secondary">Saldo ${brl.format(item.noteBalance)}</span></td>
      <td class="receipts-money">${brl.format(item.noteAmount)}</td>
      <td><span class="receipts-primary">Pagamento ID ${item.receiptIds.join(" + ")}</span><span class="receipts-secondary">${esc(item.paymentCustomer)}</span></td>
      <td class="receipts-money">${brl.format(item.paymentAmount)}</td>
      <td colspan="2"><span class="receipts-secondary">${esc(item.reason)}</span>${decision ? `<span class="receipts-decision-note">Decisão: ${esc(decision.label)}</span>` : ""}</td>
      <td><div class="receipts-row-actions"><button class="receipts-row-button" data-detail-type="possibility" data-detail-id="${esc(item.key)}">Ver detalhes</button><button class="receipts-row-button confirm" data-confirm-possibility="${esc(item.key)}">Confirmar</button></div></td>
    </tr>`;
  }

  function renderDecisionRow(row) {
    if (row.type === "manual") {
      const link = row.link; const receipts = state.receipts.filter((receipt) => link.receiptIds.includes(receipt.id));
      return `<tr><td></td><td><span class="receipts-status ok">Vínculo manual</span></td><td><span class="receipts-primary">NFS-e ${esc(link.invoice)}</span><span class="receipts-secondary">Pagamento(s) ID ${link.receiptIds.join(" + ")}</span></td><td class="receipts-money">${brl.format(sum(receipts, (receipt) => receipt.received))}</td><td colspan="4"><span class="receipts-secondary">${esc(link.comment || "Vínculo confirmado na Central de Conciliação.")}</span><span class="receipts-decision-note">${esc(link.at)}</span></td><td></td></tr>`;
    }
    const decision = row.decision;
    return `<tr><td></td><td><span class="receipts-status info">${esc(decision.label)}</span></td><td><span class="receipts-primary">${esc(decision.item)}</span><span class="receipts-secondary">${esc(decision.view)}</span></td><td></td><td colspan="4"><span class="receipts-secondary">${esc(decision.comment || "Sem comentário.")}</span><span class="receipts-decision-note">${esc(decision.at)}</span></td><td></td></tr>`;
  }

  function tableHeader() {
    if (state.view === "payments") return `<thead><tr><th></th><th>Situação</th><th>Pagamento / cliente</th><th>Valor recebido</th><th>Nota informada</th><th colspan="2">Possíveis NFS-e</th><th>Por que ficou sem nota</th><th></th></tr></thead>`;
    if (state.view === "possibilities") return `<thead><tr><th></th><th>Confiança</th><th>Nota da prefeitura</th><th>Valor da nota</th><th>Pagamento sugerido</th><th>Valor</th><th colspan="2">Por que é uma possibilidade</th><th></th></tr></thead>`;
    if (state.view === "decisions") return `<thead><tr><th></th><th>Decisão</th><th>Item</th><th>Valor</th><th colspan="4">Comentário / registro</th><th></th></tr></thead>`;
    return `<thead><tr><th></th><th>Situação</th><th>NFS-e / tomador</th><th>Valor da nota</th><th>Valor localizado</th><th>Diferença</th><th>Por que ficou assim</th><th>Próxima ação</th><th></th></tr></thead>`;
  }

  function renderTable() {
    const rows = filteredRows();
    q("#receiptsVisibleCount").textContent = `${rows.length} item(ns)`;
    q("#receiptsSelectedCount").textContent = `${state.selected.size} selecionado(s)`;
    q("#receiptsEmpty").classList.toggle("hidden", rows.length > 0);
    q("#receiptsTableWrap").innerHTML = rows.length ? `<table class="receipts-table">${tableHeader()}<tbody>${rows.map((row) => {
      if (row.type === "note") return renderNoteRow(row);
      if (row.type === "payment") return renderPaymentRow(row);
      if (row.type === "possibility") return renderPossibilityRow(row);
      return renderDecisionRow(row);
    }).join("")}</tbody></table>` : "";
    qa("[data-select-key]", q("#receiptsTableWrap")).forEach((input) => input.addEventListener("change", () => {
      if (input.checked) state.selected.add(input.dataset.selectKey); else state.selected.delete(input.dataset.selectKey);
      q("#receiptsSelectedCount").textContent = `${state.selected.size} selecionado(s)`;
    }));
    qa("[data-detail-type]", q("#receiptsTableWrap")).forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.detailType, button.dataset.detailId)));
    qa("[data-confirm-possibility]", q("#receiptsTableWrap")).forEach((button) => button.addEventListener("click", () => confirmPossibilities([button.dataset.confirmPossibility], "Vínculo confirmado individualmente.")));
  }

  function renderSummary() {
    const result = state.result; if (!result) return;
    q("#receiptsClearCount").textContent = result.clear.length; q("#receiptsClearValue").textContent = brl.format(result.clearValue);
    q("#receiptsDoubtCount").textContent = result.doubts.length; q("#receiptsDoubtValue").textContent = brl.format(result.doubtValue);
    q("#receiptsNoteOpenCount").textContent = result.notesOpen.length; q("#receiptsNoteOpenValue").textContent = brl.format(result.noteOpenValue);
    q("#receiptsPaymentOpenCount").textContent = result.paymentsOpen.length; q("#receiptsPaymentOpenValue").textContent = brl.format(result.paymentOpenValue);
    q("#receiptsResultSubtitle").textContent = `${result.totalInvoices} NFS-e · ${brl.format(result.invoiceTotal)} emitidos · ${brl.format(result.receiptTotal)} em recebimentos considerados.`;
    const decisionsCount = Object.keys(state.decisions).length + state.manualLinks.length;
    q("#receiptsProgressResolved").textContent = decisionsCount;
    const strong = result.strongPossibilities.length;
    q("#receiptsCommandTitle").textContent = strong
      ? `Existem ${strong} possibilidade(s) forte(s) que podem reduzir a fila rapidamente.`
      : `${result.clear.length} nota(s) já estão claras. Agora concentre-se nas pendências.`;
    q("#receiptsCommandText").textContent = `${result.notesOpen.length} nota(s) ainda não possuem pagamento completo e ${result.paymentsOpen.length} pagamento(s) continuam sem nota confirmada. O sistema não altera o Excel original.`;
    qa("[data-receipts-view]").forEach((button) => button.classList.toggle("active", button.dataset.receiptsView === state.view));
    q("#receiptsViewHelp").textContent = VIEW_HELP[state.view];
    q("#receiptsBulkBar").classList.toggle("hidden", state.view === "decisions");
    q("#receiptsEasyOnly").disabled = !["clear", "doubts", "possibilities"].includes(state.view);
  }


  const PAGE_TITLES = {
    assistant: "Caixa inteligente",
    dashboard: "Resumo da conciliação",
    quick: "Revisão rápida",
    triage: "Central de triagem",
    builder: "Mesa de vínculos",
    queue: "Fila de conciliação",
    consult: "Consultar vínculo",
    finish: "Finalizar e baixar",
  };

  function goPage(page, scroll = true) {
    if (!PAGE_TITLES[page]) page = "dashboard";
    state.page = page;
    document.body.dataset.concPage = page;
    qa("[data-conc-section]").forEach((section) => section.classList.toggle("active", section.dataset.concSection === page));
    qa("[data-conc-page]").forEach((button) => button.classList.toggle("active", button.dataset.concPage === page));
    const advancedMenu = q(".conc-advanced-menu");
    if (advancedMenu && ["quick", "triage", "builder"].includes(page)) advancedMenu.open = true;
    const hub = q("#conciliationProgressHub");
    if (hub) hub.classList.toggle("context-hidden", !["assistant", "dashboard", "quick", "triage"].includes(page));
    renderPageGuide(page);
    if (page === "assistant") renderAssistant();
    if (page === "quick") renderQuickReview();
    if (page === "builder") renderBuilder();
    if (page === "queue") renderQueue();
    if (page === "consult") renderConsultResults();
    if (page === "finish") renderFinish();
    if (scroll) q(".conc-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pendingQueueRows() {
    let rows = allPendingQueueRows();
    if (state.queueFilter !== "all") rows = rows.filter((row) => row.group === state.queueFilter);
    if (state.queueSearch) rows = rows.filter((row) => row.search.includes(norm(state.queueSearch)));
    return rows.sort((a, b) => b.amount - a.amount);
  }

  function renderDashboard() {
    if (!state.result) return;
    const pending = pendingQueueRows();
    const preview = q("#dashboardPendingPreview");
    const impact = q("#dashboardImpactPreview");
    if (preview) {
      preview.innerHTML = pending.length ? pending.slice(0, 6).map((row) => {
        if (row.type === "note") return `<div class="conc-preview-item"><span class="conc-preview-icon warm">NF</span><div><strong>NFS-e ${esc(row.invoice.number)} · ${esc(row.invoice.customer)}</strong><small>${esc(row.invoice.status)} · ${esc(row.invoice.action)}</small></div><em>${brl.format(Math.max(0, row.invoice.difference))}</em></div>`;
        return `<div class="conc-preview-item"><span class="conc-preview-icon">R$</span><div><strong>Pagamento ID ${row.receipt.id} · ${esc(row.receipt.displayName)}</strong><small>Sem NFS-e confirmada · nota informada ${esc(row.receipt.invoiceRaw || "N/D")}</small></div><em>${brl.format(row.receipt.received)}</em></div>`;
      }).join("") : `<div class="empty-results"><div>✓</div><strong>Nenhuma pendência aberta</strong><span>A conciliação está pronta para finalizar.</span></div>`;
    }
    if (impact) {
      const impactRows = [
        ...state.result.notesOpen.map((invoice) => ({ kind: "Nota", label: `NFS-e ${invoice.number}`, customer: invoice.customer, amount: Math.max(0, invoice.difference), detail: invoice.status })),
        ...state.result.paymentsOpen.map((receipt) => ({ kind: "Pagamento", label: `ID ${receipt.id}`, customer: receipt.displayName, amount: receipt.received, detail: "Sem nota confirmada" })),
      ].sort((a, b) => b.amount - a.amount).slice(0, 6);
      impact.innerHTML = impactRows.length ? impactRows.map((item) => `<div class="conc-preview-item"><span class="conc-preview-icon">${item.kind === "Nota" ? "NF" : "R$"}</span><div><strong>${esc(item.label)} · ${esc(item.customer)}</strong><small>${esc(item.detail)}</small></div><em>${brl.format(item.amount)}</em></div>`).join("") : `<div class="empty-results"><div>✓</div><strong>Sem impacto pendente</strong><span>Todos os valores foram tratados.</span></div>`;
    }
    q("#sideQuickBadge").textContent = state.result.strongPossibilities.filter((item) => !isResolvedDecision(item.key)).length;
    q("#sideTriageBadge").textContent = pending.length;
    q("#sideQueueBadge").textContent = pending.length;
    const stats = progressStats();
    q("#dashboardProgressNarrative").textContent = stats.humanResolved
      ? `Você já retirou ${stats.humanResolved} caso(s) da fila. Restam ${stats.currentPending}; cada decisão continua salva na trilha de auditoria.`
      : `A análise automática já resolveu ${stats.automatic} nota(s). Agora o progresso humano começa pelos casos mais fáceis.`;
    renderRecentDecisions();
  }

  function renderQuickReview() {
    if (!state.result) return;
    const items = state.result.strongPossibilities.filter((item) => !isResolvedDecision(item.key) && item.receiptIds.every((id) => !state.receipts.find((receipt) => receipt.id === id)?.finalInvoice));
    q("#quickStrongCount").textContent = items.length;
    const list = q("#quickReviewList");
    if (!items.length) {
      list.innerHTML = `<div class="panel empty-results"><div>✓</div><strong>Nenhuma possibilidade forte pendente</strong><span>Avance para a Central de triagem ou para a fila.</span></div>`;
      q("#quickConfirmBtn").disabled = true;
      return;
    }
    q("#quickConfirmBtn").disabled = false;
    list.innerHTML = items.map((item) => {
      const invoice = state.invoices.find((note) => note.number === item.invoice);
      const receipts = state.receipts.filter((receipt) => item.receiptIds.includes(receipt.id));
      return `<article class="conc-quick-card"><label><input class="quick-check" data-score="${item.score}" type="checkbox" value="${esc(item.key)}"></label><div class="conc-quick-card-head"><span class="conc-score">${item.score}%</span><div><h3>NFS-e ${esc(item.invoice)} ↔ pagamento ${item.receiptIds.length > 1 ? "IDs " + item.receiptIds.join(" + ") : "ID " + item.receiptIds[0]}</h3><small>${esc(item.reason)}</small></div></div><div class="conc-quick-pair"><div class="conc-pair-side"><span>NOTA DA PREFEITURA</span><strong>${brl.format(invoice?.amount || item.noteAmount)}</strong><small>${esc(invoice?.customer || item.noteCustomer)}</small></div><span>↔</span><div class="conc-pair-side warm"><span>PAGAMENTO SUGERIDO</span><strong>${brl.format(item.paymentAmount)}</strong><small>${esc(receipts.map((receipt) => receipt.displayName).join(" + "))}</small></div></div><p class="conc-quick-reason"><b>Evidências:</b> ${esc(item.evidence.join(" · "))}</p></article>`;
    }).join("");
  }

  function builderInvoiceOptions() {
    const term = norm(q("#builderInvoiceSearch")?.value || "");
    const sortMode = q("#builderInvoiceSort")?.value || "impact";
    let invoices = state.invoices.filter((invoice) => invoice.difference > TOLERANCE && !isResolvedDecision(noteKey(invoice)));
    if (term) {
      invoices = invoices.filter((invoice) => norm([
        invoice.number, invoice.customer, invoice.document, invoice.issueDate,
        invoice.amount, invoice.difference, invoice.status,
      ].join(" ")).includes(term));
    }
    return invoices.sort((a, b) => {
      if (sortMode === "date") return (dateToTime(a.issueDate) || 0) - (dateToTime(b.issueDate) || 0) || Number(a.number) - Number(b.number);
      if (sortMode === "number") return Number(a.number) - Number(b.number);
      if (sortMode === "customer") return String(a.customer || "").localeCompare(String(b.customer || ""), "pt-BR");
      return b.difference - a.difference || b.amount - a.amount;
    });
  }

  function builderReceiptAssessment(invoice, receipt) {
    const score = possibilityScore(invoice, [receipt]);
    const sameDoc = Boolean(receipt.docNorm && invoice.docNorm && receipt.docNorm === invoice.docNorm);
    const exactRef = receipt.refs.includes(invoice.number);
    const nameScore = nameSimilarity(receipt.displayName, invoice.customer);
    const amountDistance = Math.abs(receipt.received - invoice.difference);
    const invoiceTime = dateToTime(invoice.issueDate);
    const receiptTime = dateToTime(receipt.creditDate);
    const days = invoiceTime && receiptTime ? Math.round(Math.abs(invoiceTime - receiptTime) / 86400000) : null;
    const evidence = [];
    if (exactRef) evidence.push("NFS-e informada no Excel");
    if (sameDoc) evidence.push("CPF/CNPJ confere");
    else if (receipt.document) evidence.push("CPF/CNPJ diferente");
    if (nameScore >= 88) evidence.push("Nome muito semelhante");
    else if (nameScore >= 65) evidence.push("Nome parcialmente semelhante");
    if (amountDistance <= TOLERANCE) evidence.push("Valor fecha sozinho");
    else if (amountDistance <= Math.max(5, invoice.difference * .15)) evidence.push("Valor próximo do saldo");
    if (days !== null && days <= 31) evidence.push(days === 0 ? "Mesma data" : `${days} dia(s) da emissão`);
    return { score, sameDoc, exactRef, nameScore, amountDistance, days, evidence };
  }

  function builderCandidateReceipts(invoice) {
    const term = norm(q("#builderSearchInput")?.value || "");
    const suggestedOnly = q("#builderSuggestedOnly")?.checked ?? true;
    let receipts = state.receipts.filter((receipt) => receipt.active && !receipt.finalInvoice && !isResolvedDecision(paymentKey(receipt)));
    if (term) receipts = receipts.filter((receipt) => norm(JSON.stringify(receipt)).includes(term));
    if (suggestedOnly && invoice) receipts = receipts.filter((receipt) => {
      const assessment = builderReceiptAssessment(invoice, receipt);
      return assessment.score >= 52 || assessment.exactRef || assessment.sameDoc || (assessment.nameScore >= 72 && assessment.amountDistance <= Math.max(10, invoice.difference * .4));
    });
    return receipts.sort((a, b) => {
      const aAssessment = builderReceiptAssessment(invoice, a);
      const bAssessment = builderReceiptAssessment(invoice, b);
      return bAssessment.score - aAssessment.score || aAssessment.amountDistance - bAssessment.amountDistance || a.id - b.id;
    });
  }

  function renderBuilderInvoiceCards(invoices, current) {
    const list = q("#builderInvoicesList");
    q("#builderInvoiceCount").textContent = `${invoices.length} nota(s)`;
    q("#builderInvoiceTotal").textContent = brl.format(sum(invoices, (invoice) => invoice.difference));
    if (!invoices.length) {
      list.innerHTML = `<div class="empty-results"><div>✓</div><strong>Nenhuma nota encontrada</strong><span>Altere a pesquisa ou finalize a conciliação.</span></div>`;
      return;
    }
    list.innerHTML = invoices.map((invoice) => {
      const possibilities = state.possibilities.filter((item) => item.invoice === invoice.number && item.receiptIds.every((id) => !state.receipts.find((receipt) => receipt.id === id)?.finalInvoice));
      const strong = possibilities.filter((item) => item.score >= 90).length;
      const selected = invoice.number === current;
      const statusClass = strong ? "good" : possibilities.length ? "warn" : "neutral";
      return `<button type="button" class="conc-linkdesk-invoice-card ${selected ? "selected" : ""}" data-builder-invoice="${esc(invoice.number)}">
        <div class="conc-linkdesk-invoice-top"><span>NFS-e ${esc(invoice.number)}</span><em>${brl.format(invoice.difference)} em aberto</em></div>
        <strong>${esc(invoice.customer)}</strong>
        <small>${esc(invoice.issueDate || "Data não informada")} · ${esc(formatDoc(invoice.document) || "Documento não informado")}</small>
        <div class="conc-linkdesk-invoice-values"><span>Nota <b>${brl.format(invoice.amount)}</b></span><span>Localizado <b>${brl.format(invoice.receivedTotal)}</b></span></div>
        <div class="conc-linkdesk-invoice-foot"><span class="${statusClass}">${strong ? `${strong} possibilidade(s) forte(s)` : possibilities.length ? `${possibilities.length} possibilidade(s)` : "Sem sugestão forte"}</span><span>${esc(invoice.status)}</span></div>
      </button>`;
    }).join("");
    qa("[data-builder-invoice]", list).forEach((button) => button.addEventListener("click", () => {
      state.builderInvoice = button.dataset.builderInvoice;
      state.builderSelected.clear();
      state.builderOutcome = "";
      renderBuilder();
    }));
  }

  function builderBestExactSelection(invoice, candidates) {
    const strong = state.possibilities
      .filter((item) => item.invoice === invoice.number && Math.abs(item.paymentAmount - invoice.difference) <= TOLERANCE)
      .filter((item) => item.receiptIds.every((id) => candidates.some((receipt) => receipt.id === id)))
      .sort((a, b) => b.score - a.score)[0];
    if (strong) return strong.receiptIds;
    return findExactSubsets(candidates, invoice.difference, 6, 1)[0] || [];
  }

  function renderBuilder() {
    if (!state.result) return;
    const select = q("#builderInvoiceSelect");
    const invoices = builderInvoiceOptions();
    const current = state.builderInvoice && invoices.some((invoice) => invoice.number === state.builderInvoice)
      ? state.builderInvoice
      : (invoices[0]?.number || "");
    const signature = invoices.map((invoice) => invoice.number).join("|");
    if (select.dataset.signature !== signature) {
      select.innerHTML = invoices.length
        ? invoices.map((invoice) => `<option value="${esc(invoice.number)}">NFS-e ${esc(invoice.number)}</option>`).join("")
        : `<option value="">Nenhuma nota com saldo</option>`;
      select.dataset.signature = signature;
    }
    state.builderInvoice = current;
    select.value = current;
    renderBuilderInvoiceCards(invoices, current);

    const invoice = state.invoices.find((item) => item.number === current);
    if (!invoice) {
      q("#builderInvoiceSummary").innerHTML = `<strong>Sem nota selecionada</strong><span>Escolha uma nota da lista ao lado.</span>`;
      q("#builderPaymentsList").innerHTML = `<div class="empty-results"><div>✓</div><strong>Nada para vincular</strong></div>`;
      q("#builderConfirmBtn").disabled = true;
      q("#builderAutoFitBtn").disabled = true;
      renderBuilderEquation(null);
      return;
    }

    q("#builderInvoiceSummary").innerHTML = `<div><span>NOTA SELECIONADA</span><strong>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</strong><small>${esc(invoice.issueDate)} · ${esc(formatDoc(invoice.document) || "Documento não informado")}</small></div><div><span>SALDO A LOCALIZAR</span><strong>${brl.format(invoice.difference)}</strong><small>Nota ${brl.format(invoice.amount)} · já localizado ${brl.format(invoice.receivedTotal)}</small></div>`;

    const candidates = builderCandidateReceipts(invoice);
    state.builderSelected = new Set([...state.builderSelected].filter((id) => candidates.some((receipt) => receipt.id === id)));
    const exactSelection = builderBestExactSelection(invoice, candidates);
    const autoFit = q("#builderAutoFitBtn");
    autoFit.disabled = !exactSelection.length;
    autoFit.textContent = exactSelection.length ? `✨ Selecionar combinação que fecha (${exactSelection.length})` : "Sem combinação exata";

    const availableTotal = sum(candidates, (receipt) => receipt.received);
    q("#builderPaymentsList").innerHTML = candidates.length ? `<div class="conc-linkdesk-candidate-summary"><span>${candidates.length} pagamento(s) exibido(s)</span><strong>${brl.format(availableTotal)} disponíveis</strong></div>${candidates.slice(0, 180).map((receipt) => {
      const assessment = builderReceiptAssessment(invoice, receipt);
      const checked = state.builderSelected.has(receipt.id);
      const scoreClass = assessment.score >= 85 ? "good" : assessment.score >= 60 ? "warn" : "low";
      const warning = assessment.sameDoc ? "" : receipt.document ? `<span class="bad">Documento diferente</span>` : `<span class="warn">Documento ausente</span>`;
      return `<label class="conc-linkdesk-payment-card ${checked ? "selected" : ""}">
        <input class="builder-payment-check" type="checkbox" value="${receipt.id}" ${checked ? "checked" : ""}>
        <div class="conc-linkdesk-payment-main">
          <div class="conc-linkdesk-payment-title"><strong>${esc(receipt.displayName || "Pagador não identificado")}</strong><em>${brl.format(receipt.received)}</em></div>
          <small>${esc(formatDoc(receipt.document) || "Documento não informado")} · ${esc(receipt.creditDate || "Data não informada")} · ID ${receipt.id}</small>
          <div class="conc-linkdesk-payment-meta"><span>Nota no Excel: <b>${esc(receipt.invoiceRaw || "N/D")}</b></span><span>Origem: <b>${esc(receipt.origin || "Não informada")}</b></span></div>
          <div class="conc-linkdesk-evidence-tags">${assessment.evidence.slice(0, 4).map((item) => `<span>${esc(item)}</span>`).join("")}${warning}</div>
        </div>
        <div class="conc-linkdesk-score ${scoreClass}"><strong>${assessment.score}%</strong><small>compatível</small></div>
      </label>`;
    }).join("")}` : `<div class="empty-results"><div>⌕</div><strong>Nenhum pagamento encontrado</strong><span>Desmarque “Priorizar compatíveis” ou altere a pesquisa.</span></div>`;

    qa(".builder-payment-check", q("#builderPaymentsList")).forEach((input) => input.addEventListener("change", () => {
      const id = Number(input.value);
      if (input.checked) state.builderSelected.add(id); else state.builderSelected.delete(id);
      state.builderOutcome = "";
      renderBuilder();
    }));
    renderBuilderEquation(invoice);
  }

  function builderOutcomeAvailability(invoice, selected, remaining) {
    const exact = selected.length > 0 && Math.abs(remaining) <= TOLERANCE;
    const partial = selected.length > 0 && remaining > TOLERANCE;
    const over = selected.length > 0 && remaining < -TOLERANCE;
    return {
      exact,
      partial,
      over,
      complete: exact,
      other_period: selected.length > 0,
      not_found: selected.length === 0,
    };
  }

  function builderOutcomeLabel(code) {
    const labels = {
      complete: "Vínculo completo",
      partial: "Pagamento parcial confirmado — saldo permanece em aberto",
      other_period: "Pagamento pertence a NFS-e de outra competência",
      not_found: "Nota emitida — pagamento não localizado nesta competência",
    };
    return labels[code] || "Escolha uma conclusão";
  }

  function renderBuilderOutcome(invoice, selected, remaining, availability) {
    const grid = q("#builderOutcomeGrid");
    if (!grid) return;
    const recommended = availability.exact ? "complete" : availability.partial ? "partial" : (!selected.length ? "not_found" : "");
    if (!state.builderOutcome || (state.builderOutcome === "complete" && !availability.complete) || (state.builderOutcome === "partial" && !availability.partial) || (state.builderOutcome === "not_found" && !availability.not_found)) {
      state.builderOutcome = recommended;
    }

    const rules = {
      complete: { enabled: availability.complete, why: availability.complete ? "A soma selecionada fecha exatamente o saldo da nota." : "Disponível somente quando os pagamentos fecharem o saldo da NFS-e." },
      partial: { enabled: availability.partial, why: availability.partial ? `O vínculo será registrado e ${brl.format(remaining)} continuará em aberto no relatório.` : "Disponível quando existe pagamento selecionado menor que o saldo da nota." },
      other_period: { enabled: availability.other_period, why: availability.other_period ? "Os pagamentos serão classificados como pertencentes a outra competência e não serão vinculados a esta NFS-e." : "Selecione um ou mais pagamentos para classificá-los em outra competência." },
      not_found: { enabled: availability.not_found, why: availability.not_found ? "A nota será marcada como conferida sem pagamento localizado nesta competência." : "Limpe a seleção para registrar que nenhum pagamento foi localizado." },
    };

    qa("[data-outcome-card]", grid).forEach((card) => {
      const code = card.dataset.outcomeCard;
      const input = q("input", card);
      const rule = rules[code];
      input.disabled = !rule.enabled;
      input.checked = state.builderOutcome === code;
      card.classList.toggle("selected", state.builderOutcome === code);
      card.classList.toggle("disabled", !rule.enabled);
      card.title = rule.why;
      input.onchange = () => {
        state.builderOutcome = code;
        renderBuilderEquation(invoice);
      };
    });

    const explanation = q("#builderOutcomeExplanation");
    const chosen = rules[state.builderOutcome];
    const progress = q("#builderOutcomeProgress");
    if (chosen) {
      explanation.className = `conc-builder-outcome-explanation ${state.builderOutcome}`;
      explanation.innerHTML = `<strong>${esc(builderOutcomeLabel(state.builderOutcome))}</strong><span>${esc(chosen.why)}</span><small>Ao registrar, este caso deixa a fila humana quando a conclusão for definitiva. O relatório mantém o saldo e a justificativa para auditoria.</small>`;
      progress.textContent = state.builderOutcome === "partial" ? "Encerra a análise · mantém saldo" : state.builderOutcome === "other_period" ? "Classifica os pagamentos" : state.builderOutcome === "not_found" ? "Encerra a análise da nota" : "Fecha a nota";
      progress.className = `conc-outcome-progress ${state.builderOutcome}`;
    } else if (availability.over) {
      explanation.className = "conc-builder-outcome-explanation warning";
      explanation.innerHTML = `<strong>Seleção acima do saldo da nota</strong><span>Retire pagamentos até o valor fechar ou classifique os pagamentos como pertencentes a outra competência.</span>`;
      progress.textContent = "Ajuste a seleção";
      progress.className = "conc-outcome-progress warning";
    } else {
      explanation.className = "conc-builder-outcome-explanation";
      explanation.innerHTML = `<strong>Escolha como concluir</strong><span>Selecione pagamentos ou registre que o pagamento não foi localizado.</span>`;
      progress.textContent = "Escolha uma conclusão";
      progress.className = "conc-outcome-progress";
    }
  }

  function renderBuilderEquation(invoice) {
    const selected = state.receipts.filter((receipt) => state.builderSelected.has(receipt.id));
    const total = sum(selected, (receipt) => receipt.received);
    const balance = invoice ? invoice.difference : 0;
    const remaining = round2(balance - total);
    const selectedCount = q("#builderSelectedCount");
    const resultPanel = q("#builderResultPanel");
    const isEmptySelection = !selected.length;
    if (resultPanel) resultPanel.classList.toggle("is-empty", false);
    if (selectedCount) {
      selectedCount.textContent = selected.length ? `${selected.length} selecionado(s) · conferir ↓` : "0 selecionados";
      selectedCount.disabled = !selected.length;
    }

    if (!invoice) {
      q("#builderEquation").innerHTML = `<div class="conc-linkdesk-equation-item"><span>Nota selecionada</span><strong>—</strong></div><b>−</b><div class="conc-linkdesk-equation-item"><span>Pagamentos</span><strong>${brl.format(0)}</strong></div><b>=</b><div class="conc-linkdesk-equation-item"><span>Diferença</span><strong>—</strong></div>`;
      q("#builderSelectionSummary").innerHTML = "";
      q("#builderDecisionTitle").textContent = "Selecione uma nota";
      q("#builderDecisionHint").textContent = "Depois escolha os pagamentos ou registre que nenhum pagamento foi localizado.";
      q("#builderMatchStatus").className = "conc-linkdesk-status neutral";
      q("#builderMatchStatus").textContent = "Aguardando nota";
      q("#builderConfirmBtn").disabled = true;
      return;
    }

    const exact = selected.length && Math.abs(remaining) <= TOLERANCE;
    const shortage = remaining > TOLERANCE;
    const statusClass = exact ? "good" : selected.length ? (shortage ? "warn" : "bad") : "neutral";
    const statusText = exact ? "Valor fecha exatamente" : !selected.length ? "Nenhum pagamento selecionado" : shortage ? `Ainda faltam ${brl.format(remaining)}` : `Excede ${brl.format(Math.abs(remaining))}`;
    q("#builderMatchStatus").className = `conc-linkdesk-status ${statusClass}`;
    q("#builderMatchStatus").textContent = statusText;
    q("#builderDecisionTitle").textContent = exact ? "Vínculo pronto para confirmar" : selected.length ? "Escolha como concluir este caso" : "Pagamento não localizado? Registre a conclusão";

    const payers = new Map();
    selected.forEach((receipt) => {
      const key = `${norm(receipt.displayName)}|${receipt.docNorm}`;
      const current = payers.get(key) || { name: receipt.displayName || "Pagador não identificado", document: receipt.document, total: 0, ids: [] };
      current.total = round2(current.total + receipt.received); current.ids.push(receipt.id); payers.set(key, current);
    });
    const sameDocCount = selected.filter((receipt) => receipt.docNorm && receipt.docNorm === invoice.docNorm).length;
    const refCount = selected.filter((receipt) => receipt.refs.includes(invoice.number)).length;
    const mixedPayers = payers.size > 1;
    const hints = [];
    if (exact) hints.push("A soma selecionada fecha o saldo da nota.");
    if (selected.length && sameDocCount === selected.length) hints.push("Todos os CPF/CNPJ conferem com o tomador.");
    else if (sameDocCount) hints.push(`${sameDocCount} de ${selected.length} pagamento(s) têm o mesmo CPF/CNPJ da nota.`);
    else if (selected.length) hints.push("Nenhum CPF/CNPJ selecionado confere com o tomador.");
    if (refCount) hints.push(`${refCount} pagamento(s) citam esta NFS-e no Excel.`);
    if (mixedPayers) hints.push(`Há ${payers.size} pagadores diferentes na seleção.`);
    q("#builderDecisionHint").textContent = hints.join(" ") || "Nenhum pagamento foi selecionado. Você pode registrar que o pagamento não foi localizado nesta competência.";

    q("#builderEquation").innerHTML = `<div class="conc-linkdesk-equation-item"><span>Saldo da nota</span><strong>${brl.format(balance)}</strong><small>NFS-e ${esc(invoice.number)}</small></div><b>−</b><div class="conc-linkdesk-equation-item"><span>Pagamentos selecionados</span><strong>${brl.format(total)}</strong><small>${selected.length} lançamento(s)</small></div><b>=</b><div class="conc-linkdesk-equation-item ${statusClass}"><span>Diferença final</span><strong>${brl.format(remaining)}</strong><small>${statusText}</small></div>`;

    q("#builderSelectionSummary").innerHTML = selected.length ? `<div class="conc-linkdesk-selection-head"><strong>Quem está pagando nesta seleção</strong><span>${payers.size} pagador(es) · IDs ${selected.map((receipt) => receipt.id).join(", ")}</span></div><div class="conc-linkdesk-payer-grid">${[...payers.values()].map((payer) => `<article><div><strong>${esc(payer.name)}</strong><small>${esc(formatDoc(payer.document) || "Documento não informado")} · ID(s) ${payer.ids.join(", ")}</small></div><em>${brl.format(payer.total)}</em></article>`).join("")}</div><div class="conc-linkdesk-checks"><span class="${exact ? "good" : "warn"}">${exact ? "✓ Valor confere" : "! Valor ainda não fecha"}</span><span class="${sameDocCount === selected.length ? "good" : "warn"}">${sameDocCount === selected.length ? "✓ Documentos conferem" : `! ${selected.length - sameDocCount} documento(s) divergem`}</span><span class="${mixedPayers ? "warn" : "good"}">${mixedPayers ? `! ${payers.size} pagadores diferentes` : "✓ Um único pagador"}</span><span class="${refCount ? "good" : "neutral"}">${refCount ? `✓ NFS-e citada em ${refCount} pagamento(s)` : "NFS-e não citada"}</span></div>` : `<div class="conc-linkdesk-empty-selection"><strong>Nenhum pagamento selecionado</strong><span>Se nenhum recebimento foi localizado, escolha abaixo “Nota emitida — pagamento não localizado”.</span></div>`;

    const availability = builderOutcomeAvailability(invoice, selected, remaining);
    renderBuilderOutcome(invoice, selected, remaining, availability);
    const canConfirm = Boolean(state.builderOutcome && (
      (state.builderOutcome === "complete" && availability.complete) ||
      (state.builderOutcome === "partial" && availability.partial) ||
      (state.builderOutcome === "other_period" && availability.other_period) ||
      (state.builderOutcome === "not_found" && availability.not_found)
    ));
    q("#builderConfirmBtn").disabled = !canConfirm;
    q("#builderConfirmBtn").textContent = canConfirm ? `Registrar: ${builderOutcomeLabel(state.builderOutcome)}` : "Escolha uma conclusão válida";
  }

  function selectBuilderExactCombination() {
    const invoice = state.invoices.find((item) => item.number === state.builderInvoice);
    if (!invoice) return;
    const candidates = builderCandidateReceipts(invoice);
    const ids = builderBestExactSelection(invoice, candidates);
    if (!ids.length) { notify("Nenhuma combinação exata foi encontrada entre os pagamentos exibidos.", true); return; }
    state.builderSelected = new Set(ids);
    renderBuilder();
    notify(`Combinação selecionada: pagamento(s) ID ${ids.join(" + ")}. Use “conferir” para revisar o resumo.`);
  }

  function confirmBuilderLink() {
    const invoice = state.invoices.find((item) => item.number === state.builderInvoice);
    if (!invoice) { notify("Selecione uma nota.", true); return; }
    const ids = [...state.builderSelected];
    const selected = state.receipts.filter((receipt) => ids.includes(receipt.id));
    const total = sum(selected, (receipt) => receipt.received);
    const remaining = round2(invoice.difference - total);
    const availability = builderOutcomeAvailability(invoice, selected, remaining);
    const outcome = state.builderOutcome;
    if (!outcome) { notify("Escolha como deseja concluir este caso.", true); return; }
    if (outcome === "complete" && !availability.complete) { notify("O vínculo completo exige que os pagamentos fechem o saldo da nota.", true); return; }
    if (outcome === "partial" && !availability.partial) { notify("O pagamento parcial exige um valor selecionado menor que o saldo da nota.", true); return; }
    if (outcome === "other_period" && !availability.other_period) { notify("Selecione os pagamentos que pertencem a outra competência.", true); return; }
    if (outcome === "not_found" && !availability.not_found) { notify("Limpe a seleção antes de registrar que o pagamento não foi localizado.", true); return; }

    const invalid = ids.find((id) => state.receipts.find((receipt) => receipt.id === id)?.finalInvoice);
    if (invalid) { notify(`O pagamento ID ${invalid} já foi usado em outro vínculo.`, true); renderBuilder(); return; }
    const commentInput = q("#builderComment");
    const typedComment = commentInput.value.trim();
    if (outcome === "complete" || outcome === "partial") {
      const distinctPayers = new Set(selected.map((receipt) => `${norm(receipt.displayName)}|${receipt.docNorm}`)).size;
      if (distinctPayers > 1 && !window.confirm(`Atenção: existem ${distinctPayers} pagadores diferentes nesta seleção. Deseja registrar mesmo assim?`)) return;
    }
    const before = progressStats();
    snapshot(`${builderOutcomeLabel(outcome)} para a NFS-e ${invoice.number}`);
    const now = new Date().toLocaleString("pt-BR");

    if (outcome === "complete" || outcome === "partial") {
      const distinctPayers = new Set(selected.map((receipt) => `${norm(receipt.displayName)}|${receipt.docNorm}`)).size;
      const comment = typedComment || (outcome === "complete"
        ? `Vínculo completo confirmado com pagamento(s) ID ${ids.join(", ")} no total de ${brl.format(total)}.`
        : `Pagamento parcial confirmado com pagamento(s) ID ${ids.join(", ")} no total de ${brl.format(total)}. Saldo de ${brl.format(remaining)} permanece em aberto.`);
      state.manualLinks.push({ invoice: invoice.number, receiptIds: ids, comment, at: now, outcome });
      state.decisions[noteKey(invoice)] = {
        label: builderOutcomeLabel(outcome),
        code: outcome === "complete" ? "vinculo_completo" : "pagamento_parcial_confirmado",
        comment,
        item: `NFS-e ${invoice.number}`,
        view: "builder",
        at: now,
      };
      state.decisions[`builder:${invoice.number}:${ids.slice().sort((a,b)=>a-b).join("+")}`] = {
        label: builderOutcomeLabel(outcome), code: outcome, comment,
        item: `NFS-e ${invoice.number} ↔ pagamentos ${ids.join("+")}`, view: "builder", at: now,
      };
    } else if (outcome === "other_period") {
      const comment = typedComment || `Pagamento(s) ID ${ids.join(", ")} classificado(s) como pertencente(s) a NFS-e de outra competência. Nenhum vínculo foi criado com a NFS-e ${invoice.number}.`;
      selected.forEach((receipt) => {
        state.decisions[paymentKey(receipt)] = {
          label: builderOutcomeLabel(outcome), code: "pagamento_outra_competencia", comment,
          item: `Pagamento ID ${receipt.id}`, view: "builder", at: now,
        };
      });
    } else if (outcome === "not_found") {
      const comment = typedComment || `NFS-e ${invoice.number} conferida. Nenhum pagamento foi localizado nesta competência; o saldo de ${brl.format(invoice.difference)} permanece indicado no relatório.`;
      state.decisions[noteKey(invoice)] = {
        label: builderOutcomeLabel(outcome), code: "nota_pagamento_nao_localizado", comment,
        item: `NFS-e ${invoice.number}`, view: "builder", at: now,
      };
    }

    state.builderSelected.clear();
    state.builderOutcome = "";
    commentInput.value = "";
    reconcileBase(); persist(); renderAll(); feedbackAfterProgress(before, 1);
  }

  function paymentIdentitySubtitle(payment) {
    const pieces = [];
    const display = String(payment.displayName || "Cliente não informado").trim();
    const client = String(payment.client || "").trim();
    const legal = String(payment.legalName || "").trim();
    if (client && norm(client) !== norm(display)) pieces.push(`Nome no Excel: ${client}`);
    if (legal && norm(legal) !== norm(display)) pieces.push(`Razão social: ${legal}`);
    if (payment.document) pieces.push(`CPF/CNPJ: ${formatDoc(payment.document)}`);
    return pieces.join(" · ");
  }

  function renderPaymentFullCard(payment, label = "PAGAMENTO DO EXCEL") {
    const alternateNames = paymentIdentitySubtitle(payment);
    const operational = [
      payment.origin ? `Origem: ${payment.origin}` : "",
      payment.bank ? `Conta: ${payment.bank}` : "",
      payment.category ? `Categoria: ${payment.category}` : "",
      payment.internalNumber ? `Número interno: ${payment.internalNumber}` : "",
    ].filter(Boolean);
    const trace = [
      payment.sourceRow ? `Linha ${payment.sourceRow} do Excel` : "",
      payment.accountValue ? `Valor da conta: ${brl.format(payment.accountValue)}` : "",
      payment.openAmount ? `A receber: ${brl.format(payment.openAmount)}` : "",
    ].filter(Boolean);
    return `<div class="conc-payment-full-card">
      <div class="conc-payment-full-head">
        <div><span>${esc(label)}</span><strong>${esc(payment.displayName || "Cliente não informado")}</strong><small>${esc(formatDoc(payment.document) || "Documento não informado")}</small></div>
        <em>${brl.format(payment.received)}</em>
      </div>
      ${alternateNames ? `<div class="conc-payment-alt-name">${esc(alternateNames)}</div>` : ""}
      <div class="conc-payment-full-grid">
        <div><span>ID</span><strong>${payment.id}</strong></div>
        <div><span>Data do crédito</span><strong>${esc(payment.creditDate || "Não informada")}</strong></div>
        <div><span>Nota informada</span><strong>${esc(payment.invoiceRaw || "N/D")}</strong></div>
        <div><span>Origem</span><strong>${esc(payment.origin || "Não informada")}</strong></div>
      </div>
      ${operational.length ? `<div class="conc-payment-operational">${operational.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
      ${trace.length ? `<details class="conc-payment-trace"><summary>Ver rastreabilidade do lançamento</summary><div>${trace.map((item) => `<span>${esc(item)}</span>`).join("")}</div></details>` : ""}
    </div>`;
  }

  function renderPossibleInvoicesCards(receipt, options) {
    if (!options.length) return `<div class="conc-empty-candidates"><strong>Nenhuma possibilidade forte</strong><span>Pesquise pelo nome, CPF/CNPJ, valor ou período na Central de triagem.</span></div>`;
    return `<div class="conc-candidate-list">${options.map((item) => {
      const invoice = state.invoices.find((candidate) => candidate.number === item.invoice);
      return `<article class="conc-candidate-card">
        <div class="conc-candidate-score">${item.score}%</div>
        <div><strong>NFS-e ${esc(item.invoice)} — ${esc(invoice?.customer || item.noteCustomer || "Tomador não identificado")}</strong>
        <small>${esc(formatDoc(invoice?.document || "") || "Documento não informado")} · Nota ${brl.format(invoice?.amount || item.noteAmount)} · Saldo ${brl.format(item.noteBalance)}</small>
        <p>${esc(item.reason || "Possibilidade encontrada pela comparação dos dados.")}</p></div>
      </article>`;
    }).join("")}</div>`;
  }

  function renderFileCompanyContext() {
    const company = state.meta?.company || "Empresa não identificada no Excel";
    const document = formatDoc(state.meta?.companyDoc || "");
    return `<div class="conc-file-context"><span>EMPRESA DO ARQUIVO</span><strong>${esc(company)}</strong><small>${esc(document || "CNPJ não informado")}</small></div>`;
  }

  function paymentDecisionData(invoice, payments) {
    const total = sum(payments, (payment) => payment.received);
    const amountDifference = round2(total - Number(invoice.amount || 0));
    const amountOk = Math.abs(amountDifference) <= TOLERANCE;
    const groups = new Map();
    payments.forEach((payment) => {
      const name = String(payment.displayName || "Cliente não informado").trim();
      const key = payment.docNorm || `NOME:${norm(name) || payment.id}`;
      if (!groups.has(key)) groups.set(key, { key, name, document: payment.document || "", total: 0, count: 0, ids: [] });
      const group = groups.get(key);
      group.total = round2(group.total + Number(payment.received || 0));
      group.count += 1;
      group.ids.push(payment.id);
      if ((!group.document || !digits(group.document)) && digits(payment.document)) group.document = payment.document;
    });
    const payers = [...groups.values()].sort((a, b) => b.total - a.total);
    const mainPayer = payers[0] || null;
    const sameDocCount = payments.filter((payment) => invoice.docNorm && payment.docNorm === invoice.docNorm).length;
    const exactRefCount = payments.filter((payment) => payment.refs?.includes(invoice.number)).length;
    const nameScores = payments.map((payment) => nameSimilarity(payment.displayName, invoice.customer));
    const compatibleNameCount = nameScores.filter((score) => score >= 75).length;
    const bestNameScore = Math.max(...nameScores, 0);
    const allSamePayer = payers.length <= 1;
    const uniqueDates = [...new Set(payments.map((payment) => payment.creditDate).filter(Boolean))];
    const sortedTimes = uniqueDates.map((date) => ({ date, time: dateToTime(date) })).filter((item) => item.time !== null).sort((a, b) => a.time - b.time);
    const dateRange = sortedTimes.length > 1 ? `${sortedTimes[0].date} a ${sortedTimes[sortedTimes.length - 1].date}` : (uniqueDates[0] || "Data não informada");
    const references = [...new Set(payments.flatMap((payment) => payment.refs || []))];
    let score = 0;
    if (amountOk) score += 38;
    else if (Math.abs(amountDifference) <= Math.max(5, Number(invoice.amount || 0) * .02)) score += 20;
    if (payments.length && sameDocCount === payments.length) score += 27;
    else if (sameDocCount > 0) score += 14;
    if (payments.length && exactRefCount === payments.length) score += 20;
    else if (exactRefCount > 0) score += 10;
    if (payments.length && compatibleNameCount === payments.length) score += 15;
    else if (bestNameScore >= 75) score += 8;
    if (!allSamePayer && payments.length > 1) score -= 12;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 85 ? "Alta" : score >= 65 ? "Média" : "Baixa";
    const levelClass = score >= 85 ? "high" : score >= 65 ? "medium" : "low";
    const alerts = [];
    if (!amountOk) alerts.push({ type: "bad", text: amountDifference > 0 ? `Valor recebido está ${brl.format(Math.abs(amountDifference))} acima da nota.` : `Ainda faltam ${brl.format(Math.abs(amountDifference))} para fechar a nota.` });
    if (!allSamePayer) alerts.push({ type: "warn", text: `${payers.length} pagadores diferentes aparecem neste vínculo.` });
    if (payments.length && sameDocCount !== payments.length) alerts.push({ type: "warn", text: `${payments.length - sameDocCount} de ${payments.length} pagamento(s) possuem CPF/CNPJ diferente do tomador.` });
    if (payments.length && exactRefCount === 0) alerts.push({ type: "info", text: "Nenhum pagamento cita diretamente o número desta NFS-e." });
    if (!alerts.length) alerts.push({ type: "ok", text: "Valor, pagador e referências estão coerentes com a NFS-e." });
    let reading = "Nenhum pagamento foi confirmado para esta nota.";
    if (payments.length) {
      if (amountOk && allSamePayer && sameDocCount === payments.length) reading = `O valor fecha e todos os pagamentos pertencem ao mesmo CPF/CNPJ do tomador. Vínculo com segurança ${level.toLowerCase()}.`;
      else if (amountOk && !allSamePayer) reading = `O valor fecha, mas os pagamentos estão distribuídos entre ${payers.length} pagadores. Confirme se houve agrupamento correto ou referência usada por engano.`;
      else if (amountOk && sameDocCount !== payments.length) reading = `O valor fecha, porém há divergência de CPF/CNPJ em parte dos pagamentos. Confira o cadastro ou a nota informada na planilha.`;
      else if (!amountOk && allSamePayer) reading = `Os pagamentos parecem ser do mesmo cliente, mas o total ainda não fecha com a NFS-e.`;
      else reading = `Há sinais mistos entre valor, pagadores e referências. Revise antes de confirmar.`;
    }
    let recommendation = "Revisar antes de confirmar";
    let recommendationClass = "warn";
    if (payments.length && amountOk && allSamePayer && sameDocCount === payments.length && compatibleNameCount === payments.length) {
      recommendation = "Pode confirmar com segurança";
      recommendationClass = "ok";
    } else if (payments.length && amountOk && allSamePayer && sameDocCount !== payments.length) {
      recommendation = "Confirme somente após validar o cadastro";
      recommendationClass = "warn";
    } else if (payments.length && !allSamePayer) {
      recommendation = "Não confirme ainda: há mistura de pagadores";
      recommendationClass = "bad";
    } else if (payments.length && !amountOk) {
      recommendation = "Localize o valor faltante ou excedente";
      recommendationClass = "warn";
    }
    return { total, amountDifference, amountOk, payers, mainPayer, sameDocCount, exactRefCount, compatibleNameCount, bestNameScore, allSamePayer, dateRange, references, score, level, levelClass, alerts, reading, recommendation, recommendationClass };
  }

  function decisionCheck(label, ok, detail, warning = false) {
    const statusClass = ok ? "ok" : (warning ? "warn" : "bad");
    const icon = ok ? "✓" : (warning ? "!" : "×");
    return `<div class="conc-decision-check ${statusClass}"><b>${icon}</b><span><strong>${esc(label)}</strong><small>${esc(detail)}</small></span></div>`;
  }

  function renderRelatedPaymentsDecision(invoice, payments, options = {}) {
    const selectedIds = new Set(options.selectedIds || payments.map((payment) => payment.id));
    const selectedPayments = payments.filter((payment) => selectedIds.has(payment.id));
    const data = paymentDecisionData(invoice, selectedPayments);
    if (!payments.length) {
      return `<div class="conc-story-side warm conc-payment-decision"><div class="conc-payment-head"><div><span>PAGAMENTOS RELACIONADOS</span><strong>Nenhum pagamento confirmado</strong></div><em class="conc-confidence low">Baixa</em></div><div class="conc-empty-payment">Não há recebimentos vinculados a esta NFS-e. Use a lista de possibilidades ou o montador de vínculo.</div></div>`;
    }
    const payers = selectedPayments.length ? data.payers : [];
    const payerList = payers.map((payer) => `<div class="conc-payer-row"><div><strong>${esc(payer.name)}</strong><small>${esc(formatDoc(payer.document) || "Documento não informado")} · ${payer.count} pagamento(s) · IDs ${payer.ids.join(", ")}</small></div><em>${brl.format(payer.total)}</em></div>`).join("");
    const paymentRows = payments.map((payment) => {
      const checked = selectedIds.has(payment.id);
      return `<label class="conc-payment-row conc-payment-row-rich conc-payment-toggle ${checked ? "selected" : ""}"><input type="checkbox" class="conc-payment-pick" data-payment-id="${payment.id}" ${checked ? "checked" : ""}><div class="conc-payment-id">ID ${payment.id}</div><div><strong>${esc(payment.displayName || "Cliente não informado")}</strong><small>${esc(formatDoc(payment.document) || "Documento não informado")} · ${esc(payment.creditDate || "Data não informada")} · nota informada ${esc(payment.invoiceRaw || "N/D")}</small>${payment.client && payment.legalName && norm(payment.client) !== norm(payment.legalName) ? `<small>Cliente: ${esc(payment.client)} · Razão social: ${esc(payment.legalName)}</small>` : ""}<small>${esc(payment.origin || "Origem não informada")}${payment.bank ? ` · ${esc(payment.bank)}` : ""}</small></div><em>${brl.format(payment.received)}</em></label>`;
    }).join("");
    const referenceText = data.references.length ? data.references.join(", ") : "Nenhuma";
    const selectionTools = options.selectable ? `<div class="conc-selection-tools"><button type="button" class="button" id="detailSelectAllBtn">Marcar todos</button><button type="button" class="button" id="detailClearSelectionBtn">Limpar seleção</button><button type="button" class="button" id="detailKeepCompatibleBtn">Manter só os mais compatíveis</button><span>${selectedPayments.length} de ${payments.length} pagamento(s) selecionado(s)</span></div>` : "";
    const selectionSummary = options.selectable ? `<div class="conc-selection-summary ${data.amountOk ? "ok" : selectedPayments.length ? "warn" : "neutral"}"><strong>${selectedPayments.length ? (data.amountOk ? "Seleção fecha a nota" : (data.amountDifference > 0 ? `Seleção excede ${brl.format(Math.abs(data.amountDifference))}` : `Seleção parcial · faltam ${brl.format(Math.abs(data.amountDifference))}`)) : "Nenhum pagamento selecionado"}</strong><small>${selectedPayments.length ? `Você pode usar esta seleção na Mesa de vínculos para confirmar como vínculo completo ou pagamento parcial.` : `Marque somente os pagamentos que realmente pertencem a esta nota.`}</small>${selectedPayments.length ? `<button type="button" class="button button-primary" id="detailUseSelectionBtn">Usar seleção na Mesa de vínculos</button>` : ""}</div>` : "";
    return `<div class="conc-story-side warm conc-payment-decision">
      <div class="conc-payment-head"><div><span>PAGAMENTOS RELACIONADOS</span><strong>${brl.format(data.total)}</strong><small>${selectedPayments.length} selecionado(s) · ${payments.length} encontrado(s) · ${data.payers.length} pagador(es) · ${esc(data.dateRange)}</small></div><em class="conc-confidence ${data.levelClass}">${data.level} · ${data.score}%</em></div>
      <div class="conc-main-payer"><span>PAGADOR PRINCIPAL</span><strong>${esc(data.mainPayer?.name || "Não identificado")}</strong><small>${esc(formatDoc(data.mainPayer?.document) || "Documento não informado")} · ${brl.format(data.mainPayer?.total || 0)}</small></div>
      <div class="conc-decision-mini-grid">
        <div><span>Selecionados</span><strong>${selectedPayments.length}/${payments.length}</strong></div>
        <div><span>CPF/CNPJ iguais</span><strong>${data.sameDocCount}/${selectedPayments.length || 0}</strong></div>
        <div><span>Citam a NFS-e</span><strong>${data.exactRefCount}/${selectedPayments.length || 0}</strong></div>
        <div><span>Referências</span><strong>${esc(referenceText)}</strong></div>
      </div>
      ${selectionSummary}
      ${payers.length ? `<div class="conc-payer-summary"><span>QUEM PAGOU</span>${payerList}</div>` : ""}
      <details class="conc-payment-details" open><summary>Ver e escolher os ${payments.length} pagamentos encontrados</summary><div>${selectionTools}${paymentRows}</div></details>
    </div>`;
  }

  function renderDecisionEvidence(invoice, payments) {
    const data = paymentDecisionData(invoice, payments);
    if (!payments.length) return `<div class="conc-decision-panel"><div class="conc-decision-reading"><span>LEITURA RÁPIDA</span><strong>Nenhum pagamento encontrado</strong><p>Use as possibilidades sugeridas ou procure o cliente, CPF/CNPJ e valor na Central de triagem.</p></div></div>`;
    const checks = [
      decisionCheck("Valor total", data.amountOk, data.amountOk ? `Fecha em ${brl.format(data.total)}` : `Diferença de ${brl.format(Math.abs(data.amountDifference))}`, !data.amountOk),
      decisionCheck("CPF/CNPJ", data.sameDocCount === payments.length, `${data.sameDocCount} de ${payments.length} conferem`, data.sameDocCount > 0),
      decisionCheck("Nome", data.compatibleNameCount === payments.length, `${data.compatibleNameCount} de ${payments.length} compatíveis`, data.compatibleNameCount > 0),
      decisionCheck("Referência da nota", data.exactRefCount > 0, `${data.exactRefCount} pagamento(s) citam a NFS-e`, data.exactRefCount === 0),
      decisionCheck("Mistura de pagadores", data.allSamePayer, data.allSamePayer ? "Todos pertencem ao mesmo pagador" : `${data.payers.length} pagadores diferentes`, !data.allSamePayer),
    ].join("");
    const alerts = data.alerts.map((alert) => `<div class="conc-alert ${alert.type}">${alert.type === "ok" ? "✓" : alert.type === "bad" ? "×" : "!"}<span>${esc(alert.text)}</span></div>`).join("");
    return `<div class="conc-decision-panel">
      <div class="conc-decision-recommendation ${data.recommendationClass}"><span>O QUE VOCÊ PRECISA DECIDIR</span><strong>${esc(data.recommendation)}</strong></div>
      <div class="conc-decision-reading"><span>LEITURA RÁPIDA PARA DECIDIR</span><strong>${esc(data.reading)}</strong><p>Confiança calculada pelas evidências visíveis: <b>${data.level} (${data.score}%)</b>.</p></div>
      <div class="conc-decision-checks">${checks}</div>
      <div class="conc-alert-list">${alerts}</div>
    </div>`;
  }

  function renderQueueDecisionOptions(row) {
    const select = q("#queueDecision");
    const quick = q("#queueQuickDecisions");
    const noteChoices = [
      ["confirmado", "Confirmar como correto", "✓", "Correto"],
      ...(Number(row.invoice?.receivedTotal || 0) > TOLERANCE ? [["pagamento_parcial_confirmado", "Pagamento parcial confirmado — saldo permanece em aberto", "◐", "Parcial confirmado"]] : []),
      ["nota_pagamento_nao_localizado", "Nota emitida — pagamento não localizado nesta competência", "⌕", "Não localizado"],
      ["corrigir_planilha", "Corrigir referência ou cadastro na planilha", "✎", "Corrigir planilha"],
      ["revisar", "Revisar depois — manter na fila", "○", "Revisar depois"],
    ];
    const choices = row.type === "note" ? noteChoices : [
      ["pagamento_outra_competencia", "Pagamento pertence a NFS-e de outra competência", "↪", "Outra competência"],
      ["pagamento_sem_nota_competencia", "Pagamento recebido — NFS-e não localizada nesta competência", "⌕", "Nota não localizada"],
      ["corrigir_planilha", "Corrigir referência ou cadastro na planilha", "✎", "Corrigir planilha"],
      ["nao_receita", "Lançamento não deve entrar como receita", "×", "Não é receita"],
      ["revisar", "Revisar depois — manter na fila", "○", "Revisar depois"],
    ];
    select.innerHTML = `<option value="">Escolha a conclusão</option>${choices.map(([value,label]) => `<option value="${value}">${esc(label)}</option>`).join("")}`;
    quick.innerHTML = choices.slice(0, 4).map(([value,,icon,short]) => `<button type="button" data-queue-choice="${value}">${icon} ${esc(short)}</button>`).join("");
    qa("[data-queue-choice]", quick).forEach((button) => button.addEventListener("click", () => {
      select.value = button.dataset.queueChoice;
      qa("[data-queue-choice]", quick).forEach((item) => item.classList.toggle("active", item === button));
      q("#queueSaveNextBtn").disabled = !select.value;
    }));
  }


  function queueRecommendation(row) {
    if (!row) return { code: "", label: "Sem recomendação automática", reason: "Leia as evidências e escolha a conclusão que melhor representa o caso." };
    if (row.type === "note") {
      const invoice = row.invoice;
      const options = state.possibilities.filter((item) => item.invoice === invoice.number && item.score >= 88);
      if (invoice.status === "Recebimento parcial" || (invoice.receivedTotal > TOLERANCE && invoice.difference > TOLERANCE)) {
        return { code: "pagamento_parcial_confirmado", label: "Pagamento parcial confirmado", reason: `Já foram localizados ${brl.format(invoice.receivedTotal)} e o saldo de ${brl.format(Math.max(0, invoice.difference))} continuará no relatório.` };
      }
      if (/divergência cadastral|lançamentos indevidos/i.test(invoice.status || "")) {
        return { code: "corrigir_planilha", label: "Corrigir referência ou cadastro", reason: "O valor ou a nota parecem relacionados, mas os dados cadastrais/referências precisam de ajuste." };
      }
      if (options.length) {
        return { code: "builder", invoice: invoice.number, label: "Abrir a Mesa de vínculos", reason: `Existe uma possibilidade com ${options[0].score}% de compatibilidade. Compare antes de concluir.` };
      }
      if (invoice.receivedTotal <= TOLERANCE) {
        return { code: "nota_pagamento_nao_localizado", label: "Pagamento não localizado nesta competência", reason: "Nenhum pagamento confirmado foi encontrado e não há uma possibilidade forte disponível." };
      }
      return { code: "revisar", label: "Revisar depois", reason: "As evidências ainda não permitem uma conclusão segura." };
    }
    const receipt = row.receipt;
    const options = state.possibilities.filter((item) => item.receiptIds.includes(receipt.id)).sort((a,b)=>b.score-a.score);
    if (options[0]?.score >= 88) {
      return { code: "builder", invoice: options[0].invoice, label: `Comparar com a NFS-e ${options[0].invoice}`, reason: `Foi encontrada uma possibilidade com ${options[0].score}% de compatibilidade.` };
    }
    if (!receipt.refs.length) {
      return { code: "pagamento_sem_nota_competencia", label: "NFS-e não localizada nesta competência", reason: "O pagamento não possui uma referência válida de nota e nenhuma possibilidade forte foi encontrada." };
    }
    return { code: "corrigir_planilha", label: "Corrigir a referência da nota", reason: `A planilha informa ${receipt.invoiceRaw || "uma referência"}, mas ela não gerou um vínculo seguro.` };
  }

  function renderQueueRecommendation(row) {
    const recommendation = queueRecommendation(row);
    state.queueRecommendedCode = recommendation.code;
    state.queueRecommendedInvoice = recommendation.invoice || "";
    if (q("#queueRecommendationText")) q("#queueRecommendationText").textContent = recommendation.label;
    if (q("#queueRecommendationReason")) q("#queueRecommendationReason").textContent = recommendation.reason;
    const button = q("#queueRecommendedBtn");
    if (button) {
      button.textContent = recommendation.code === "builder" ? "Comparar na Mesa" : "Usar esta sugestão";
      button.disabled = !recommendation.code;
    }
  }

  function renderQueue() {
    if (!state.result) return;
    const rows = pendingQueueRows();
    const stats = progressStats();
    q("#queuePendingCount").textContent = stats.currentPending;
    q("#queueSessionSolved").textContent = `${stats.sessionSolved} caso(s)`;
    q("#queueSessionBar").style.width = `${Math.min(100, Math.round((stats.sessionSolved / Math.max(1, state.sessionGoal)) * 100))}%`;
    q("#queueHumanProgress").textContent = `${stats.humanPercent}%`;
    q("#queueMilestoneText").textContent = stats.humanPercent >= 100 ? "Concluído" : `${nextMilestone(stats.humanPercent)}%`;
    state.queueIndex = Math.max(0, Math.min(state.queueIndex, Math.max(0, rows.length - 1)));
    q("#queuePositionText").textContent = rows.length ? `${state.queueIndex + 1} de ${rows.length} nesta lista` : "0 de 0";
    q("#queuePrevBtn").disabled = state.queueIndex <= 0;
    q("#queueNextBtn").disabled = state.queueIndex >= rows.length - 1;
    q("#queueSkipBtn").disabled = !rows.length;
    const card = q("#queueCaseCard");
    const decisionSelect = q("#queueDecision");
    decisionSelect.value = "";
    q("#queueSaveNextBtn").disabled = true;
    qa("[data-queue-choice]").forEach((button) => button.classList.remove("active"));
    if (!rows.length) {
      card.innerHTML = `<div class="empty-results"><div>✓</div><strong>Esta fila terminou</strong><span>${stats.currentPending ? "Altere o filtro para continuar nas outras pendências." : "Todos os casos que exigiam decisão foram tratados. Vá para finalizar e baixar."}</span>${stats.currentPending ? "" : `<button class="button button-primary" type="button" data-finish-from-queue>Ir para finalizar</button>`}</div>`;
      q("[data-finish-from-queue]", card)?.addEventListener("click", () => goPage("finish"));
      return;
    }
    const row = rows[state.queueIndex];
    renderQueueDecisionOptions(row);
    renderQueueRecommendation(row);
    if (row.type === "note") {
      const invoice = row.invoice; const payments = assignedReceipts(invoice); const possibilities = state.possibilities.filter((item)=>item.invoice===invoice.number).slice(0,5);
      card.innerHTML = `<div class="conc-case-progress-label"><span>Caso atual</span><strong>${stats.currentPending} pendência(s) ainda abertas</strong></div><span class="panel-kicker">${esc(invoice.status)}</span><h3>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</h3><div class="conc-queue-story conc-queue-story-decision"><div class="conc-story-side conc-note-summary"><span>NOTA DA PREFEITURA</span><strong>${brl.format(invoice.amount)}</strong><small>${esc(invoice.issueDate)} · ${esc(formatDoc(invoice.document))}</small><div class="conc-note-customer"><span>TOMADOR</span><strong>${esc(invoice.customer)}</strong><small>${esc(formatDoc(invoice.document))}</small></div><div class="conc-note-numbers"><div><span>Localizado</span><strong>${brl.format(invoice.receivedTotal)}</strong></div><div><span>Diferença</span><strong>${brl.format(invoice.difference)}</strong></div></div></div><div class="conc-story-arrow">↔</div>${renderRelatedPaymentsDecision(invoice, payments)}</div>${renderDecisionEvidence(invoice, payments)}<div class="conc-queue-evidence"><strong>O que aconteceu segundo o Conferinho</strong><p>${esc(invoice.explanation)}</p><p><b>Próxima ação:</b> ${esc(invoice.action)}</p>${possibilities.length ? `<p><b>Possibilidades ainda não confirmadas:</b> ${possibilities.map((item)=>`${item.score}% · pagamento ${item.receiptIds.join("+")} · ${brl.format(item.paymentAmount)}`).join(" | ")}</p>` : ""}</div>`;
    } else {
      const receipt = row.receipt; const possibilities = state.possibilities.filter((item)=>item.receiptIds.includes(receipt.id)).slice(0,5);
      card.innerHTML = `<div class="conc-case-progress-label"><span>Caso atual</span><strong>${stats.currentPending} pendência(s) ainda abertas</strong></div><span class="panel-kicker">PAGAMENTO SEM NOTA</span><h3>Pagamento ID ${receipt.id} — ${esc(receipt.displayName)}</h3>${renderFileCompanyContext()}<div class="conc-payment-investigation">${renderPaymentFullCard(receipt)}<div class="conc-candidate-panel"><span>POSSÍVEIS NFS-e</span><strong>${possibilities.length} possibilidade(s)</strong>${renderPossibleInvoicesCards(receipt, possibilities)}</div></div><div class="conc-queue-evidence"><strong>Por que ficou sem nota</strong><p>${receipt.refs.length ? "A referência informada não gerou um vínculo seguro ou o pagamento pode pertencer a outra NFS-e." : "Nenhum número válido de nota foi informado na planilha."}</p><p>Você já tem nesta tela quem pagou, CPF/CNPJ, valor, data, referência, origem e possíveis notas. Só volte ao Excel se algum dado essencial estiver realmente ausente.</p></div>`;
    }
  }

  function saveQueueDecision() {
    const rows = pendingQueueRows(); const row = rows[state.queueIndex]; if (!row) return;
    const code = q("#queueDecision").value;
    if (!code) { notify("Escolha uma conclusão antes de salvar.", true); return; }
    const labels = {
      revisar: "Revisar depois — manter na fila",
      confirmado: "Confirmado como correto",
      pagamento_parcial_confirmado: "Pagamento parcial confirmado — saldo permanece em aberto",
      nota_pagamento_nao_localizado: "Nota emitida — pagamento não localizado nesta competência",
      pagamento_outra_competencia: "Pagamento pertence a NFS-e de outra competência",
      pagamento_sem_nota_competencia: "Pagamento recebido — NFS-e não localizada nesta competência",
      corrigir_planilha: "Corrigir referência ou cadastro na planilha",
      nao_receita: "Lançamento não deve entrar como receita",
      sem_pagamento: "Nota emitida — pagamento não localizado nesta competência",
      outro_mes: "Pagamento pertence a NFS-e de outra competência",
    };
    const before = progressStats();
    snapshot(`decisão na fila para ${itemLabel(row)}`);
    state.decisions[row.key] = { label: labels[code], code, comment: q("#queueComment").value.trim(), item: itemLabel(row), view: "queue", at: new Date().toLocaleString("pt-BR") };
    q("#queueComment").value = "";
    persist();
    const remainingRows = pendingQueueRows();
    state.queueIndex = code === "revisar" && remainingRows.length > 1
      ? (state.queueIndex + 1) % remainingRows.length
      : Math.min(state.queueIndex, Math.max(0, remainingRows.length - 1));
    renderAll();
    if (code === "revisar") notify("Caso mantido na fila para revisar depois. Avançamos para o próximo.");
    else {
      feedbackAfterProgress(before, 1);
      if (!pendingQueueRows().length) setTimeout(() => { showCelebration("Bloco concluído", "O Assistente organizou o que vem depois.", "✓"); goPage("assistant"); }, 280);
    }
  }

  function consultMatches(term) {
    const normalized = norm(term); if (!normalized) return [];
    const matches = [];
    state.invoices.forEach((invoice) => { if (norm(JSON.stringify(invoice)).includes(normalized)) matches.push({ type:"note", id:invoice.number, label:`NFS-e ${invoice.number}`, subtitle:`${invoice.customer} · ${brl.format(invoice.amount)}` }); });
    state.receipts.filter((receipt)=>receipt.active).forEach((receipt) => { if (norm(JSON.stringify(receipt)).includes(normalized)) matches.push({ type:"payment", id:receipt.id, label:`Pagamento ID ${receipt.id}`, subtitle:`${receipt.displayName} · ${brl.format(receipt.received)}` }); });
    return matches.slice(0,100);
  }

  function renderConsultResults() {
    const list = q("#consultResultsList"); if (!list) return;
    if (!state.consultMatches.length) { list.innerHTML = `<div class="empty-results"><div>⌕</div><strong>Nenhum resultado selecionado</strong><span>Use a pesquisa acima.</span></div>`; return; }
    list.innerHTML = state.consultMatches.map((item,index)=>`<button class="conc-consult-item" data-consult-index="${index}"><strong>${esc(item.label)}</strong><small>${esc(item.subtitle)}</small></button>`).join("");
    qa("[data-consult-index]", list).forEach((button)=>button.addEventListener("click",()=>renderConsultStory(state.consultMatches[Number(button.dataset.consultIndex)])));
  }

  function renderConsultStory(match) {
    const panel=q("#consultStoryPanel");
    if (match.type === "note") {
      const invoice=state.invoices.find((item)=>item.number===String(match.id)); const payments=assignedReceipts(invoice); const options=state.possibilities.filter((item)=>item.invoice===invoice.number).slice(0,5);
      panel.innerHTML=`<span class="panel-kicker">HISTÓRIA DA NOTA</span><h3>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</h3><div class="conc-queue-story conc-queue-story-decision"><div class="conc-story-side conc-note-summary"><span>NOTA</span><strong>${brl.format(invoice.amount)}</strong><small>${esc(invoice.issueDate)} · ${esc(formatDoc(invoice.document))}</small><div class="conc-note-customer"><span>TOMADOR</span><strong>${esc(invoice.customer)}</strong><small>${esc(formatDoc(invoice.document))}</small></div></div><div class="conc-story-arrow">↔</div>${renderRelatedPaymentsDecision(invoice,payments)}</div>${renderDecisionEvidence(invoice,payments)}<div class="conc-queue-evidence"><strong>Por que ficou assim</strong><p>${esc(invoice.explanation)}</p><p><b>Critério:</b> ${esc(invoice.criterion)} · <b>Confiança:</b> ${invoice.confidence}% · <b>Diferença:</b> ${brl.format(invoice.difference)}</p><p><b>Ação:</b> ${esc(invoice.action)}</p>${options.length?`<p><b>Possibilidades:</b> ${options.map((item)=>`${item.score}% · pagamento ${item.receiptIds.join("+")}`).join(" | ")}</p>`:""}</div>`;
    } else {
      const receipt=state.receipts.find((item)=>item.id===Number(match.id)); const invoice=receipt.finalInvoice?state.invoices.find((item)=>item.number===receipt.finalInvoice):null; const options=state.possibilities.filter((item)=>item.receiptIds.includes(receipt.id)).slice(0,5);
      panel.innerHTML=`<span class="panel-kicker">HISTÓRIA DO PAGAMENTO</span><h3>Pagamento ID ${receipt.id} — ${esc(receipt.displayName)}</h3>${renderFileCompanyContext()}<div class="conc-payment-investigation">${renderPaymentFullCard(receipt,"PAGAMENTO IDENTIFICADO")}<div class="conc-candidate-panel"><span>${invoice?"NFS-e VINCULADA":"POSSÍVEIS NOTAS"}</span>${invoice?`<article class="conc-candidate-card selected"><div class="conc-candidate-score">✓</div><div><strong>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</strong><small>${esc(formatDoc(invoice.document)||"Documento não informado")} · ${brl.format(invoice.amount)}</small><p>${esc(receipt.linkReason||"Vínculo confirmado durante a conciliação.")}</p></div></article>`:renderPossibleInvoicesCards(receipt,options)}</div></div><div class="conc-queue-evidence"><strong>Por que o vínculo aconteceu</strong><p>${esc(receipt.linkReason || (invoice?"Vínculo confirmado durante a conciliação.":"Nenhuma nota foi confirmada para este pagamento."))}</p><p><b>Tipo:</b> ${esc(receipt.assignment||"Sem vínculo")} · <b>Confiança:</b> ${receipt.confidence||0}%</p></div>`;
    }
  }

  function renderFinish() {
    if (!state.result) return;
    q("#finishMetrics").innerHTML = [
      ["Notas emitidas", state.result.totalInvoices], ["Notas claras", state.result.clear.length], ["Notas com saldo", state.result.notesOpen.length], ["Pagamentos sem nota", state.result.paymentsOpen.length], ["Possibilidades fortes", state.result.strongPossibilities.length], ["Decisões registradas", Object.keys(state.decisions).length + state.manualLinks.length],
    ].map(([label,value])=>`<div class="conc-final-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
    const decisions=[...Object.values(state.decisions),...state.manualLinks.map((link)=>({at:link.at,item:`NFS-e ${link.invoice} ↔ pagamentos ${link.receiptIds.join("+")}`,label:"Vínculo confirmado",comment:link.comment}))];
    q("#finishDecisionsList").innerHTML=decisions.length?decisions.slice().reverse().map((decision)=>`<div class="conc-decision-item"><div><strong>${esc(decision.at||"")}</strong><small>${esc(decision.label||"Decisão")}</small></div><div><strong>${esc(decision.item||"")}</strong><small>${esc(decision.comment||"Sem comentário")}</small></div><em>registrado</em></div>`).join(""):`<div class="empty-results"><div>○</div><strong>Nenhuma decisão manual registrada</strong><span>As conciliações automáticas continuam disponíveis no relatório.</span></div>`;
  }

  function renderExtended() {
    if (!state.result) return;
    renderDashboard(); renderQuickReview(); renderBuilder(); renderQueue(); renderFinish();
    const titles={clear:"Vínculos claros",doubts:"Dúvidas e divergências",notes:"Notas sem pagamento",payments:"Pagamentos sem nota",possibilities:"Lista de possibilidades",decisions:"Decisões registradas"};
    if(q("#receiptsTriageTitle")) q("#receiptsTriageTitle").textContent=titles[state.view]||"Central de triagem";
    goPage(state.page || "dashboard", false);
  }

  function renderAll() {
    renderSummary(); renderProgressHub(); renderTable(); renderExtended();
    if (state.detail) openDetail(state.detail.type, state.detail.id, false);
  }

  function setView(view) {
    state.view = view; state.selected.clear(); q("#receiptsSelectAll").checked = false;
    if (!["clear", "doubts", "possibilities"].includes(view)) { state.easyOnly = false; q("#receiptsEasyOnly").checked = false; }
    renderAll(); q("#receiptsTableWrap").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openDetail(type, id, scroll = true) {
    const panel = q("#receiptsDetailPanel"); state.detail = { type, id }; panel.classList.remove("hidden");
    let html = `<button class="receipts-row-button receipts-detail-close" id="receiptsDetailClose">Fechar</button>`;
    if (type === "note") {
      const invoice = state.invoices.find((item) => item.number === String(id));
      const receipts = assignedReceipts(invoice);
      if (!state.detailSelections[invoice.number]) state.detailSelections[invoice.number] = receipts.map((receipt) => receipt.id);
      state.detailSelections[invoice.number] = state.detailSelections[invoice.number].filter((rid) => receipts.some((receipt) => receipt.id === rid));
      const selectedIds = state.detailSelections[invoice.number];
      const selectedReceipts = receipts.filter((receipt) => selectedIds.includes(receipt.id));
      const dynamicDecision = paymentDecisionData(invoice, selectedReceipts);
      const options = state.possibilities.filter((item) => item.invoice === invoice.number).slice(0, 5);
      html += `<span class="panel-kicker">HISTÓRIA DO VÍNCULO</span><h3>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</h3>${renderFileCompanyContext()}
        <div class="conc-queue-story conc-queue-story-decision"><div class="conc-story-side conc-note-summary"><span>NOTA DA PREFEITURA</span><strong>${brl.format(invoice.amount)}</strong><small>${esc(invoice.issueDate)} · ${esc(formatDoc(invoice.document))}</small><div class="conc-note-customer"><span>TOMADOR</span><strong>${esc(invoice.customer)}</strong><small>${esc(formatDoc(invoice.document))}</small></div><div class="conc-note-numbers"><div><span>Localizado</span><strong>${brl.format(invoice.receivedTotal)}</strong></div><div><span>Diferença</span><strong>${brl.format(invoice.difference)}</strong></div></div></div><div class="conc-story-arrow">↔</div>${renderRelatedPaymentsDecision(invoice, receipts, { selectable: true, selectedIds })}</div>
        ${renderDecisionEvidence(invoice, selectedReceipts)}
        <div class="receipts-evidence"><strong>O que aconteceu segundo a seleção atual</strong><p>${esc(dynamicDecision.reading || invoice.explanation)}</p><div class="receipts-quality-box"><span><b>Situação:</b> ${esc(dynamicDecision.recommendation)}</span><span><b>Confiança:</b> ${dynamicDecision.score}%</span><span><b>Pagamentos marcados:</b> ${selectedReceipts.length}/${receipts.length}</span><span><b>Diferença:</b> ${brl.format(dynamicDecision.amountDifference)}</span></div></div>
        <div class="receipts-evidence"><strong>Próxima ação recomendada</strong><p>${selectedReceipts.length ? esc(dynamicDecision.recommendation) : "Marque apenas os pagamentos que realmente pertencem a esta nota. Depois envie a seleção para a Mesa de vínculos e registre como vínculo completo ou pagamento parcial."}</p>${options.length ? `<div class="conc-candidate-list compact">${options.map((item) => `<article class="conc-candidate-card"><div class="conc-candidate-score">${item.score}%</div><div><strong>Pagamento(s) ID ${item.receiptIds.join(" + ")}</strong><small>${brl.format(item.paymentAmount)} · ${esc(item.paymentCustomer || "Pagador não identificado")}</small><p>${esc(item.reason)}</p></div></article>`).join("")}</div>` : ""}</div>`;
    } else if (type === "payment") {
      const receipt = state.receipts.find((item) => item.id === Number(id));
      const options = state.possibilities.filter((item) => item.receiptIds.includes(receipt.id)).slice(0, 5);
      const invoice = receipt.finalInvoice ? state.invoices.find((item) => item.number === receipt.finalInvoice) : null;
      html += `<span class="panel-kicker">DIAGNÓSTICO DO PAGAMENTO</span><h3>Pagamento ID ${receipt.id} — ${esc(receipt.displayName)}</h3>${renderFileCompanyContext()}
        <div class="conc-payment-investigation">${renderPaymentFullCard(receipt,"QUEM PAGOU")}<div class="conc-candidate-panel"><span>${invoice ? "NFS-e CONFIRMADA" : "POSSÍVEIS NFS-e"}</span>${invoice ? `<article class="conc-candidate-card selected"><div class="conc-candidate-score">✓</div><div><strong>NFS-e ${esc(invoice.number)} — ${esc(invoice.customer)}</strong><small>${esc(formatDoc(invoice.document) || "Documento não informado")} · ${brl.format(invoice.amount)}</small><p>${esc(receipt.linkReason || "Vínculo confirmado durante a conciliação.")}</p></div></article>` : renderPossibleInvoicesCards(receipt, options)}</div></div>
        <div class="receipts-evidence"><strong>Leitura rápida</strong><p>${invoice ? `Este pagamento está ligado à NFS-e ${esc(invoice.number)}. Compare acima o nome, CPF/CNPJ, valor e referência sem precisar voltar ao Excel.` : (receipt.refs.length ? "O número informado não resultou em um vínculo seguro. As melhores possibilidades estão listadas acima com tomador, documento, valor e saldo." : "Nenhum número válido de NFS-e foi informado. Use as possibilidades acima para decidir com os dados já importados.")}</p></div>`;
    } else {
      const item = state.possibilities.find((possibility) => possibility.key === id);
      const invoice = state.invoices.find((note) => note.number === item.invoice);
      const receipts = state.receipts.filter((receipt) => item.receiptIds.includes(receipt.id));
      html += `<span class="panel-kicker">POSSIBILIDADE DE VÍNCULO</span><h3>${item.score}% de compatibilidade</h3>${renderFileCompanyContext()}
        <div class="conc-queue-story conc-queue-story-decision"><div class="conc-story-side conc-note-summary"><span>NOTA DA PREFEITURA</span><strong>NFS-e ${esc(invoice.number)} · ${brl.format(invoice.amount)}</strong><small>${esc(invoice.customer)} · ${esc(formatDoc(invoice.document))}</small><div class="conc-note-numbers"><div><span>Saldo</span><strong>${brl.format(invoice.difference)}</strong></div><div><span>Sugerido</span><strong>${brl.format(item.paymentAmount)}</strong></div></div></div><div class="conc-story-arrow">↔</div>${renderRelatedPaymentsDecision(invoice, receipts)}</div>
        ${renderDecisionEvidence(invoice, receipts)}
        <div class="receipts-evidence"><strong>Por que o sistema sugeriu</strong><p>${esc(item.reason)}</p><button class="button button-primary" id="receiptsDetailConfirm">Confirmar este vínculo</button></div>`;
    }
    panel.innerHTML = html;
    q("#receiptsDetailClose").addEventListener("click", () => { state.detail = null; panel.classList.add("hidden"); panel.innerHTML = ""; });
    q("#receiptsDetailConfirm")?.addEventListener("click", () => confirmPossibilities([id], "Vínculo confirmado após análise dos detalhes."));
    if (type === "note") {
      const invoice = state.invoices.find((item) => item.number === String(id));
      const receipts = assignedReceipts(invoice);
      qa(".conc-payment-pick", panel).forEach((input) => input.addEventListener("change", () => {
        const current = new Set(state.detailSelections[invoice.number] || receipts.map((receipt) => receipt.id));
        const pid = Number(input.dataset.paymentId);
        if (input.checked) current.add(pid); else current.delete(pid);
        state.detailSelections[invoice.number] = [...current];
        openDetail(type, id, false);
      }));
      q("#detailSelectAllBtn")?.addEventListener("click", () => {
        state.detailSelections[invoice.number] = receipts.map((receipt) => receipt.id);
        openDetail(type, id, false);
      });
      q("#detailClearSelectionBtn")?.addEventListener("click", () => {
        state.detailSelections[invoice.number] = [];
        openDetail(type, id, false);
      });
      q("#detailKeepCompatibleBtn")?.addEventListener("click", () => {
        const compatible = receipts.filter((receipt) => {
          const sameDoc = invoice.docNorm && receipt.docNorm && invoice.docNorm === receipt.docNorm;
          const cites = receipt.refs?.includes(invoice.number);
          const goodName = nameSimilarity(receipt.displayName, invoice.customer) >= 75;
          return sameDoc || cites || goodName;
        }).map((receipt) => receipt.id);
        state.detailSelections[invoice.number] = compatible;
        openDetail(type, id, false);
      });
      q("#detailUseSelectionBtn")?.addEventListener("click", () => {
        state.builderInvoice = invoice.number;
        state.builderSelected = new Set(state.detailSelections[invoice.number] || []);
        state.builderOutcome = "";
        goPage("builder");
        renderBuilder();
        q('[data-conc-section="builder"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
        notify("Seleção enviada para a Mesa de vínculos. Agora você pode registrar como vínculo completo ou pagamento parcial.");
      });
    }
    if (scroll) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function itemLabel(row) {
    if (row.type === "note") return `NFS-e ${row.invoice.number}`;
    if (row.type === "payment") return `Pagamento ID ${row.receipt.id}`;
    if (row.type === "possibility") return `NFS-e ${row.possibility.invoice} ↔ pagamento ID ${row.possibility.receiptIds.join("+")}`;
    return row.key;
  }

  function applyBulk() {
    const rows = filteredRows().filter((row) => state.selected.has(row.key));
    if (!rows.length) { notify("Selecione ao menos um item.", true); return; }
    const decision = q("#receiptsBulkDecision").value; const comment = q("#receiptsBulkComment").value.trim();
    if (state.view === "possibilities" && decision === "confirmado") {
      confirmPossibilities(rows.map((row) => row.possibility.key), comment || "Vínculo confirmado em lote."); return;
    }
    const before = progressStats();
    snapshot(`decisão em ${rows.length} item(ns)`);
    const labels = {
      confirmado: "Confirmado como correto",
      parcial_confirmado: "Pagamento parcial confirmado — saldo permanece em aberto",
      corrigir_planilha: "Corrigir referência ou cadastro na planilha",
      pagamento_outra_competencia: "Pagamento pertence a NFS-e de outra competência",
      nota_pagamento_nao_localizado: "Nota emitida — pagamento não localizado nesta competência",
      nao_receita: "Lançamento não deve entrar como receita",
      revisar: "Revisar depois — manter na fila",
      outro_mes: "Pagamento pertence a NFS-e de outra competência",
      sem_pagamento: "Nota emitida — pagamento não localizado nesta competência",
    };
    rows.forEach((row) => {
      state.decisions[row.key] = { label: labels[decision], code: decision, comment, item: itemLabel(row), view: state.view, at: new Date().toLocaleString("pt-BR") };
    });
    state.selected.clear(); q("#receiptsSelectAll").checked = false; persist(); renderAll(); feedbackAfterProgress(before, rows.length);
  }

  function confirmPossibilities(keys, comment) {
    const items = keys.map((key) => state.possibilities.find((item) => item.key === key)).filter(Boolean);
    if (!items.length) { notify("A possibilidade não está mais disponível.", true); return; }
    const used = new Set();
    for (const item of items) {
      for (const id of item.receiptIds) {
        const receipt = state.receipts.find((candidate) => candidate.id === id);
        if (!receipt || receipt.finalInvoice || used.has(id)) { notify(`O pagamento ID ${id} já está vinculado. Atualize a análise antes de continuar.`, true); return; }
        used.add(id);
      }
    }
    const before = progressStats();
    snapshot(`confirmação de ${items.length} vínculo(s)`);
    items.forEach((item) => {
      state.manualLinks.push({ invoice: item.invoice, receiptIds: [...item.receiptIds], comment, at: new Date().toLocaleString("pt-BR") });
      state.decisions[item.key] = { label: "Vínculo confirmado", code: "confirmado", comment, item: `NFS-e ${item.invoice} ↔ pagamento ID ${item.receiptIds.join("+")}`, view: "possibilities", at: new Date().toLocaleString("pt-BR") };
    });
    state.selected.clear(); q("#receiptsSelectAll").checked = false; state.detail = null;
    reconcileBase(); persist(); renderAll(); q("#receiptsDetailPanel").classList.add("hidden"); feedbackAfterProgress(before, items.length);
    if (state.page === "quick" && !state.result.strongPossibilities.some((item) => !isResolvedDecision(item.key))) {
      setTimeout(() => { showCelebration("Ganhos rápidos concluídos", "O Assistente já preparou a próxima etapa.", "⚡"); goPage("assistant"); }, 280);
    }
  }

  function linkedReceiptsForInvoice(invoice) {
    const ids = [...new Set([...(invoice.confirmedReceiptIds || []), ...(invoice.manualReceiptIds || [])])];
    return state.receipts.filter((receipt) => ids.includes(receipt.id));
  }

  function payerSummaryForReport(receipts) {
    const groups = new Map();
    receipts.forEach((receipt) => {
      const name = receipt.displayName || receipt.client || "Pagador não informado";
      const key = `${receipt.docNorm || "SEM_DOC"}|${norm(name)}`;
      if (!groups.has(key)) groups.set(key, { name, document: receipt.document || "", total: 0, ids: [] });
      const group = groups.get(key);
      group.total = round2(group.total + receipt.received);
      group.ids.push(receipt.id);
    });
    return [...groups.values()].map((group) =>
      `${group.name}${group.document ? ` (${formatDoc(group.document)})` : ""} — R$ ${group.total.toFixed(2).replace(".", ",")} — ID(s) ${group.ids.join(", ")}`
    ).join(" | ");
  }

  function invoiceReportCategory(invoice) {
    const decision = decisionFor(noteKey(invoice));
    const receipts = linkedReceiptsForInvoice(invoice);
    const hasPayment = receipts.length > 0 && invoice.receivedTotal > TOLERANCE;
    if (["nota_pagamento_nao_localizado", "sem_pagamento"].includes(decision?.code)) return "Nota emitida — pagamento não localizado";
    if (["pagamento_parcial_confirmado", "parcial_confirmado"].includes(decision?.code)) return "Pago parcialmente — saldo em aberto";
    if (hasPayment && Math.abs(invoice.difference) <= TOLERANCE) return "Pago e conciliado";
    if (hasPayment && invoice.difference > TOLERANCE) return "Pago parcialmente — saldo em aberto";
    if (hasPayment && invoice.difference < -TOLERANCE) return "Pagamento acima da nota — revisar";
    return "Nota emitida — pagamento não localizado";
  }

  function invoiceReconciliationMethod(invoice, receipts) {
    const decision = decisionFor(noteKey(invoice));
    const manualLinks = state.manualLinks.filter((link) => link.invoice === invoice.number);
    if (["nota_pagamento_nao_localizado", "sem_pagamento"].includes(decision?.code)) {
      return "Conferência manual: a nota foi analisada e marcada como pagamento não localizado nesta competência.";
    }
    if (["pagamento_parcial_confirmado", "parcial_confirmado"].includes(decision?.code)) {
      return "Conferência manual: os pagamentos localizados foram confirmados como parciais e o saldo foi mantido em aberto.";
    }
    if (manualLinks.length || (invoice.manualReceiptIds || []).length) {
      const outcomes = manualLinks.map((link) => link.outcome === "partial" ? "pagamento parcial" : "vínculo completo");
      return `Vínculo manual confirmado pelo usuário${outcomes.length ? ` (${[...new Set(outcomes)].join(" e ")})` : ""}.`;
    }
    if ((invoice.confirmedReceiptIds || []).length) {
      return `Conciliação automática pelo Conferinho usando ${String(invoice.criterion || "número da nota, CPF/CNPJ e valor").toLowerCase()}.`;
    }
    if (receipts.length) return "Pagamentos relacionados localizados, mas a conclusão ainda precisa de revisão.";
    return "Nenhum vínculo foi confirmado para esta NFS-e.";
  }

  function invoiceWhyText(invoice, receipts) {
    const reasons = [];
    if (invoice.explanation) reasons.push(invoice.explanation);
    receipts.forEach((receipt) => {
      if (receipt.linkReason && !reasons.includes(receipt.linkReason)) reasons.push(receipt.linkReason);
    });
    const decision = decisionFor(noteKey(invoice));
    if (decision?.comment && !reasons.includes(decision.comment)) reasons.push(decision.comment);
    state.manualLinks.filter((link) => link.invoice === invoice.number).forEach((link) => {
      if (link.comment && !reasons.includes(link.comment)) reasons.push(link.comment);
    });
    return reasons.join(" | ") || "O caso ainda não possui justificativa registrada.";
  }

  function invoiceReportRow(invoice) {
    const receipts = linkedReceiptsForInvoice(invoice);
    const decision = decisionFor(noteKey(invoice));
    const category = invoiceReportCategory(invoice);
    const missing = Math.max(0, round2(invoice.difference));
    const excess = Math.max(0, round2(-invoice.difference));
    return {
      "NFS-e": invoice.number,
      "Emissão": invoice.issueDate,
      "Tomador / cliente da nota": invoice.customer,
      "CPF/CNPJ do tomador": invoice.document,
      "Valor da nota": invoice.amount,
      "Valor pago localizado": invoice.receivedTotal,
      "Quanto ainda falta": missing,
      "Valor acima da nota": excess,
      "Resultado final": category,
      "Situação técnica": invoice.status,
      "Confiança (%)": invoice.confidence || 0,
      "Critério usado": invoice.criterion || "",
      "Quantidade de pagamentos": receipts.length,
      "IDs dos pagamentos": receipts.map((receipt) => receipt.id).join(", "),
      "Quem pagou": payerSummaryForReport(receipts),
      "Datas dos pagamentos": [...new Set(receipts.map((receipt) => receipt.creditDate).filter(Boolean))].join(" | "),
      "Notas informadas no Excel": [...new Set(receipts.map((receipt) => receipt.invoiceRaw).filter(Boolean))].join(" | "),
      "Como foi conciliado": invoiceReconciliationMethod(invoice, receipts),
      "Por que foi conciliado / classificado": invoiceWhyText(invoice, receipts),
      "O que foi feito": decision?.label || (category === "Pago e conciliado" ? "Vínculo confirmado e nota encerrada" : category),
      "Comentário do usuário": decision?.comment || "",
      "Próxima ação": invoice.action || "",
    };
  }

  function paymentReportStatus(receipt, invoice) {
    const decision = decisionFor(paymentKey(receipt));
    if (receipt.finalInvoice && invoice) return invoiceReportCategory(invoice);
    if (["pagamento_outra_competencia", "outro_mes"].includes(decision?.code)) return "Pagamento de outra competência";
    if (decision?.code === "pagamento_sem_nota_competencia") return "Pagamento conferido — NFS-e não localizada nesta competência";
    if (decision?.code === "nao_receita") return "Lançamento não classificado como receita";
    return "Pagamento sem nota confirmada";
  }

  function paymentReportRow(receipt) {
    const invoice = receipt.finalInvoice ? state.invoices.find((note) => note.number === receipt.finalInvoice) : null;
    const paymentDecision = decisionFor(paymentKey(receipt));
    const noteDecision = invoice ? decisionFor(noteKey(invoice)) : null;
    const possible = state.possibilities.filter((item) => item.receiptIds.includes(receipt.id)).slice(0, 5);
    return {
      "Minha Empresa (Razão Social)": state.meta.company || "",
      "Minha Empresa (CNPJ)": state.meta.companyDoc || "",
      "Data de Crédito ou Débito (No Extrato)": receipt.creditDate,
      "CNPJ/CPF": receipt.document,
      "Cliente": receipt.client,
      "Razão Social": receipt.legalName,
      "Emissão": receipt.issueDate,
      "Categoria": receipt.category,
      "Conta Corrente": receipt.bank,
      "Nota Fiscal (informada no Excel)": receipt.invoiceRaw,
      "Origem": receipt.origin,
      "Número": receipt.internalNumber,
      "Valor da Conta": receipt.accountValue,
      "Recebido": receipt.received,
      "A Receber (original)": receipt.openAmount,
      "Resultado da conciliação": paymentReportStatus(receipt, invoice),
      "NFS-e vinculada": receipt.finalInvoice || "",
      "Tomador da NFS-e": invoice?.customer || "",
      "CPF/CNPJ da NFS-e": invoice?.document || "",
      "Valor da NFS-e": invoice?.amount || "",
      "Total localizado na NFS-e": invoice?.receivedTotal || "",
      "Quanto ainda falta na NFS-e": invoice ? Math.max(0, round2(invoice.difference)) : "",
      "Tipo do vínculo": receipt.assignment || "Sem vínculo",
      "Confiança (%)": receipt.confidence || 0,
      "Como este pagamento foi conciliado": receipt.finalInvoice
        ? `${receipt.assignment || "Vínculo identificado"}${invoice?.criterion ? ` — critério: ${invoice.criterion}` : ""}`
        : (paymentDecision?.label || "Nenhum vínculo confirmado"),
      "Por que este pagamento foi conciliado / ficou sem nota": receipt.linkReason || (possible.length
        ? `Possibilidades: ${possible.map((item) => `${item.score}% para NFS-e ${item.invoice}`).join(" | ")}`
        : "Nenhuma NFS-e com compatibilidade suficiente foi encontrada."),
      "Decisão do usuário": paymentDecision?.label || noteDecision?.label || "",
      "Comentário / justificativa": paymentDecision?.comment || noteDecision?.comment || "",
      "ID do pagamento": receipt.id,
      "Linha original do Excel": receipt.sourceRow,
    };
  }

  function exportExcel() {
    if (!window.XLSX || !state.result) { notify("A biblioteca de Excel não carregou.", true); return; }
    const wb = XLSX.utils.book_new();
    const invoiceRows = state.invoices.map(invoiceReportRow);
    const paymentRows = state.receipts.filter((receipt) => receipt.active).map(paymentReportRow);
    const fullyPaid = invoiceRows.filter((row) => row["Resultado final"] === "Pago e conciliado");
    const partiallyPaid = invoiceRows.filter((row) => row["Resultado final"] === "Pago parcialmente — saldo em aberto");
    const notFound = invoiceRows.filter((row) => row["Resultado final"] === "Nota emitida — pagamento não localizado");
    const overpaid = invoiceRows.filter((row) => row["Resultado final"] === "Pagamento acima da nota — revisar");
    const paymentsWithoutNote = paymentRows.filter((row) => row["Resultado da conciliação"] !== "Pago e conciliado" && !row["NFS-e vinculada"]);
    const followUpRows = [
      ...partiallyPaid.map((row) => ({
        "Tipo de acompanhamento": "Saldo de pagamento parcial",
        "NFS-e / Pagamento": `NFS-e ${row["NFS-e"]}`,
        "Cliente / Tomador": row["Tomador"],
        "CPF/CNPJ": row["CPF/CNPJ do tomador"],
        "Valor original": row["Valor da nota"],
        "Valor localizado": row["Valor pago localizado"],
        "Saldo a acompanhar": row["Quanto ainda falta"],
        "Próxima ação": row["Próxima providência recomendada"],
        "Comentário": row["Comentário do usuário"],
      })),
      ...notFound.map((row) => ({
        "Tipo de acompanhamento": "Nota emitida sem pagamento localizado",
        "NFS-e / Pagamento": `NFS-e ${row["NFS-e"]}`,
        "Cliente / Tomador": row["Tomador"],
        "CPF/CNPJ": row["CPF/CNPJ do tomador"],
        "Valor original": row["Valor da nota"],
        "Valor localizado": row["Valor pago localizado"],
        "Saldo a acompanhar": row["Quanto ainda falta"],
        "Próxima ação": row["Próxima providência recomendada"],
        "Comentário": row["Comentário do usuário"],
      })),
      ...paymentRows.filter((row) => String(row["Resultado da conciliação"]).includes("outra competência") || String(row["Resultado da conciliação"]).includes("NFS-e não localizada")).map((row) => ({
        "Tipo de acompanhamento": row["Resultado da conciliação"],
        "NFS-e / Pagamento": `Pagamento ID ${row["ID do pagamento"]}`,
        "Cliente / Tomador": row["Razão Social"] || row["Cliente"],
        "CPF/CNPJ": row["CNPJ/CPF"],
        "Valor original": row["Recebido"],
        "Valor localizado": "",
        "Saldo a acompanhar": row["Recebido"],
        "Próxima ação": "Conferir na competência correta e vincular à NFS-e correspondente.",
        "Comentário": row["Comentário / justificativa"],
      })),
    ];

    const noteValue = (rows) => sum(rows, (row) => row["Valor da nota"]);
    const localizedValue = (rows) => sum(rows, (row) => row["Valor pago localizado"]);
    const missingValue = (rows) => sum(rows, (row) => row["Quanto ainda falta"]);
    const summary = [
      ["CONFERINHO — RELATÓRIO FINAL DA CONCILIAÇÃO DE RECEBIMENTOS"],
      ["Empresa", state.meta.company || "Não identificada"],
      ["CNPJ", state.meta.companyDoc || ""],
      ["Período das NFS-e", state.meta.period || ""],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      [],
      ["SITUAÇÃO", "QUANTIDADE", "VALOR DAS NOTAS", "VALOR LOCALIZADO", "SALDO / FALTA"],
      ["Pago e conciliado", fullyPaid.length, noteValue(fullyPaid), localizedValue(fullyPaid), missingValue(fullyPaid)],
      ["Pago parcialmente — saldo em aberto", partiallyPaid.length, noteValue(partiallyPaid), localizedValue(partiallyPaid), missingValue(partiallyPaid)],
      ["Nota emitida — pagamento não localizado", notFound.length, noteValue(notFound), localizedValue(notFound), missingValue(notFound)],
      ["Pagamento acima da nota — revisar", overpaid.length, noteValue(overpaid), localizedValue(overpaid), sum(overpaid, (row) => row["Valor acima da nota"])],
      ["Pagamentos sem nota confirmada", paymentsWithoutNote.length, "", sum(paymentsWithoutNote, (row) => row["Recebido"]), ""],
      ["Itens para acompanhar em outra competência", followUpRows.length, "", "", sum(followUpRows, (row) => row["Saldo a acompanhar"])],
      [],
      ["TOTAL DAS NFS-e", invoiceRows.length, noteValue(invoiceRows), localizedValue(invoiceRows), missingValue(invoiceRows)],
      ["Decisões registradas", Object.keys(state.decisions).length + state.manualLinks.length],
      [],
      ["COMO LER O RELATÓRIO"],
      ["Pago e conciliado", "O valor da NFS-e foi totalmente localizado e o vínculo foi concluído."],
      ["Pago parcialmente", "Uma parte foi localizada e confirmada; a coluna 'Quanto ainda falta' mostra o saldo pendente."],
      ["Pagamento não localizado", "A nota foi emitida, mas não foi encontrado pagamento nesta competência."],
      ["Relatório principal", "Mantém a estrutura do Excel de recebimentos e acrescenta a situação, a NFS-e vinculada, o saldo, o método e a justificativa."],
    ];

    const moneyHeaders = new Set([
      "Valor da nota", "Valor pago localizado", "Quanto ainda falta", "Valor acima da nota", "Valor da Conta", "Recebido",
      "A Receber (original)", "Valor da NFS-e", "Total localizado na NFS-e", "Quanto ainda falta na NFS-e",
      "VALOR DAS NOTAS", "VALOR LOCALIZADO", "SALDO / FALTA", "Valor recebido", "Saldo",
    ]);
    const decorateSheet = (ws, { filter = true, moneyHeaderRow = 0 } = {}) => {
      if (!ws["!ref"]) return;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      if (filter && range.e.r > moneyHeaderRow) {
        ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: moneyHeaderRow, c: range.s.c }, e: range.e }) };
      }
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const headerCell = ws[XLSX.utils.encode_cell({ r: moneyHeaderRow, c: col })];
        const header = String(headerCell?.v || "");
        if (!moneyHeaders.has(header)) continue;
        for (let row = moneyHeaderRow + 1; row <= range.e.r; row += 1) {
          const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
          if (cell && typeof cell.v === "number") cell.z = '"R$" #,##0.00';
        }
      }
      ws["!rows"] = ws["!rows"] || [];
      ws["!rows"][moneyHeaderRow] = { hpt: 25 };
    };
    const addAoaSheet = (name, data, widths = [], options = {}) => {
      const ws = XLSX.utils.aoa_to_sheet(data);
      if (widths.length) ws["!cols"] = widths.map((wch) => ({ wch }));
      decorateSheet(ws, { filter: false, moneyHeaderRow: options.moneyHeaderRow || 6 });
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      return ws;
    };
    const addJsonSheet = (name, data, widths = []) => {
      const safe = data.length ? data : [{ "Informação": "Nenhum registro nesta situação." }];
      const ws = XLSX.utils.json_to_sheet(safe);
      if (widths.length) ws["!cols"] = widths.map((wch) => ({ wch }));
      decorateSheet(ws, { filter: true, moneyHeaderRow: 0 });
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
      return ws;
    };

    addAoaSheet("Resumo executivo", summary, [42, 24, 20, 20, 20], { moneyHeaderRow: 6 });
    addJsonSheet("Relatório principal", paymentRows, [34, 20, 19, 20, 30, 34, 14, 30, 24, 22, 32, 16, 16, 16, 18, 34, 15, 34, 20, 16, 18, 20, 26, 14, 42, 66, 38, 55, 14, 18]);
    addJsonSheet("Relatório das notas", invoiceRows, [12, 14, 36, 20, 16, 18, 18, 18, 38, 30, 14, 28, 16, 22, 70, 28, 28, 52, 75, 42, 58, 52]);
    addJsonSheet("Pagas e conciliadas", fullyPaid, [12, 14, 36, 20, 16, 18, 18, 18, 32, 28, 14, 26, 16, 22, 70, 28, 28, 52, 75, 42, 58, 52]);
    addJsonSheet("Pagas parcialmente", partiallyPaid, [12, 14, 36, 20, 16, 18, 18, 18, 38, 30, 14, 26, 16, 22, 70, 28, 28, 52, 75, 42, 58, 52]);
    addJsonSheet("Pgto não localizado", notFound, [12, 14, 36, 20, 16, 18, 18, 18, 42, 30, 14, 26, 16, 22, 70, 28, 28, 52, 75, 42, 58, 52]);
    if (overpaid.length) addJsonSheet("Acima da nota - revisar", overpaid, [12, 14, 36, 20, 16, 18, 18, 18, 42, 30, 14, 26, 16, 22, 70, 28, 28, 52, 75, 42, 58, 52]);
    addJsonSheet("Pagamentos sem nota", paymentsWithoutNote, [34, 20, 19, 20, 30, 34, 14, 30, 24, 22, 32, 16, 16, 16, 18, 38, 15, 34, 20, 16, 18, 20, 26, 14, 42, 66, 38, 55, 14, 18]);
    addJsonSheet("Acompanhar próxima competência", followUpRows, [34, 22, 38, 20, 18, 18, 20, 60, 55]);

    const auditRows = [];
    invoiceRows.forEach((row) => {
      auditRows.push({
        "Data/hora": "",
        "Tipo de registro": "Resultado da NFS-e",
        "NFS-e": row["NFS-e"],
        "ID pagamento": row["IDs dos pagamentos"],
        "Resultado": row["Resultado final"],
        "O que foi feito": row["O que foi feito"],
        "Como foi conciliado": row["Como foi conciliado"],
        "Por que": row["Por que foi conciliado / classificado"],
        "Comentário": row["Comentário do usuário"],
      });
    });
    Object.values(state.decisions).forEach((decision) => auditRows.push({
      "Data/hora": decision.at,
      "Tipo de registro": "Decisão do usuário",
      "NFS-e": String(decision.item || "").match(/NFS-e\s+(\d+)/i)?.[1] || "",
      "ID pagamento": String(decision.item || "").match(/Pagamento ID\s+(\d+)/i)?.[1] || "",
      "Resultado": decision.label,
      "O que foi feito": decision.item,
      "Como foi conciliado": decision.view || "Conferência manual",
      "Por que": decision.comment || "Decisão registrada pelo usuário.",
      "Comentário": decision.comment || "",
    }));
    state.manualLinks.forEach((link) => auditRows.push({
      "Data/hora": link.at,
      "Tipo de registro": "Vínculo manual",
      "NFS-e": link.invoice,
      "ID pagamento": link.receiptIds.join(", "),
      "Resultado": link.outcome === "partial" ? "Pagamento parcial confirmado" : "Vínculo completo confirmado",
      "O que foi feito": `Pagamento(s) ${link.receiptIds.join(", ")} vinculado(s) à NFS-e ${link.invoice}`,
      "Como foi conciliado": "Seleção manual na Mesa de Vínculos",
      "Por que": link.comment || "Vínculo confirmado pelo usuário.",
      "Comentário": link.comment || "",
    }));
    addJsonSheet("Trilha de auditoria", auditRows, [20, 24, 12, 20, 36, 50, 48, 70, 60]);

    addJsonSheet("Possibilidades", state.possibilities.map((item) => ({
      "Compatibilidade (%)": item.score,
      "NFS-e": item.invoice,
      "Cliente da nota": item.noteCustomer,
      "Saldo da nota": item.noteBalance,
      "IDs pagamento": item.receiptIds.join(" + "),
      "Cliente do pagamento": item.paymentCustomer,
      "Valor pagamento": item.paymentAmount,
      "Motivo da possibilidade": item.reason,
      "Decisão": state.decisions[item.key]?.label || "Pendente",
    })), [18, 12, 36, 16, 20, 36, 16, 62, 28]);

    addJsonSheet("Lançamentos ignorados", state.ignored.map((receipt) => ({
      "ID": receipt.id,
      "Data": receipt.creditDate,
      "Cliente": receipt.displayName,
      "CPF/CNPJ": receipt.document,
      "Valor": receipt.received,
      "Origem": receipt.origin,
      "Motivo de não entrar na conciliação": receipt.ignoredReason,
      "Linha original do Excel": receipt.sourceRow,
    })), [10, 14, 36, 20, 16, 32, 58, 18]);

    addAoaSheet("Como interpretar", [
      ["GUIA DO RELATÓRIO"],
      ["Aba", "O que mostra"],
      ["Relatório principal", "Os recebimentos no formato próximo ao Excel original, acrescidos de NFS-e, resultado, saldo, método e justificativa."],
      ["Relatório das notas", "Uma linha por NFS-e, com o total pago, quanto falta, quem pagou, como foi conciliada e por quê."],
      ["Pagas e conciliadas", "Somente notas cujo valor foi totalmente localizado e confirmado."],
      ["Pagas parcialmente", "Notas com parte do pagamento confirmada; a coluna 'Quanto ainda falta' mostra o saldo."],
      ["Pgto não localizado", "Notas emitidas para as quais não foi localizado pagamento nesta competência."],
      ["Pagamentos sem nota", "Recebimentos que ainda não possuem NFS-e confirmada ou foram classificados em outra situação."],
      ["Acompanhar próxima competência", "Saldos parciais, notas sem pagamento localizado e recebimentos classificados em outro período."],
      ["Trilha de auditoria", "Histórico do que foi feito, como cada pagamento foi conciliado e qual justificativa sustentou a decisão."],
      ["Possibilidades", "Sugestões ainda não confirmadas pelo sistema ou pelo usuário."],
    ], [30, 110], { moneyHeaderRow: 1 });

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Conferinho_Relatorio_Completo_Conciliacao_${date}.xlsx`);
    notify("Relatório Excel completo gerado: pagos, parciais, não localizados, pagamentos sem nota e trilha de auditoria.");
  }

  function saveSession() {
    persist();
    const payload = {
      version: "25", signature: state.signature, savedAt: new Date().toISOString(), meta: state.meta,
      decisions: state.decisions, manualLinks: state.manualLinks,
      progressBaseline: state.progressBaseline, initialClearCount: state.initialClearCount,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `Conferinho_Sessao_${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    notify("Sessão salva no navegador e baixada em JSON.");
  }

  async function analyze() {
    if (!state.excelFile || !state.pdfFile) return;
    q("#receiptsProgress").classList.remove("hidden"); q("#receiptsResults").classList.add("hidden"); q("#receiptsAnalyzeBtn").disabled = true;
    try {
      progress(.05, "Abrindo a planilha de recebimentos");
      const excel = await parseReceiptsExcel(state.excelFile);
      state.receipts = excel.records; state.meta = { ...excel.metadata };
      progress(.34, `${state.receipts.length} lançamentos identificados no Excel`);
      const pdf = await parseInvoicesPdf(state.pdfFile);
      state.invoices = pdf.records; state.meta = { ...state.meta, ...pdf.metadata };
      progress(.7, `${state.invoices.length} NFS-e extraídas. Cruzando números, documentos, valores e datas`);
      state.signature = sessionSignature(); state.decisions = {}; state.manualLinks = []; state.history = [];
      const restored = restore();
      reconcileBase();
      const currentPendingAtStart = allPendingQueueRows().length;
      if (!state.progressBaseline) state.progressBaseline = currentPendingAtStart;
      if (!state.initialClearCount) state.initialClearCount = state.result.clear.length;
      state.sessionStartResolved = Math.max(0, state.progressBaseline - currentPendingAtStart);
      state.lastMilestone = Math.floor((progressStats().humanPercent || 0) / 25) * 25;
      state.goalCelebrated = false;
      progress(.94, "Preparando listas de pendências e possibilidades");
      await new Promise((resolve) => setTimeout(resolve, 100));
      q("#receiptsResults").classList.remove("hidden"); q("#concUploadPage").classList.add("hidden"); document.body.classList.add("has-results"); state.view = "clear"; state.search = ""; state.selected.clear(); state.detail = null; state.page = "assistant"; state.builderInvoice = ""; state.builderSelected.clear();
      q("#receiptsSearchInput").value = ""; q("#receiptsEasyOnly").checked = false; q("#receiptsHideResolved").checked = true;
      q("#receiptsUndoBtn").disabled = true;
      renderAll(); goPage("assistant", false); progress(1, "Conciliação concluída");
      q("#receiptsResults").scrollIntoView({ behavior: "smooth", block: "start" });
      notify(restored ? "Conciliação restaurada. Continue pela Caixa inteligente." : "Conciliação concluída. A Caixa inteligente já separou o que precisa de você.");
      showGuidedWelcome(false);
    } catch (error) {
      console.error(error); notify(`Não foi possível conciliar: ${error.message}`, true);
    } finally {
      q("#receiptsAnalyzeBtn").disabled = !(state.excelFile && state.pdfFile);
      setTimeout(() => q("#receiptsProgress").classList.add("hidden"), 600);
    }
  }

  function reset() {
    state.excelFile = null; state.pdfFile = null; state.receipts = []; state.invoices = []; state.ignored = []; state.possibilities = [];
    state.decisions = {}; state.manualLinks = []; state.history = []; state.result = null; state.selected.clear(); state.detail = null; state.signature = ""; state.meta = {};
    state.progressBaseline = 0; state.initialClearCount = 0; state.sessionStartResolved = 0; state.lastMilestone = 0; state.goalCelebrated = false; state.focusMode = false;
    document.body.classList.remove("queue-focus", "has-results");
    q("#receiptsExcelInput").value = ""; q("#receiptsPdfInput").value = ""; q("#receiptsExcelFileList").innerHTML = ""; q("#receiptsPdfFileList").innerHTML = "";
    q("#receiptsResults").classList.add("hidden"); q("#concUploadPage").classList.remove("hidden"); q("#receiptsProgress").classList.add("hidden"); q("#receiptsDetailPanel").classList.add("hidden");
    state.page = "assistant"; state.builderInvoice = ""; state.builderSelected.clear(); state.consultMatches = [];
    if (q("#builderInvoiceSearch")) q("#builderInvoiceSearch").value = "";
    if (q("#builderSearchInput")) q("#builderSearchInput").value = "";
    if (q("#builderInvoiceSort")) q("#builderInvoiceSort").value = "impact";
    if (q("#builderSuggestedOnly")) q("#builderSuggestedOnly").checked = true;
    updateReady(); notify("Módulo de recebimentos limpo.");
  }

  window.resetReceiptsModule = reset;

  bindDropzone(q("#receiptsExcelDropzone"), q("#receiptsExcelInput"), (file) => /\.(xlsx|xls)$/i.test(file.name), setExcel);
  bindDropzone(q("#receiptsPdfDropzone"), q("#receiptsPdfInput"), (file) => /\.pdf$/i.test(file.name), setPdf);
  q("#receiptsAnalyzeBtn")?.addEventListener("click", analyze);
  q("#receiptsUndoBtn")?.addEventListener("click", undo);
  q("#receiptsExportBtn")?.addEventListener("click", exportExcel);
  q("#receiptsSessionBtn")?.addEventListener("click", saveSession);
  q("#receiptsStartEasyBtn")?.addEventListener("click", () => { state.page = "quick"; goPage("quick"); });
  qa("[data-receipts-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.receiptsView)));
  qa("[data-receipts-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.receiptsGo)));
  q("#receiptsSearchInput")?.addEventListener("input", (event) => { state.search = event.target.value; state.selected.clear(); renderTable(); });
  q("#receiptsEasyOnly")?.addEventListener("change", (event) => { state.easyOnly = event.target.checked; state.selected.clear(); renderTable(); });
  q("#receiptsHideResolved")?.addEventListener("change", (event) => { state.hideResolved = event.target.checked; state.selected.clear(); renderTable(); });
  q("#receiptsSelectAll")?.addEventListener("change", (event) => {
    const keys = filteredRows().map((row) => row.key);
    if (event.target.checked) keys.forEach((key) => state.selected.add(key)); else keys.forEach((key) => state.selected.delete(key));
    renderTable();
  });
  q("#receiptsApplyBulkBtn")?.addEventListener("click", applyBulk);
  qa("[data-conc-page]").forEach((button) => button.addEventListener("click", () => goPage(button.dataset.concPage)));
  qa("[data-open-page]").forEach((button) => button.addEventListener("click", () => goPage(button.dataset.openPage)));
  q("#receiptsGlobalResetBtn")?.addEventListener("click", reset);
  q("#guidedContinueBtn")?.addEventListener("click", () => openGuidedBucket(state.guidedNext?.bucket || "finish"));
  q("#smartSafeConfirmBtn")?.addEventListener("click", confirmSafePossibilities);
  qa("[data-smart-action]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.smartAction;
    if (action === "confirm") return goPage("quick");
    if (action === "decide") return goPage("queue");
    if (action === "follow") { state.view = "decisions"; renderAll(); return goPage("triage"); }
  }));
  qa("[data-guided-bucket]").forEach((button) => button.addEventListener("click", () => openGuidedBucket(button.dataset.guidedBucket)));
  q("#guidedHelpBtn")?.addEventListener("click", () => showGuidedWelcome(true));
  q("#guidedWelcomeStart")?.addEventListener("click", hideGuidedWelcome);
  q("#guidedWelcomeClose")?.addEventListener("click", hideGuidedWelcome);
  q("#guidedWelcomeModal")?.addEventListener("click", (event) => { if (event.target.id === "guidedWelcomeModal") hideGuidedWelcome(); });
  q("#quickSelectAll")?.addEventListener("change", (event) => qa(".quick-check", q("#quickReviewList")).forEach((input) => { input.checked = event.target.checked; }));
  q("#quickSelectSafeBtn")?.addEventListener("click", () => {
    const checks = qa(".quick-check", q("#quickReviewList"));
    let selected = 0;
    checks.forEach((input) => { input.checked = Number(input.dataset.score || 0) >= 95; if (input.checked) selected += 1; });
    if (q("#quickSelectAll")) q("#quickSelectAll").checked = checks.length > 0 && selected === checks.length;
    notify(selected ? `${selected} vínculo(s) com 95% ou mais selecionados para sua revisão.` : "Nenhum vínculo com 95% ou mais está disponível.");
  });
  q("#quickConfirmBtn")?.addEventListener("click", () => {
    const keys = qa(".quick-check:checked", q("#quickReviewList")).map((input) => input.value);
    if (!keys.length) { notify("Selecione ao menos uma possibilidade.", true); return; }
    confirmPossibilities(keys, q("#quickComment").value.trim() || "Vínculo confirmado na Revisão rápida.");
    q("#quickComment").value = ""; q("#quickSelectAll").checked = false;
  });
  q("#builderInvoiceSelect")?.addEventListener("change", (event) => { state.builderInvoice = event.target.value; state.builderSelected.clear(); renderBuilder(); });
  q("#builderInvoiceSearch")?.addEventListener("input", () => { state.builderSelected.clear(); renderBuilder(); });
  q("#builderInvoiceSort")?.addEventListener("change", renderBuilder);
  q("#builderSearchInput")?.addEventListener("input", renderBuilder);
  q("#builderSuggestedOnly")?.addEventListener("change", renderBuilder);
  q("#builderAutoFitBtn")?.addEventListener("click", selectBuilderExactCombination);
  q("#builderClearSelectionBtn")?.addEventListener("click", () => { state.builderSelected.clear(); renderBuilder(); });
  q("#builderSelectedCount")?.addEventListener("click", () => {
    if (!state.builderSelected.size) return;
    q("#builderResultPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  q("#builderConfirmBtn")?.addEventListener("click", confirmBuilderLink);
  q("#queueFilter")?.addEventListener("change", (event) => { state.queueFilter = event.target.value; state.queueIndex = 0; renderQueue(); });
  q("#queueSearchInput")?.addEventListener("input", (event) => { state.queueSearch = event.target.value; state.queueIndex = 0; renderQueue(); });
  q("#queuePrevBtn")?.addEventListener("click", () => { state.queueIndex = Math.max(0, state.queueIndex - 1); renderQueue(); });
  q("#queueNextBtn")?.addEventListener("click", () => { state.queueIndex += 1; renderQueue(); });
  q("#queueSaveNextBtn")?.addEventListener("click", saveQueueDecision);
  q("#queueRecommendedBtn")?.addEventListener("click", () => {
    const code = state.queueRecommendedCode;
    if (!code) return;
    if (code === "builder") {
      if (state.queueRecommendedInvoice) state.builderInvoice = state.queueRecommendedInvoice;
      state.builderSelected.clear();
      goPage("builder");
      return;
    }
    const select = q("#queueDecision");
    select.value = code;
    q("#queueSaveNextBtn").disabled = false;
    qa("[data-queue-choice]").forEach((button) => button.classList.toggle("active", button.dataset.queueChoice === code));
    select.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  q("#conciliationContinueBtn")?.addEventListener("click", () => goPage(state.nextRecommendedPage || recommendedPage()));
  qa("[data-journey-page]").forEach((button) => button.addEventListener("click", () => goPage(button.dataset.journeyPage)));
  q("#sessionGoalSelect")?.addEventListener("change", (event) => {
    state.sessionGoal = Number(event.target.value || 10); state.goalCelebrated = false; persist(); renderProgressHub(); renderQueue();
  });
  q("#progressCelebration")?.addEventListener("click", () => q("#progressCelebration").classList.remove("show"));
  q("#queueDecision")?.addEventListener("change", (event) => {
    q("#queueSaveNextBtn").disabled = !event.target.value;
    qa("[data-queue-choice]").forEach((button) => button.classList.toggle("active", button.dataset.queueChoice === event.target.value));
  });
  qa("[data-queue-choice]").forEach((button) => button.addEventListener("click", () => {
    q("#queueDecision").value = button.dataset.queueChoice;
    q("#queueSaveNextBtn").disabled = false;
    qa("[data-queue-choice]").forEach((item) => item.classList.toggle("active", item === button));
  }));
  q("#queueSkipBtn")?.addEventListener("click", () => {
    const rows = pendingQueueRows(); if (!rows.length) return;
    state.queueIndex = rows.length > 1 ? (state.queueIndex + 1) % rows.length : 0;
    renderQueue(); notify("Caso pulado sem registrar decisão.");
  });
  q("#queueFocusBtn")?.addEventListener("click", () => {
    state.focusMode = !state.focusMode;
    document.body.classList.toggle("queue-focus", state.focusMode);
    q("#queueFocusBtn").textContent = state.focusMode ? "Sair do modo foco" : "Ativar modo foco (recomendado)";
    if (state.focusMode) q(".conc-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const runConsult = () => { state.consultMatches = consultMatches(q("#consultSearchInput").value); renderConsultResults(); if (state.consultMatches[0]) renderConsultStory(state.consultMatches[0]); };
  q("#consultSearchBtn")?.addEventListener("click", runConsult);
  q("#consultSearchInput")?.addEventListener("keydown", (event) => { if (event.key === "Enter") runConsult(); });
  q("#finishSessionBtn")?.addEventListener("click", saveSession);
  qa("[data-reading-size]").forEach((button) => button.addEventListener("click", () => {
    state.readingSize = button.dataset.readingSize === "large" ? "large" : "comfortable";
    applyDisplayPreferences();
  }));
  q("#calmModeToggle")?.addEventListener("change", (event) => {
    state.calmMode = event.target.checked;
    applyDisplayPreferences();
  });
  document.addEventListener("keydown", (event) => {
    if (document.body.dataset.concPage !== "queue") return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (["1", "2", "3", "4"].includes(event.key)) {
      const button = qa("[data-queue-choice]")[Number(event.key) - 1];
      if (button) { event.preventDefault(); button.click(); }
    } else if (event.key === "Enter" && !q("#queueSaveNextBtn")?.disabled) {
      event.preventDefault(); q("#queueSaveNextBtn")?.click();
    } else if (event.key === "Escape") {
      event.preventDefault(); goPage("assistant");
    }
  });
  loadDisplayPreferences();
  applyDisplayPreferences();
  renderPageGuide(state.page);
  updateReady();
})();
