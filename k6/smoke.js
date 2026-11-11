// Smoke: 1 usuario, 1 passada por fonte. Confirma que tudo responde antes da carga.
import { coingecko, binance, mempool } from './cenarios.js';
import { resumo } from './resumo.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<2000'],
    checks_negocio: ['rate==1'],
  },
};

export default function () {
  coingecko();
  binance();
  mempool();
}

export const handleSummary = resumo('smoke');
