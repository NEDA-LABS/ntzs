#!/bin/sh
set -e

# Validate required secrets are present
: "${SUBSTRATE_PRIVATE_KEY:?SUBSTRATE_PRIVATE_KEY is required}"
: "${SIGNER_PRIVATE_KEY:?SIGNER_PRIVATE_KEY is required}"
: "${BASE_RPC_URL:?BASE_RPC_URL is required}"
: "${BUNDLER_URL:?BUNDLER_URL is required}"
: "${NTZS_API_BASE_URL:?NTZS_API_BASE_URL is required}"
: "${INTERNAL_API_SECRET:?INTERNAL_API_SECRET is required}"

# Generate config.toml at runtime by fetching live spread settings from the
# SimpleFX portal (midRateTZS, bidBps, askBps) and computing price curves.
# Falls back to safe defaults if the portal is unreachable.
node --input-type=commonjs -e "
const https = require('https');
const http  = require('http');
const fs    = require('fs');

const apiBase = process.env.NTZS_API_BASE_URL;
const secret  = process.env.INTERNAL_API_SECRET;

function fetchConfig() {
  return new Promise((resolve) => {
    const lib = apiBase.startsWith('https') ? https : http;
    const req = lib.request(
      apiBase + '/api/internal/bot-config',
      { headers: { Authorization: 'Bearer ' + secret } },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function buildCurves(mid, bidBps, askBps) {
  const bidBase = Math.round(mid * (1 + bidBps / 10000));
  const askBase = Math.round(mid * (1 - askBps / 10000));
  const scale = mid / 2590;
  const d = [
    Math.max(1, Math.round(5 * scale)),
    Math.max(1, Math.round(3 * scale)),
    Math.max(1, Math.round(4 * scale)),
    Math.max(1, Math.round(4 * scale)),
  ];
  const amounts = ['50', '200', '500', '1000', '2000'];
  const bidPrices = [bidBase, bidBase-d[0], bidBase-d[0]-d[1], bidBase-d[0]-d[1]-d[2], bidBase-d[0]-d[1]-d[2]-d[3]];
  const askPrices = [askBase, askBase-d[0], askBase-d[0]-d[1], askBase-d[0]-d[1]-d[2], askBase-d[0]-d[1]-d[2]-d[3]];
  const fmt = (prices) =>
    amounts.map((a, i) => '  { amount = \"' + a + '\", price = \"' + prices[i] + '\" }').join(',\n');
  return { bidCurve: fmt(bidPrices), askCurve: fmt(askPrices) };
}

function buildStrategyBlock(pair, bidBps, askBps) {
  const { bidCurve, askCurve } = buildCurves(pair.midRate, bidBps, askBps);
  return [
    '[[strategies]]',
    'type = \"hyperfx\"',
    'maxOrderUsd = 2000',
    '',
    '# bid: ' + pair.token1Symbol + ' per ' + pair.token2Symbol + ' when user SELLS ' + pair.token1Symbol,
    'bidPriceCurve = [',
    bidCurve,
    ']',
    '',
    '# ask: ' + pair.token1Symbol + ' per ' + pair.token2Symbol + ' when user BUYS ' + pair.token1Symbol,
    'askPriceCurve = [',
    askCurve,
    ']',
    '',
    '[strategies.token1]',
    '\"EVM-8453\" = \"' + pair.token1Address + '\"',
    '',
    '[strategies.token2]',
    '\"EVM-8453\" = \"' + pair.token2Address + '\"',
  ].join('\n');
}

async function main() {
  const cfg = await fetchConfig();

  const bidBps = (cfg && cfg.bidBps) || 120;
  const askBps = (cfg && cfg.askBps) || 150;

  // Default to nTZS/USDC if portal is unreachable
  const pairs = (cfg && cfg.pairs && cfg.pairs.length > 0)
    ? cfg.pairs
    : [{
        token1Address: '0xF476BA983DE2F1AD532380630e2CF1D1b8b10688',
        token1Symbol: 'nTZS',
        token2Address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        token2Symbol: 'USDC',
        midRate: 3750,
      }];

  if (!cfg) {
    console.error('WARNING: Could not reach portal — using default nTZS/USDC pair (midRate=3750)');
  } else {
    console.log('Bot config fetched: ' + pairs.length + ' pair(s), bidBps=' + bidBps + ', askBps=' + askBps);
    pairs.forEach((p) => console.log('  ' + p.token1Symbol + '/' + p.token2Symbol + ' midRate=' + p.midRate));
  }

  const strategiesBlock = pairs.map((p) => buildStrategyBlock(p, bidBps, askBps)).join('\n\n');

  let toml = fs.readFileSync('/simplex.toml.template', 'utf8');
  toml = toml
    .replace('__SUBSTRATE_PRIVATE_KEY__', process.env.SUBSTRATE_PRIVATE_KEY)
    .replace('__SIGNER_PRIVATE_KEY__',    process.env.SIGNER_PRIVATE_KEY)
    .replace('__BASE_RPC_URL__',          process.env.BASE_RPC_URL)
    .replace('__BUNDLER_URL__',           process.env.BUNDLER_URL)
    .replace('__STRATEGIES__',            strategiesBlock);

  fs.writeFileSync('/tmp/config.toml', toml);
  console.log('Config written to /tmp/config.toml');
}

main().catch((e) => { console.error('Config generation failed:', e.message); process.exit(1); });
"

exec node /app/packages/simplex/dist/bin/simplex.js run --config /tmp/config.toml
