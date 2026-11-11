// Chamadas de cada fonte, reaproveitadas no smoke e na carga.
import { BASES, getComRetry, verificar, json } from './lib.js';

export function coingecko() {
  const res = getComRetry(`${BASES.coingecko}/simple/price?ids=bitcoin&vs_currencies=usd,brl&include_last_updated_at=true`, { endpoint: 'cg_simple_price' });
  verificar(res, 'cg_simple_price', {
    'CG status 200': (r) => r.status === 200,
    'CG preço BTC em USD > 0': (r) => (json(r)?.bitcoin?.usd || 0) > 0,
    'CG preço BTC em BRL > 0': (r) => (json(r)?.bitcoin?.brl || 0) > 0,
    'CG cotação com menos de 15 min': (r) => Date.now() / 1000 - (json(r)?.bitcoin?.last_updated_at || 0) < 900,
  });
}

export function binance() {
  const p = getComRetry(`${BASES.binance}/api/v3/ticker/price?symbol=BTCUSDT`, { endpoint: 'bn_ticker_price' });
  verificar(p, 'bn_ticker_price', {
    'BN status 200': (r) => r.status === 200,
    'BN preço BTCUSDT > 0': (r) => parseFloat(json(r)?.price || '0') > 0,
  });
  const d = getComRetry(`${BASES.binance}/api/v3/depth?symbol=BTCUSDT&limit=5`, { endpoint: 'bn_depth' });
  verificar(d, 'bn_depth', {
    'BN livro status 200': (r) => r.status === 200,
    'BN livro não cruzado': (r) => { const b = json(r); return !!b && parseFloat(b.bids[0][0]) < parseFloat(b.asks[0][0]); },
  });
}

export function mempool() {
  const f = getComRetry(`${BASES.mempool}/v1/fees/recommended`, { endpoint: 'mp_fees' });
  verificar(f, 'mp_fees', {
    'MP status 200': (r) => r.status === 200,
    'MP taxas em ordem': (r) => { const x = json(r); return !!x && x.fastestFee >= x.halfHourFee && x.halfHourFee >= x.hourFee && x.hourFee >= x.minimumFee; },
  });
  const h = getComRetry(`${BASES.mempool}/blocks/tip/height`, { endpoint: 'mp_tip' });
  verificar(h, 'mp_tip', {
    'MP altura status 200': (r) => r.status === 200,
    'MP altura > 900000': (r) => Number(r.body) > 900000,
  });
}
