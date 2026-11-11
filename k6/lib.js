// Utilitarios compartilhados pelos scripts k6.
import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

export const BASES = {
  coingecko: __ENV.COINGECKO_URL || 'https://api.coingecko.com/api/v3',
  binance: __ENV.BINANCE_URL || 'https://data-api.binance.vision',
  mempool: __ENV.MEMPOOL_URL || 'https://mempool.space/api',
};

// 429 e limite da API publica, nao defeito: fica fora de http_req_failed
// e e contado em uma metrica propria.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

export const limiteTaxa = new Counter('limite_taxa_429');
export const tentativas = new Counter('novas_tentativas');
export const checksNegocio = new Rate('checks_negocio');

// GET com nova tentativa e espera exponencial em caso de 429 ou 5xx.
export function getComRetry(url, tags = {}, maxTentativas = 3) {
  let res;
  for (let i = 0; i <= maxTentativas; i++) {
    res = http.get(url, { tags, headers: { Accept: 'application/json' } });
    if (res.status !== 429 && res.status < 500) return res;
    if (res.status === 429) limiteTaxa.add(1, tags);
    if (i === maxTentativas) break;
    tentativas.add(1, tags);
    const retryAfter = Number(res.headers['Retry-After']) || 0;
    sleep(Math.min(retryAfter > 0 ? retryAfter : 2 * Math.pow(2, i), 30));
  }
  return res;
}

// Checagens so contam quando a resposta nao foi limitada.
export function verificar(res, nome, regras) {
  if (res.status === 429) return true;
  const ok = check(res, regras, { endpoint: nome });
  checksNegocio.add(ok, { endpoint: nome });
  return ok;
}

export const json = (res) => { try { return res.json(); } catch (e) { return null; } };
