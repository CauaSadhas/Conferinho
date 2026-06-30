# Conferinho — demo corrigida

Comparador de relatórios fiscais em PDF com suporte a vários arquivos em cada grupo.

## Correções desta versão

- O leitor do relatório interno deixou de depender de posições fixas das colunas.
- As colunas `Data`, `Nota`, `Fornecedor`, `UF` e `Valor Contábil` são identificadas pelo cabeçalho do próprio PDF.
- Há uma leitura genérica de apoio para relatórios com pequenas mudanças de layout.
- O layout da consulta de NF-e da SEFAZ/MS também ficou mais tolerante.
- Cada arquivo agora exibe um diagnóstico com páginas, método de leitura e quantidade de registros reconhecidos.
- Se um dos grupos resultar em zero registros, a comparação é interrompida. Assim, o sistema não marca todas as notas como ausentes por engano.
- PDFs sem texto selecionável são identificados como possíveis arquivos digitalizados que precisarão de OCR.

## Como abrir

Abra `index.html` em um navegador com internet ou publique a pasta no Vercel. A internet é necessária nesta demo para carregar o PDF.js usado na leitura dos arquivos.

## Teste realizado

A versão foi validada com os dois modelos usados na criação do projeto:

- consulta de NF-e da SEFAZ/MS: 65 registros reconhecidos;
- acompanhamento de entradas do sistema: 3 registros reconhecidos.

## Limitação atual

Relatórios digitalizados como imagem ainda não passam por OCR. Para ajustar um novo layout específico, envie o PDF que não foi reconhecido para que as colunas sejam calibradas com o arquivo real.
