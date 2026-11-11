// Carga leve e educada: no maximo 3 usuarios virtuais, 1 minuto.
// CoinGecko publico tem limite baixo, entao recebe taxa fixa de 1 chamada a cada 10 s.
import { sleep } from 'k6';
import { coingecko, binance, mempool } from './cenarios.js';
import { resumo } from './resumo.js';

export const options = {
  scenarios: {
    binance_mempool: {
      executor: 'ramping-vus',
      exec: 'binanceMempool',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 3 },
        { duration: '30s', target: 3 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
    coingecko: {
      executor: 'constant-arrival-rate',
      exec: 'coingeckoLento',
      rate: 1,
      timeUnit: '10s',
      duration: '1m',
      preAllocatedVUs: 1,
      maxVUs: 2,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    'http_req_duration{endpoint:bn_ticker_price}': ['p(95)<1000'],
    'http_req_duration{endpoint:mp_fees}': ['p(95)<1000'],
    checks_negocio: ['rate>0.98'],
  },
};

export function binanceMempool() {
  binance();
  mempool();
  sleep(2 + Math.random());
}

export function coingeckoLento() {
  coingecko();
}

export const handleSummary = resumo('carga');
