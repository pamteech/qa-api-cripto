// Gera as capturas do relatorio para o README (docs/).
// Uso: node scripts/screenshot.mjs [url-base]
// Sem argumento, usa os arquivos locais em reports/.
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const base = process.argv[2] || 'file://' + resolve('reports') + '/';
const alvos = [
  ['index.html', 'docs/painel.png', 1280, 1100],
  ['newman/index.html', 'docs/newman.png', 1280, 900],
  ['k6/carga.html', 'docs/k6-carga.png', 1280, 1000],
];

const browser = await chromium.launch();
for (const [caminho, saida, w, h] of alvos) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 });
  await page.goto(base + caminho, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: saida, fullPage: false });
  console.log('Captura salva em', saida);
  await page.close();
}
await browser.close();
