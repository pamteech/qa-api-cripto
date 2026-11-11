// Gera o resumo no terminal, um JSON enxuto e um relatorio HTML por cenario.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ms = (x) => (x == null ? '-' : `${Math.round(x)} ms`);
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(2)}%`);

function html(r, checks) {
  const status = r.aprovado ? '<span class="tag ok">Aprovado</span>' : '<span class="tag fail">Reprovado</span>';
  const thr = Object.entries(r.thresholds).map(([t, ok]) => `<tr><td><code>${esc(t)}</code></td><td>${ok ? '<span class="tag ok">Atendido</span>' : '<span class="tag fail">Violado</span>'}</td></tr>`).join('');
  const chk = checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.passes}</td><td class="num">${c.fails}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>k6 - ${esc(r.cenario)} - QA API Cripto</title><link rel="stylesheet" href="../estilo.css"></head><body>
<header class="topo"><div class="wrap"><a class="marca" href="../index.html">QA API Cripto</a><span class="sub">Desempenho com k6</span></div></header>
<main class="wrap">
<p class="voltar"><a href="../index.html">Voltar ao painel</a></p>
<h1>Cenário ${esc(r.cenario)} ${status}</h1>
<p class="meta">Executado em ${esc(new Date(r.gerado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} (horário de Brasília)</p>
<section class="kpis">
<div class="kpi"><span>Requisições</span><strong>${r.requisicoes}</strong></div>
<div class="kpi"><span>Latência p95</span><strong>${ms(r.p95_ms)}</strong></div>
<div class="kpi"><span>Latência média</span><strong>${ms(r.media_ms)}</strong></div>
<div class="kpi"><span>Taxa de erro</span><strong>${pct(r.taxa_erro)}</strong></div>
<div class="kpi"><span>Respostas 429</span><strong>${r.limite_taxa_429}</strong></div>
<div class="kpi"><span>Novas tentativas</span><strong>${r.novas_tentativas}</strong></div>
</section>
<section class="card"><h2>Critérios de aceite (thresholds)</h2><table><thead><tr><th>Critério</th><th>Resultado</th></tr></thead><tbody>${thr}</tbody></table></section>
<section class="card"><h2>Verificações de negócio</h2><table><thead><tr><th>Verificação</th><th class="num">Passou</th><th class="num">Falhou</th></tr></thead><tbody>${chk}</tbody></table>
<p class="nota">Respostas 429 indicam limite da API pública. Não contam como erro do produto: geram nova tentativa com espera exponencial e ficam registradas acima.</p></section>
</main></body></html>`;
}

export function resumo(nome) {
  return function (data) {
    const m = data.metrics;
    const v = (k, f) => (m[k] && m[k].values ? m[k].values[f] : null);
    const thresholds = {};
    for (const [k, met] of Object.entries(m)) {
      if (met.thresholds) for (const [t, r] of Object.entries(met.thresholds)) thresholds[`${k}: ${t}`] = r.ok;
    }
    const r = {
      cenario: nome,
      gerado_em: new Date().toISOString(),
      requisicoes: v('http_reqs', 'count'),
      p95_ms: v('http_req_duration', 'p(95)'),
      media_ms: v('http_req_duration', 'avg'),
      taxa_erro: v('http_req_failed', 'rate'),
      checks_ok: v('checks', 'passes'),
      checks_falha: v('checks', 'fails'),
      limite_taxa_429: v('limite_taxa_429', 'count') || 0,
      novas_tentativas: v('novas_tentativas', 'count') || 0,
      thresholds,
      aprovado: Object.values(thresholds).every(Boolean),
    };
    const linhas = [
      `\nCenario ${nome}: ${r.aprovado ? 'APROVADO' : 'REPROVADO'}`,
      `  requisições: ${r.requisicoes}  p95: ${Math.round(r.p95_ms)} ms  erro: ${(r.taxa_erro * 100).toFixed(2)}%`,
      `  checks: ${r.checks_ok} ok / ${r.checks_falha} falha  429: ${r.limite_taxa_429}  novas tentativas: ${r.novas_tentativas}`,
      ...Object.entries(thresholds).map(([t, ok]) => `  [${ok ? 'ok' : 'FALHOU'}] ${t}`),
      '',
    ];
    const checks = (data.root_group && data.root_group.checks) || [];
    return {
      stdout: linhas.join('\n'),
      [`reports/k6/${nome}-resumo.json`]: JSON.stringify(r, null, 2),
      [`reports/k6/${nome}.html`]: html(r, checks),
    };
  };
}
