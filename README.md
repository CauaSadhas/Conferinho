# Conferinho — Comparador Inteligente de Relatórios

Esta versão simplifica a entrada para apenas dois lados:

- **Relatório 1**
- **Relatório 2**

Cada campo aceita um ou vários PDFs. Não é necessário escolher se o arquivo veio da SEFAZ, de um sistema contábil, do cliente ou de outra fonte.

## Como a leitura funciona

O Conferinho tenta automaticamente:

1. extrair o texto e a posição das informações no PDF;
2. reconhecer linhas de tabela, datas, valores, documentos, CNPJ/CPF e descrições;
3. comparar registros mesmo quando as colunas aparecem em outra ordem;
4. usar semelhança de texto quando os nomes estão abreviados;
5. comparar linhas de texto quando não existe uma tabela tradicional;
6. usar OCR como alternativa para PDFs escaneados ou formados por imagens.

## Proteção contra resultado falso

Se um dos lados não produzir nenhum conteúdo comparável, o sistema interrompe a comparação. Ele não marca todo o outro relatório como ausente.

## Observação importante

A leitura é automática e cobre muitos layouts, mas nenhum comparador executado somente no navegador consegue garantir precisão total em literalmente todos os PDFs existentes. Arquivos protegidos, imagens de baixa qualidade, tabelas extremamente fragmentadas ou documentos manuscritos podem exigir ajuste ou processamento em servidor com inteligência artificial.

## Arquivos

- `index.html`: estrutura da interface;
- `styles.css`: identidade visual do Conferinho;
- `app.js`: upload, PDF.js, OCR, interpretação automática, comparação, filtros e CSV;
- `assets/`: marca e mascote;
- `vercel.json`: configuração de publicação.

## Abrir e publicar

Abra `index.html` para visualizar. Para publicar no Vercel, envie a pasta completa mantendo todos os arquivos e a pasta `assets` juntos.

O PDF.js e o Tesseract.js são carregados por CDN, portanto a leitura precisa de internet nesta versão da demo.
