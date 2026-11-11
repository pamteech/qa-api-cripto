// Gera a colecao Postman v2.1 a partir de definicoes legiveis.
// Uso: node scripts/build-collection.mjs
import { writeFileSync } from 'node:fs';

const js = (fn) => fn.toString().split('\n').slice(1, -1).map((l) => l.replace(/^ {4}/, ''));

// Script de colecao: roda antes dos testes de cada requisicao.
// Trata limite de taxa (HTTP 429) com nova tentativa e espera exponencial.
const collectionTest = js(function () {
    const nome = pm.info.requestName;
    const chave = 'tentativas_' + nome;
    if (pm.response.code === 429) {
      const n = Number(pm.collectionVariables.get(chave) || 0);
      const retryAfter = Number(pm.response.headers.get('Retry-After')) || 0;
      if (n < 3) {
        const espera = Math.min(retryAfter > 0 ? retryAfter * 1000 : 3000 * Math.pow(2, n), 30000);
        pm.collectionVariables.set(chave, n + 1);
        pm.test('[LIMITE] 429 em "' + nome + '": nova tentativa ' + (n + 1) + ' de 3 após ' + espera + ' ms', function () {});
        postman.setNextRequest(nome);
        setTimeout(function () {}, espera);
      } else {
        pm.collectionVariables.unset(chave);
        pm.test('[LIMITE] 429 persistente em "' + nome + '": limite da API pública, não e defeito do produto', function () {});
      }
    } else {
      pm.collectionVariables.unset(chave);
      pm.test('Tempo de resposta abaixo de ' + pm.environment.get('limite_ms') + ' ms', function () {
        pm.expect(pm.response.responseTime).to.be.below(Number(pm.environment.get('limite_ms') || 3000));
      });
    }
});

const wrap = (lines) => ['if (pm.response.code !== 429) {', ...lines.map((l) => '  ' + l), '}'];

function req(name, url, testFn, description) {
  const raw = url;
  const [base, query] = raw.split('?');
  const m = base.match(/^\{\{(\w+)\}\}(.*)$/);
  return {
    name,
    request: {
      method: 'GET',
      header: [{ key: 'Accept', value: 'application/json' }],
      url: {
        raw,
        host: ['{{' + m[1] + '}}'],
        path: m[2].split('/').filter(Boolean),
        ...(query ? { query: query.split('&').map((kv) => { const [key, value = ''] = kv.split('='); return { key, value }; }) } : {}),
      },
      description,
    },
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: wrap(js(testFn)) } }],
  };
}

const coingecko = {
  name: 'CoinGecko',
  description: 'API pública de preços agregados. Sem chave, com limite baixo de chamadas por minuto.',
  item: [
    req('CG - ping', '{{coingecko_url}}/ping', function () {
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Responde o campo gecko_says', () => pm.expect(pm.response.json().gecko_says).to.be.a('string').and.not.empty);
    }, 'Disponibilidade basica do servico.'),

    req('CG - preço simples BTC e ETH em USD e BRL', '{{coingecko_url}}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,brl&include_last_updated_at=true&include_24hr_change=true', function () {
      const body = pm.response.json();
      const moeda = { type: 'object', required: ['usd', 'brl', 'last_updated_at'], properties: { usd: { type: 'number', exclusiveMinimum: 0 }, brl: { type: 'number', exclusiveMinimum: 0 }, last_updated_at: { type: 'integer' }, usd_24h_change: { type: 'number' }, brl_24h_change: { type: 'number' } } };
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['bitcoin', 'ethereum'], properties: { bitcoin: moeda, ethereum: moeda } }));
      pm.test('Preços maiores que zero', () => { ['bitcoin', 'ethereum'].forEach((c) => { pm.expect(body[c].usd).to.be.above(0); pm.expect(body[c].brl).to.be.above(0); }); });
      pm.test('BTC vale mais que ETH nas duas moedas', () => { pm.expect(body.bitcoin.usd).to.be.above(body.ethereum.usd); pm.expect(body.bitcoin.brl).to.be.above(body.ethereum.brl); });
      pm.test('Câmbio implicito BRL/USD coerente entre moedas (entre 3 e 10, mesmo valor para BTC e ETH)', () => {
        const rBtc = body.bitcoin.brl / body.bitcoin.usd; const rEth = body.ethereum.brl / body.ethereum.usd;
        pm.expect(rBtc).to.be.within(3, 10); pm.expect(Math.abs(rBtc - rEth) / rBtc).to.be.below(0.02);
      });
      pm.test('Cotação atualizada nos últimos ' + pm.environment.get('frescor_s') + ' s', () => {
        const agora = Math.floor(Date.now() / 1000);
        pm.expect(agora - body.bitcoin.last_updated_at).to.be.below(Number(pm.environment.get('frescor_s')));
      });
      pm.test('Variação de 24h dentro de faixa plausível (-50% a +50%)', () => pm.expect(body.bitcoin.usd_24h_change).to.be.within(-50, 50));
      pm.collectionVariables.set('cg_btc_usd', body.bitcoin.usd);
    }, 'Oráculos: contrato, valores positivos, ordem relativa, câmbio implícito coerente e frescor do dado.'),

    req('CG - mercados BTC e ETH', '{{coingecko_url}}/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&order=market_cap_desc', function () {
      const body = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'array', minItems: 2, maxItems: 2, items: { type: 'object', required: ['id', 'symbol', 'current_price', 'market_cap', 'market_cap_rank', 'high_24h', 'low_24h', 'last_updated'], properties: { id: { type: 'string' }, symbol: { type: 'string' }, current_price: { type: 'number', exclusiveMinimum: 0 }, market_cap: { type: 'number', exclusiveMinimum: 0 }, market_cap_rank: { type: 'integer', minimum: 1 }, high_24h: { type: 'number' }, low_24h: { type: 'number' }, last_updated: { type: 'string' } } } }));
      pm.test('Bitcoin é o primeiro em valor de mercado', () => { pm.expect(body[0].id).to.eql('bitcoin'); pm.expect(body[0].market_cap_rank).to.eql(1); });
      pm.test('Máxima de 24h maior ou igual a mínima', () => body.forEach((c) => pm.expect(c.high_24h).to.be.at.least(c.low_24h)));
      pm.test('Preço atual dentro da faixa de 24h (tolerância de 1%)', () => body.forEach((c) => pm.expect(c.current_price).to.be.within(c.low_24h * 0.99, c.high_24h * 1.01)));
      pm.test('Valor de mercado coerente com preço x oferta circulante (tolerância de 2%)', () => body.forEach((c) => {
        if (c.circulating_supply) pm.expect(Math.abs(c.market_cap - c.current_price * c.circulating_supply) / c.market_cap).to.be.below(0.02);
      }));
      pm.test('last_updated em ISO 8601 e recente', () => body.forEach((c) => {
        const t = Date.parse(c.last_updated); pm.expect(t).to.not.be.NaN;
        pm.expect(Date.now() - t).to.be.below(Number(pm.environment.get('frescor_s')) * 1000);
      }));
    }, 'Coerencia interna de dados de mercado.'),

    req('CG - moedas de cotação suportadas', '{{coingecko_url}}/simple/supported_vs_currencies', function () {
      const body = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Lista de strings em minúsculas', () => { pm.expect(body).to.be.an('array').that.is.not.empty; body.forEach((c) => pm.expect(c).to.match(/^[a-z0-9]+$/)); });
      pm.test('Inclui usd, brl e btc', () => pm.expect(body).to.include.members(['usd', 'brl', 'btc']));
    }, 'Garante que as moedas usadas pelos outros testes continuam suportadas.'),

    req('CG - negativo: moeda inexistente', '{{coingecko_url}}/simple/price?ids=moeda-que-nao-existe-qa&vs_currencies=usd', function () {
      const body = pm.response.json();
      pm.test('Status 200 (comportamento documentado da API para id desconhecido)', () => pm.response.to.have.status(200));
      pm.test('Não inventa preço: objeto vazio', () => pm.expect(body).to.eql({}));
    }, 'A API não retorna 404 aqui. O oráculo é não fabricar um preço.'),

    req('CG - negativo: moeda de cotação inválida', '{{coingecko_url}}/simple/price?ids=bitcoin&vs_currencies=xyz', function () {
      const body = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Retorna bitcoin sem nenhum preço', () => { pm.expect(body).to.have.property('bitcoin'); pm.expect(body.bitcoin).to.eql({}); });
    }, 'Parametro de cotação inválido não pode gerar valor.'),

    req('CG - negativo: detalhe de moeda inexistente', '{{coingecko_url}}/coins/moeda-que-nao-existe-qa', function () {
      pm.test('Status 404', () => pm.response.to.have.status(404));
      pm.test('Mensagem de erro clara', () => pm.expect(pm.response.json().error).to.match(/not found/i));
    }, 'Recurso inexistente deve responder 404.'),
  ],
};

const binance = {
  name: 'Binance (dados de mercado)',
  description: 'Endpoint público data-api.binance.vision, sem chave. O dominio api.binance.com bloqueia IPs dos EUA (HTTP 451), como os do GitHub Actions.',
  item: [
    req('BN - ping', '{{binance_url}}/api/v3/ping', function () {
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Corpo vazio {}', () => pm.expect(pm.response.json()).to.eql({}));
    }, 'Disponibilidade.'),

    req('BN - horário do servidor', '{{binance_url}}/api/v3/time', function () {
      const body = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['serverTime'], properties: { serverTime: { type: 'integer' } } }));
      pm.test('Relógio do servidor a menos de 60 s do relógio local', () => pm.expect(Math.abs(Date.now() - body.serverTime)).to.be.below(60000));
    }, 'Relógio dessincronizado quebra assinaturas e janelas de tempo.'),

    req('BN - preço BTCUSDT', '{{binance_url}}/api/v3/ticker/price?symbol=BTCUSDT', function () {
      const body = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['symbol', 'price'], properties: { symbol: { const: 'BTCUSDT' }, price: { type: 'string', pattern: '^[0-9]+\\.[0-9]{8}$' } } }));
      pm.test('Preço maior que zero', () => pm.expect(parseFloat(body.price)).to.be.above(0));
      pm.collectionVariables.set('bn_btc_usdt', parseFloat(body.price));
    }, 'Preço vem como string decimal com 8 casas, para não perder precisao.'),

    req('BN - estatisticas 24h BTCUSDT', '{{binance_url}}/api/v3/ticker/24hr?symbol=BTCUSDT', function () {
      const b = pm.response.json(); const n = (k) => parseFloat(b[k]);
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['symbol', 'lastPrice', 'openPrice', 'highPrice', 'lowPrice', 'bidPrice', 'askPrice', 'priceChange', 'volume', 'openTime', 'closeTime', 'count'], properties: { symbol: { const: 'BTCUSDT' }, openTime: { type: 'integer' }, closeTime: { type: 'integer' }, count: { type: 'integer', minimum: 1 } } }));
      pm.test('Mínima <= último preço <= máxima', () => { pm.expect(n('lastPrice')).to.be.at.least(n('lowPrice')); pm.expect(n('lastPrice')).to.be.at.most(n('highPrice')); });
      pm.test('Melhor compra menor que melhor venda (spread positivo)', () => pm.expect(n('bidPrice')).to.be.below(n('askPrice')));
      pm.test('priceChange = lastPrice - openPrice', () => pm.expect(n('priceChange')).to.be.closeTo(n('lastPrice') - n('openPrice'), 0.01));
      pm.test('Janela de 24h coerente e fechando agora', () => { pm.expect(b.closeTime - b.openTime).to.be.within(86390000, 86410000); pm.expect(Math.abs(Date.now() - b.closeTime)).to.be.below(120000); });
    }, 'Invariantes aritmeticos e temporais do ticker.'),

    req('BN - livro de ofertas BTCUSDT', '{{binance_url}}/api/v3/depth?symbol=BTCUSDT&limit=5', function () {
      const b = pm.response.json();
      const nivel = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', pattern: '^[0-9]+\\.[0-9]+$' } };
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido com 5 niveis', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['lastUpdateId', 'bids', 'asks'], properties: { lastUpdateId: { type: 'integer' }, bids: { type: 'array', minItems: 5, maxItems: 5, items: nivel }, asks: { type: 'array', minItems: 5, maxItems: 5, items: nivel } } }));
      const bids = b.bids.map((x) => parseFloat(x[0])); const asks = b.asks.map((x) => parseFloat(x[0]));
      pm.test('Compras em ordem decrescente', () => bids.slice(1).forEach((p, i) => pm.expect(p).to.be.below(bids[i])));
      pm.test('Vendas em ordem crescente', () => asks.slice(1).forEach((p, i) => pm.expect(p).to.be.above(asks[i])));
      pm.test('Livro não cruzado: melhor compra < melhor venda', () => pm.expect(bids[0]).to.be.below(asks[0]));
      pm.test('Quantidades maiores que zero', () => b.bids.concat(b.asks).forEach((x) => pm.expect(parseFloat(x[1])).to.be.above(0)));
    }, 'Livro cruzado ou fora de ordem indica dado corrompido.'),

    req('BN - candles de 1h BTCUSDT', '{{binance_url}}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3', function () {
      const k = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Retorna exatamente 3 candles de 12 campos', () => { pm.expect(k).to.have.lengthOf(3); k.forEach((c) => pm.expect(c).to.have.lengthOf(12)); });
      pm.test('Máxima e mínima envolvem abertura e fechamento', () => k.forEach((c) => {
        const [o, h, l, cl] = [c[1], c[2], c[3], c[4]].map(parseFloat);
        pm.expect(h).to.be.at.least(Math.max(o, cl)); pm.expect(l).to.be.at.most(Math.min(o, cl));
      }));
      pm.test('Candles consecutivos com intervalo de 1h', () => k.slice(1).forEach((c, i) => pm.expect(c[0] - k[i][0]).to.eql(3600000)));
      pm.test('Último candle é o da hora atual', () => pm.expect(Date.now() - k[2][0]).to.be.within(0, 3600000 + 60000));
    }, 'Invariantes OHLC.'),

    req('BN - negativo: par inexistente', '{{binance_url}}/api/v3/ticker/price?symbol=QAQAQAUSDT', function () {
      pm.test('Status 400', () => pm.response.to.have.status(400));
      pm.test('Código de erro -1121 (símbolo inválido)', () => pm.expect(pm.response.json().code).to.eql(-1121));
    }, 'Erro de negocio com código estavel.'),

    req('BN - negativo: intervalo inválido', '{{binance_url}}/api/v3/klines?symbol=BTCUSDT&interval=7x', function () {
      pm.test('Status 400', () => pm.response.to.have.status(400));
      pm.test('Código de erro -1120 (intervalo inválido)', () => pm.expect(pm.response.json().code).to.eql(-1120));
    }, 'Validacao de parâmetro.'),

    req('BN - negativo: parâmetro obrigatório ausente', '{{binance_url}}/api/v3/klines?symbol=BTCUSDT', function () {
      pm.test('Status 400', () => pm.response.to.have.status(400));
      pm.test('Código de erro -1102 (parâmetro obrigatório)', () => pm.expect(pm.response.json().code).to.eql(-1102));
    }, 'interval é obrigatório em klines.'),
  ],
};

const mempool = {
  name: 'mempool.space (rede Bitcoin)',
  description: 'Explorador público da rede Bitcoin: blocos, taxas e preço de referência.',
  item: [
    req('MP - altura do último bloco', '{{mempool_url}}/blocks/tip/height', function () {
      const h = Number(pm.response.text());
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Altura e inteiro acima de 900000', () => { pm.expect(Number.isInteger(h)).to.be.true; pm.expect(h).to.be.above(900000); });
      pm.collectionVariables.set('mp_tip', h);
    }, 'Resposta em texto puro.'),

    req('MP - últimos blocos', '{{mempool_url}}/v1/blocks', function () {
      const b = pm.response.json(); const tip = Number(pm.collectionVariables.get('mp_tip'));
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'array', minItems: 1, items: { type: 'object', required: ['id', 'height', 'timestamp', 'tx_count', 'size'], properties: { id: { type: 'string', pattern: '^0{8}[0-9a-f]{56}$' }, height: { type: 'integer' }, timestamp: { type: 'integer' }, tx_count: { type: 'integer', minimum: 1 } } } }));
      pm.test('Alturas consecutivas e decrescentes', () => b.slice(1).forEach((x, i) => pm.expect(x.height).to.eql(b[i].height - 1)));
      pm.test('Primeiro bloco coincide com a altura informada (tolerância de 1 bloco)', () => { if (tip) pm.expect(Math.abs(b[0].height - tip)).to.be.at.most(1); });
      pm.test('Último bloco minerado há menos de 3 h', () => pm.expect(Date.now() / 1000 - b[0].timestamp).to.be.below(3 * 3600));
    }, 'Hash com zeros a esquerda reflete a prova de trabalho.'),

    req('MP - taxas recomendadas', '{{mempool_url}}/v1/fees/recommended', function () {
      const f = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee'], properties: { fastestFee: { type: 'number', minimum: 0 }, halfHourFee: { type: 'number', minimum: 0 }, hourFee: { type: 'number', minimum: 0 }, economyFee: { type: 'number', minimum: 0 }, minimumFee: { type: 'number', minimum: 0 } } }));
      pm.test('Ordem: rápida >= 30 min >= 1 h >= econômica >= mínima', () => {
        pm.expect(f.fastestFee).to.be.at.least(f.halfHourFee); pm.expect(f.halfHourFee).to.be.at.least(f.hourFee);
        pm.expect(f.hourFee).to.be.at.least(f.economyFee); pm.expect(f.economyFee).to.be.at.least(f.minimumFee);
      });
    }, 'Taxa mais rápida nunca pode ser menor que a mais lenta.'),

    req('MP - preço de referência', '{{mempool_url}}/v1/prices', function () {
      const p = pm.response.json();
      pm.test('Status 200', () => pm.response.to.have.status(200));
      pm.test('Contrato (JSON Schema) válido', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['time', 'USD', 'EUR'], properties: { time: { type: 'integer' }, USD: { type: 'number', exclusiveMinimum: 0 }, EUR: { type: 'number', exclusiveMinimum: 0 } } }));
      pm.test('Preço atualizado nos últimos ' + pm.environment.get('frescor_s') + ' s', () => pm.expect(Date.now() / 1000 - p.time).to.be.below(Number(pm.environment.get('frescor_s'))));
      pm.collectionVariables.set('mp_btc_usd', p.USD);
    }, 'Terceira fonte para o teste de consistência.'),

    req('MP - negativo: endereco inválido', '{{mempool_url}}/address/endereco-invalido', function () {
      pm.test('Status 400', () => pm.response.to.have.status(400));
      pm.test('Mensagem de endereco inválido', () => pm.expect(pm.response.text()).to.match(/invalid bitcoin address/i));
    }, 'Validacao de entrada.'),
  ],
};

const consistencia = {
  name: 'Consistência entre fontes',
  description: 'Oráculo cruzado: três fontes independentes devem concordar no preço do BTC.',
  item: [
    req('XC - preço medio Binance e comparacao entre fontes', '{{binance_url}}/api/v3/avgPrice?symbol=BTCUSDT', function () {
      const avg = parseFloat(pm.response.json().price);
      pm.test('Status 200', () => pm.response.to.have.status(200));
      const fontes = { CoinGecko: Number(pm.collectionVariables.get('cg_btc_usd')), Binance: Number(pm.collectionVariables.get('bn_btc_usdt')), mempool: Number(pm.collectionVariables.get('mp_btc_usd')), 'Binance média 5 min': avg };
      const validas = Object.entries(fontes).filter(([, v]) => v > 0);
      const lim = Number(pm.environment.get('desvio_max_pct'));
      pm.test('Pelo menos 3 fontes com preço disponível', () => pm.expect(validas.length).to.be.at.least(3));
      validas.forEach(([na, va], i) => validas.slice(i + 1).forEach(([nb, vb]) => {
        const d = Math.abs(va - vb) / Math.min(va, vb) * 100;
        pm.test('BTC/USD ' + na + ' x ' + nb + ': desvio abaixo de ' + lim + '%', () => pm.expect(d).to.be.below(lim));
      }));
    }, 'USDT é tratado como USD; o desvio maximo absorve o descolamento normal da stablecoin.'),
  ],
};

const collection = {
  info: {
    name: 'QA API Cripto',
    description: 'Testes de contrato, sanidade de dados e casos negativos para APIs públicas de preço de cripto (CoinGecko, Binance, mempool.space). Gerada por scripts/build-collection.mjs.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: collectionTest } }],
  variable: [
    { key: 'cg_btc_usd', value: '' }, { key: 'bn_btc_usdt', value: '' }, { key: 'mp_btc_usd', value: '' }, { key: 'mp_tip', value: '' },
  ],
  item: [coingecko, binance, mempool, consistencia],
};

writeFileSync('postman/qa-api-cripto.postman_collection.json', JSON.stringify(collection, null, 2) + '\n');

const env = (name, binance) => ({
  name,
  values: [
    { key: 'coingecko_url', value: 'https://api.coingecko.com/api/v3', enabled: true },
    { key: 'binance_url', value: binance, enabled: true },
    { key: 'mempool_url', value: 'https://mempool.space/api', enabled: true },
    { key: 'limite_ms', value: '5000', enabled: true },
    { key: 'frescor_s', value: '900', enabled: true },
    { key: 'desvio_max_pct', value: '2', enabled: true },
  ],
  _postman_variable_scope: 'environment',
});
writeFileSync('postman/publico.postman_environment.json', JSON.stringify(env('Público (CI)', 'https://data-api.binance.vision'), null, 2) + '\n');
writeFileSync('postman/binance-global.postman_environment.json', JSON.stringify(env('Binance global (fora dos EUA)', 'https://api.binance.com'), null, 2) + '\n');
console.log('Colecao e ambientes gerados em postman/');
