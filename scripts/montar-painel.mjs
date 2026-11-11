// Monta a pagina inicial do relatorio (reports/index.html) a partir dos
// resultados do Newman e do k6. Uso: node scripts/montar-painel.mjs
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';

const ler = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const quando = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

mkdirSync('reports', { recursive: true });
copyFileSync('scripts/estilo.css', 'reports/estilo.css');

const newman = ler('reports/newman/resultado.json');
const smoke = ler('reports/k6/smoke-resumo.json');
const carga = ler('reports/k6/carga-resumo.json');
const repo = process.env.GITHUB_REPOSITORY || 'pamteech/qa-api-cripto';
const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

let n = { req: 0, ok: 0, falha: 0, limite: 0, fontes: [], falhas: [], inicio: null };
if (newman) {
  const ex = newman.run.executions;
  n.req = newman.run.stats.requests.total;
  n.inicio = newman.run.timings.started;
  const porFonte = {};
  for (const e of ex) {
    const fonte = e.item.name.split(' - ')[0];
    const f = (porFonte[fonte] ||= { ok: 0, falha: 0, limite: 0 });
    for (const a of e.assertions || []) {
      if (a.assertion.startsWith('[LIMITE]')) { f.limite++; n.limite++; continue; }
      if (a.error) { f.falha++; n.falha++; n.falhas.push({ req: e.item.name, teste: a.assertion, erro: a.error.message }); } else { f.ok++; n.ok++; }
    }
  }
  const nomes = { CG: 'CoinGecko', BN: 'Binance', MP: 'mempool.space', XC: 'Consistência entre fontes' };
  n.fontes = Object.entries(porFonte).map(([k, v]) => ({ nome: nomes[k] || k, ...v }));
}

const tagStatus = (ok) => (ok ? '<span class="tag ok">Aprovado</span>' : '<span class="tag fail">Reprovado</span>');
const ms = (x) => (x == null ? '-' : `${Math.round(x)} ms`);

const linhaK6 = (r, link) => r ? `<tr><td><a href="${link}">${esc(r.cenario)}</a></td><td class="num">${r.requisicoes}</td><td class="num">${ms(r.p95_ms)}</td><td class="num">${(r.taxa_erro * 100).toFixed(2)}%</td><td class="num">${r.limite_taxa_429}</td><td>${tagStatus(r.aprovado)}</td></tr>` : '';

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA API Cripto - Painel de qualidade</title><meta name="description" content="Testes de contrato, dados e desempenho de APIs públicas de cripto"><link rel="stylesheet" href="estilo.css"></head><body>
<header class="topo"><div class="wrap"><span class="marca">QA API Cripto</span><span class="sub">Painel de qualidade</span></div></header>
<main class="wrap">
<h1>APIs públicas de preço de cripto</h1>
<p class="meta">CoinGecko, Binance e mempool.space. Última execução: ${n.inicio ? esc(quando(n.inicio)) : '-'} (horário de Brasília)${runUrl ? ` · <a href="${runUrl}">execução no GitHub Actions</a>` : ''}</p>
<section class="kpis">
<div class="kpi"><span>Requisições funcionais</span><strong>${n.req}</strong></div>
<div class="kpi"><span>Asserções aprovadas</span><strong>${n.ok}</strong></div>
<div class="kpi"><span>Asserções reprovadas</span><strong>${n.falha}</strong></div>
<div class="kpi"><span>Limite de taxa (429)</span><strong>${n.limite + (smoke?.limite_taxa_429 || 0) + (carga?.limite_taxa_429 || 0)}</strong></div>
<div class="kpi"><span>p95 da carga</span><strong>${ms(carga?.p95_ms)}</strong></div>
</section>
<div class="grade">
<section class="card"><h2>Funcional · Postman e Newman</h2>
<p>Contrato via JSON Schema, sanidade dos dados, frescor da cotação, casos negativos e consistência de preço entre três fontes.</p>
<table><thead><tr><th>Fonte</th><th class="num">Aprovadas</th><th class="num">Reprovadas</th><th class="num">429</th></tr></thead><tbody>
${n.fontes.map((f) => `<tr><td>${esc(f.nome)}</td><td class="num">${f.ok}</td><td class="num">${f.falha}</td><td class="num">${f.limite}</td></tr>`).join('')}
</tbody></table>
<a class="btn" href="newman/index.html">Abrir relatório do Newman</a></section>
<section class="card"><h2>Desempenho · k6</h2>
<p>Smoke com 1 usuário e carga leve de até 3 usuários por 1 minuto, respeitando os limites das APIs públicas.</p>
<table><thead><tr><th>Cenário</th><th class="num">Req.</th><th class="num">p95</th><th class="num">Erro</th><th class="num">429</th><th>Status</th></tr></thead><tbody>
${linhaK6(smoke, 'k6/smoke.html')}${linhaK6(carga, 'k6/carga.html')}
</tbody></table>
<a class="btn" href="k6/carga.html">Abrir relatório do k6</a> <a class="btn sec" href="k6/carga-painel.html">Painel detalhado da carga</a></section>
</div>
${n.falhas.length ? `<section class="card"><h2>Asserções reprovadas</h2><table><thead><tr><th>Requisição</th><th>Teste</th><th>Detalhe</th></tr></thead><tbody>${n.falhas.map((f) => `<tr><td>${esc(f.req)}</td><td>${esc(f.teste)}</td><td><code>${esc(f.erro)}</code></td></tr>`).join('')}</tbody></table></section>` : ''}
<section class="card"><h2>Como ler este painel</h2>
<p class="nota">Respostas HTTP 429 significam que a API pública limitou a taxa de chamadas. Elas não são tratadas como defeito do produto: a suíte tenta de novo com espera exponencial e registra cada ocorrência. Reprovação indica contrato quebrado, dado incoerente ou desempenho fora do critério de aceite.</p></section>
<footer class="rodape">Projeto de portfólio de QA de Pamella Soares · <a href="https://github.com/${repo}">código no GitHub</a></footer>
</main></body></html>`;

writeFileSync('reports/index.html', html);
console.log(`Painel gerado: ${n.ok} aprovadas, ${n.falha} reprovadas, ${n.limite} avisos de 429.`);
