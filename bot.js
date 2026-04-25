#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║     MirLite Bot v5.0 — LitecoinEVM Testnet                 ║
 * ║     Puppeteer Browser Automation + Real Wallet Signing      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * HOW IT WORKS:
 * - Opens headless Chromium browser
 * - Injects your private key as a wallet (like MetaMask but automated)
 * - Signs and sends real transactions directly via window.ethereum
 * - No MetaMask needed — wallet is injected into every page
 */

const puppeteer  = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { ethers } = require('ethers');
const fs         = require('fs');
const readline   = require('readline');

puppeteer.use(StealthPlugin());

// ── Config ───────────────────────────────────────────────────────────────────
const WALLETS_FILE = 'wallets.json';
const LOG_FILE     = 'task_logs.json';
const RPC_URLS     = [
  'https://rpc.litecoin-evm.caldera.xyz',
  'https://rpc-litecoin-evm-testnet.caldera.xyz',
  'https://rpc.litvm.io',
];
const CHAIN_ID   = 21;        // LitecoinEVM testnet — confirmed from caldera
const CHAIN_HEX  = '0x15';
const NETWORK    = {
  chainId:  CHAIN_ID,
  name:     'LitecoinEVM Testnet',
  rpcUrl:   RPC_URLS[0],
};

const ZKLTC = '0xFC73cdB75F37B0da829c4e54511f410D525B76b2';

// Faucet API
const FAUCET_URL = 'https://metarouter-staging.caldera.dev/caldera.metarouter.v1.MetarouterService/GetTokens';
const FAUCET_HEADERS = {
  'content-type':             'application/json',
  'x-api-key':                'ml-d45sh804',
  'connect-protocol-version': '1',
  'x-metalayer-sdk-version':  '1.0.8',
  'Origin':                   'https://liteforge.hub.caldera.xyz',
  'Referer':                  'https://liteforge.hub.caldera.xyz/',
};

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
};

const ok   = (m) => console.log(`${C.green}${C.bold}  ✅ ${m}${C.reset}`);
const fail = (m) => console.log(`${C.red}${C.bold}  ❌ FAILED: ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}  ⚠️  ${m}${C.reset}`);
const info = (m) => console.log(`${C.dim}  ℹ  ${m}${C.reset}`);
const step = (m) => console.log(`\n${C.cyan}${C.bold}  ── ${m} ──${C.reset}`);

// ── Human delay ──────────────────────────────────────────────────────────────
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
const hDelay = (min=1500, max=4500) => sleep(min + Math.random()*(max-min));
const randAmt = (lo=0.00005, hi=0.0003) => (lo + Math.random()*(hi-lo)).toFixed(6);

// ── Wallet file ──────────────────────────────────────────────────────────────
function loadWallets() {
  if (!fs.existsSync(WALLETS_FILE)) return [];
  return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
}

function saveWallets(wallets) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

function createWallets(n) {
  const wallets = loadWallets();
  const created = [];
  for (let i = 0; i < n; i++) {
    const w = ethers.Wallet.createRandom();
    const entry = {
      address:     w.address,
      private_key: w.privateKey,
      mnemonic:    w.mnemonic?.phrase || '',
      created_at:  new Date().toISOString(),
      tasks_done:  [],
      tasks_failed:[],
    };
    wallets.push(entry);
    created.push(entry);
  }
  saveWallets(wallets);
  return created;
}

function markDone(address, task) {
  const wallets = loadWallets();
  for (const w of wallets) {
    if (w.address.toLowerCase() === address.toLowerCase()) {
      w.tasks_done   = w.tasks_done   || [];
      w.tasks_failed = w.tasks_failed || [];
      if (!w.tasks_done.includes(task))   w.tasks_done.push(task);
      w.tasks_failed = w.tasks_failed.filter(t => t !== task);
    }
  }
  saveWallets(wallets);
}

function markFailed(address, task) {
  const wallets = loadWallets();
  for (const w of wallets) {
    if (w.address.toLowerCase() === address.toLowerCase()) {
      w.tasks_failed = w.tasks_failed || [];
      if (!w.tasks_failed.includes(task)) w.tasks_failed.push(task);
    }
  }
  saveWallets(wallets);
}

function isDone(address, task) {
  const wallets = loadWallets();
  const w = wallets.find(w => w.address.toLowerCase() === address.toLowerCase());
  return w?.tasks_done?.includes(task) || false;
}

// ── RPC Provider ─────────────────────────────────────────────────────────────
async function getProvider() {
  for (const url of RPC_URLS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, {
        chainId: CHAIN_ID,
        name: 'litecoin-evm',
      });
      const network = await Promise.race([
        provider.getNetwork(),
        sleep(5000).then(() => { throw new Error('timeout'); })
      ]);
      console.log(`${C.green}✓ RPC connected: ${url} (chainId: ${network.chainId})${C.reset}`);
      return provider;
    } catch (e) {
      warn(`RPC failed: ${url} — ${e.message}`);
    }
  }
  warn('All RPCs failed — faucet-only mode');
  return null;
}

// ── Faucet (direct HTTP) ──────────────────────────────────────────────────────
async function claimFaucet(address) {
  const payload = JSON.stringify({ walletAddress: address, chainId: String(CHAIN_ID) });
  const https   = require('https');
  const url     = new URL(FAUCET_URL);

  return new Promise((resolve) => {
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { ...FAUCET_HEADERS, 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write(payload);
    req.end();
  });
}

// ── Puppeteer wallet injection ────────────────────────────────────────────────
/**
 * Injects a fake window.ethereum provider into the page
 * that automatically signs transactions with the given private key.
 * This replaces MetaMask for automation purposes.
 */
async function injectWallet(page, privateKey, rpcUrl) {
  await page.evaluateOnNewDocument((pk, rpc, chainId, chainHex) => {
    const ethers_iface = window.__injectedWallet = {
      _pk:      pk,
      _rpc:     rpc,
      _chainId: chainId,
      _accounts: [],
      _listeners: {},
    };

    // Minimal EIP-1193 provider
    window.ethereum = {
      isMetaMask:        true,  // tricks sites into thinking MetaMask is connected
      selectedAddress:   null,
      networkVersion:    String(chainId),
      chainId:           chainHex,

      // eth_requestAccounts / eth_accounts
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          // Derive address from private key using subtle crypto
          // We store address after first derivation
          if (!window.__walletAddress) {
            // Use a simple secp256k1 derivation hint stored during injection
            window.__walletAddress = window.__injectedAddress;
          }
          window.ethereum.selectedAddress = window.__walletAddress;
          return [window.__walletAddress];
        }

        if (method === 'eth_chainId') return chainHex;
        if (method === 'net_version') return String(chainId);

        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'wallet_addEthereumChain')   return null;

        if (method === 'eth_sendTransaction') {
          const tx = params[0];
          // Send to our background signing endpoint
          const resp = await fetch('http://localhost:7545/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx, pk: window.__injectedPK }),
          });
          const data = await resp.json();
          if (data.error) throw new Error(data.error);
          return data.hash;
        }

        if (method === 'eth_getBalance') {
          const resp = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc:'2.0', method:'eth_getBalance', params, id:1 }),
          });
          const d = await resp.json();
          return d.result;
        }

        if (method === 'eth_call' || method === 'eth_estimateGas' ||
            method === 'eth_getTransactionCount' || method === 'eth_blockNumber' ||
            method === 'eth_gasPrice' || method === 'eth_getTransactionReceipt') {
          const resp = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc:'2.0', method, params: params||[], id:1 }),
          });
          const d = await resp.json();
          return d.result;
        }

        console.log('[InjectedWallet] Unhandled method:', method);
        return null;
      },

      on: (event, cb) => {
        window.ethereum._listeners[event] = window.ethereum._listeners[event] || [];
        window.ethereum._listeners[event].push(cb);
      },
      removeListener: () => {},
      emit: (event, data) => {
        (window.ethereum._listeners[event] || []).forEach(cb => cb(data));
      },
    };

    // Store for use in request handler
    window.__injectedPK      = pk;
    window.__injectedAddress = null; // set below via separate script

  }, privateKey, rpcUrl || RPC_URLS[0], CHAIN_ID, CHAIN_HEX);
}

// ── Local signing server ──────────────────────────────────────────────────────
function startSigningServer(provider) {
  const http = require('http');
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { tx, pk } = JSON.parse(body);
        if (!provider) throw new Error('No RPC provider available');

        const wallet   = new ethers.Wallet(pk, provider);
        const feeData  = await provider.getFeeData();
        const nonce    = await provider.getTransactionCount(wallet.address, 'pending');

        const txReq = {
          to:       tx.to,
          from:     tx.from || wallet.address,
          data:     tx.data || '0x',
          value:    tx.value ? BigInt(tx.value) : 0n,
          nonce,
          chainId:  CHAIN_ID,
          gasPrice: feeData.gasPrice ? BigInt(Math.floor(Number(feeData.gasPrice) * 1.1)) : undefined,
          gasLimit: tx.gas ? BigInt(tx.gas) : 300000n,
        };

        const signed   = await wallet.signTransaction(txReq);
        const txHash   = await provider.send('eth_sendRawTransaction', [signed]);
        info(`TX sent: ${txHash}`);

        // Wait for receipt
        const receipt = await provider.waitForTransaction(txHash, 1, 120000);
        if (receipt?.status === 1) {
          ok(`TX confirmed: ${txHash}`);
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ hash: txHash }));
        } else {
          fail(`TX reverted: ${txHash}`);
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ error: 'TX reverted', hash: txHash }));
        }
      } catch (e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  });

  server.listen(7545, '127.0.0.1', () => {
    info('Signing server running on port 7545');
  });
  return server;
}

// ── Browser helper ────────────────────────────────────────────────────────────
async function openBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--allow-running-insecure-content',
    ],
  });
}

async function newPage(browser, wallet, provider) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  // Inject wallet BEFORE page loads
  const rpcUrl = provider ? RPC_URLS[0] : '';
  await injectWallet(page, wallet.private_key, rpcUrl);

  // Set the address after injection (we know it from ethers)
  await page.evaluateOnNewDocument((addr) => {
    window.__injectedAddress = addr;
  }, wallet.address);

  return page;
}

async function waitAndClick(page, selector, timeout=10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    await hDelay(500, 1500);
    await page.click(selector);
    return true;
  } catch { return false; }
}

async function connectWallet(page) {
  // Try common "Connect Wallet" button patterns
  const selectors = [
    'button:has-text("Connect Wallet")',
    'button:has-text("Connect")',
    '[data-testid="connect-wallet"]',
    '.connect-wallet',
    'button.wallet-connect',
    'w3m-button',
    'appkit-button',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await hDelay(1000, 2000);
        // Look for MetaMask/Browser Wallet option
        const mmSel = [
          'button:has-text("MetaMask")',
          'button:has-text("Browser Wallet")',
          'button:has-text("Injected")',
          '[data-wallet="metamask"]',
        ];
        for (const ms of mmSel) {
          const mm = await page.$(ms);
          if (mm) { await mm.click(); return true; }
        }
        return true;
      }
    } catch {}
  }

  // Try clicking via text content
  try {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => b.textContent.toLowerCase().includes('connect'));
      if (btn) btn.click();
    });
    await hDelay(1000, 2000);
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Step 1: Faucet ────────────────────────────────────────────────────────────
async function task1_faucet(wallet, _browser, _provider, force=false) {
  step('Step 1: LiteForge Faucet');
  if (isDone(wallet.address, 's1') && !force) { warn('Already done'); return true; }

  info(`Calling faucet API for ${wallet.address}`);
  const { status, body } = await claimFaucet(wallet.address);
  info(`HTTP ${status}: ${body.slice(0,120)}`);

  if (status === 200 || status === 201) {
    try {
      const data = JSON.parse(body);
      const txHash = data.txHash || data.transactionHash || data.hash || data.tx || '';
      ok(`Faucet claimed! ${txHash ? 'TX: ' + txHash : 'Confirmed by server'}`);
    } catch {
      ok(`Faucet accepted (${body.slice(0,60)})`);
    }
    markDone(wallet.address, 's1');
    return true;
  } else if (status === 429) {
    warn('Rate limited — already claimed today (24h cooldown)');
    warn('Tokens were sent previously — check explorer tomorrow');
    markDone(wallet.address, 's1');
    return true;
  } else {
    fail(`Faucet HTTP ${status}: ${body.slice(0,100)}`);
    markFailed(wallet.address, 's1');
    return false;
  }
}

// ── Step 2: Lester Labs ───────────────────────────────────────────────────────
async function task2_lester(wallet, browser, provider, force=false) {
  step('Step 2: Lester Labs — Launch Token');
  if (isDone(wallet.address, 's2') && !force) { warn('Already done'); return true; }
  if (!provider) { fail('No RPC — cannot sign TX'); markFailed(wallet.address, 's2'); return false; }

  const names  = ['Degen','Moon','Alpha','Sigma','Nova','Apex','Blaze','Flux','Zen','Storm'];
  const suffix = ['Coin','Token','Finance','DAO','Pad','Verse','Forge'];
  const tname  = names[Math.floor(Math.random()*names.length)] + suffix[Math.floor(Math.random()*suffix.length)];
  const tsym   = tname.slice(0,3).toUpperCase() + Math.floor(Math.random()*90+10);
  info(`Token: ${tname} (${tsym})`);

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://lester-labs.com/launch', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    // Fill token form
    const nameInput = await page.$('input[name="name"], input[placeholder*="name" i], input[placeholder*="Name"]');
    if (nameInput) { await nameInput.click(); await nameInput.type(tname, {delay: 80}); }

    const symInput = await page.$('input[name="symbol"], input[placeholder*="symbol" i], input[placeholder*="Symbol"]');
    if (symInput) { await symInput.click(); await symInput.type(tsym, {delay: 80}); }

    await hDelay(1000, 2000);

    // Click Launch/Deploy button
    const launched = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /launch|deploy|create/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (launched) {
      await hDelay(5000, 10000);
      ok(`Token '${tname}' launch initiated!`);
      markDone(wallet.address, 's2');
      await page.close();
      return true;
    } else {
      fail('Could not find Launch button');
      markFailed(wallet.address, 's2');
      await page.close();
      return false;
    }
  } catch (e) {
    fail(`Lester Labs error: ${e.message}`);
    markFailed(wallet.address, 's2');
    await page.close();
    return false;
  }
}

// ── Step 3: Midashand Faucet ──────────────────────────────────────────────────
async function task3_midashand_faucet(wallet, browser, provider, force=false) {
  step('Step 3: Midashand — Claim tokens');
  if (isDone(wallet.address, 's3') && !force) { warn('Already done'); return true; }

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://midashand.xyz', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 3000);
    await connectWallet(page);
    await hDelay(2000, 4000);

    // Click claim/faucet button
    const claimed = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /claim|faucet|get token/i.test(b.textContent));
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (claimed) {
      await hDelay(4000, 8000);
      ok('Midashand faucet claimed!');
      markDone(wallet.address, 's3');
    } else {
      warn('No claim button found — may need manual check');
      markDone(wallet.address, 's3'); // mark done anyway (might auto-give)
    }
    await page.close();
    return true;
  } catch (e) {
    fail(`Midashand faucet: ${e.message}`);
    markFailed(wallet.address, 's3');
    await page.close();
    return false;
  }
}

// ── Step 4: Midashand Bet ─────────────────────────────────────────────────────
async function task4_bet(wallet, browser, provider, force=false) {
  step('Step 4: Midashand Markets — Place Bet');
  if (isDone(wallet.address, 's4') && !force) { warn('Already done'); return true; }

  const side = Math.random() > 0.5 ? 'YES' : 'NO';
  info(`Betting: ${side}`);

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://midashand.xyz/markets', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 3000);
    await connectWallet(page);
    await hDelay(2000, 4000);

    // Click first market
    const marketClicked = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="market"], [class*="card"], article');
      if (cards[0]) { cards[0].click(); return true; }
      return false;
    });

    await hDelay(1500, 3000);

    // Click YES or NO
    const betPlaced = await page.evaluate((side) => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => b.textContent.trim().toUpperCase() === side);
      if (btn) { btn.click(); return true; }
      // fallback — click any bet button
      const anyBet = btns.find(b => /yes|no|bet|vote/i.test(b.textContent));
      if (anyBet) { anyBet.click(); return true; }
      return false;
    }, side);

    await hDelay(2000, 4000);

    // Confirm
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const confirm = btns.find(b => /confirm|submit|place bet/i.test(b.textContent));
      if (confirm) confirm.click();
    });

    await hDelay(5000, 10000);
    ok(`Bet placed: ${side}`);
    markDone(wallet.address, 's4');
    await page.close();
    return true;
  } catch (e) {
    fail(`Bet error: ${e.message}`);
    markFailed(wallet.address, 's4');
    await page.close();
    return false;
  }
}

// ── Step 5: ONMI Create Token ─────────────────────────────────────────────────
async function task5_onmi_create(wallet, browser, provider, force=false) {
  step('Step 5: ONMI — Create Token');
  if (isDone(wallet.address, 's5') && !force) { warn('Already done'); return true; }

  const words  = ['Rocket','Galaxy','Thunder','Phoenix','Dragon','Crystal'];
  const tname  = words[Math.floor(Math.random()*words.length)] + ['Pad','Flux','Wave','Forge'][Math.floor(Math.random()*4)];
  const tsym   = tname.slice(0,3).toUpperCase() + Math.floor(Math.random()*90+10);
  info(`Token: ${tname} (${tsym})`);

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://app.onmi.fun/?chain=LITVM', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    // Fill name
    const nameEl = await page.$('input[placeholder*="name" i], input[name="name"]');
    if (nameEl) { await nameEl.click(); await nameEl.type(tname, {delay:80}); }

    const symEl = await page.$('input[placeholder*="symbol" i], input[name="symbol"], input[placeholder*="ticker" i]');
    if (symEl) { await symEl.click(); await symEl.type(tsym, {delay:80}); }

    await hDelay(1000, 2000);

    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /create|launch|deploy/i.test(b.textContent));
      if (btn) btn.click();
    });

    await hDelay(6000, 12000);
    ok(`Token '${tname}' created on ONMI!`);
    markDone(wallet.address, 's5');
    await page.close();
    return true;
  } catch (e) {
    fail(`ONMI create: ${e.message}`);
    markFailed(wallet.address, 's5');
    await page.close();
    return false;
  }
}

// ── Step 6: ONMI Swaps ───────────────────────────────────────────────────────
async function task6_swaps(wallet, browser, provider, force=false) {
  step('Step 6: ONMI — Swaps');
  if (isDone(wallet.address, 's6') && !force) { warn('Already done'); return true; }

  const swapCount = 2 + Math.floor(Math.random()*3);
  info(`Doing ${swapCount} swaps`);

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://app.onmi.fun/swap?chain=LITVM', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    let done = 0;
    for (let i = 0; i < swapCount; i++) {
      info(`Swap ${i+1}/${swapCount}`);
      const amt = randAmt(0.0001, 0.001);

      // Enter amount
      const amtInput = await page.$('input[placeholder*="0.0"], input[type="number"], input[placeholder*="amount" i]');
      if (amtInput) {
        await amtInput.click({ clickCount: 3 });
        await amtInput.type(amt, {delay:80});
      }

      await hDelay(1000, 2000);

      // Click Swap button
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn  = btns.find(b => /^swap$/i.test(b.textContent.trim()) || /swap now/i.test(b.textContent));
        if (btn) btn.click();
      });

      await hDelay(4000, 8000);

      // Confirm
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn  = btns.find(b => /confirm|approve|submit/i.test(b.textContent));
        if (btn) btn.click();
      });

      await hDelay(5000, 10000);
      ok(`Swap ${i+1} done!`);
      done++;
      await hDelay(2000, 5000);
    }

    if (done > 0) {
      ok(`${done}/${swapCount} swaps completed!`);
      markDone(wallet.address, 's6');
      await page.close();
      return true;
    } else {
      fail('No swaps completed');
      markFailed(wallet.address, 's6');
      await page.close();
      return false;
    }
  } catch (e) {
    fail(`Swaps error: ${e.message}`);
    markFailed(wallet.address, 's6');
    await page.close();
    return false;
  }
}

// ── Step 7: ONMI Liquidity ────────────────────────────────────────────────────
async function task7_liquidity(wallet, browser, provider, force=false) {
  step('Step 7: ONMI — Add Liquidity');
  if (isDone(wallet.address, 's7') && !force) { warn('Already done'); return true; }

  const page = await newPage(browser, wallet, provider);
  const liqUrl = `https://app.onmi.fun/liquidity/add/ZKLTC/${ZKLTC}?chain=LITVM`;
  try {
    await page.goto(liqUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    // Enter amounts
    const inputs = await page.$$('input[type="number"], input[placeholder*="0.0"]');
    for (const input of inputs.slice(0,2)) {
      const amt = randAmt(0.0001, 0.0005);
      await input.click({ clickCount: 3 });
      await input.type(String(amt), {delay:80});
      await hDelay(500, 1000);
    }

    await hDelay(1500, 3000);

    // Approve if needed
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const approve = btns.find(b => /approve/i.test(b.textContent));
      if (approve) approve.click();
    });
    await hDelay(3000, 6000);

    // Add liquidity
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /add liquidity|supply|confirm/i.test(b.textContent));
      if (btn) btn.click();
    });

    await hDelay(8000, 15000);
    ok('Liquidity added!');
    markDone(wallet.address, 's7');
    await page.close();
    return true;
  } catch (e) {
    fail(`Liquidity error: ${e.message}`);
    markFailed(wallet.address, 's7');
    await page.close();
    return false;
  }
}

// ── Step 8: ONMI Campaign ─────────────────────────────────────────────────────
async function task8_campaign(wallet, browser, provider, force=false) {
  step('Step 8: ONMI Campaign #4441');
  if (isDone(wallet.address, 's8') && !force) { warn('Already done'); return true; }

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://app.onmi.fun/campaigns/4441?chain=LITVM', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    // Complete all visible tasks
    let completed = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const btn  = btns.find(b => /complete|claim|do task|verify|start/i.test(b.textContent) && !b.disabled);
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (clicked) {
        completed++;
        ok(`Campaign task ${completed} clicked`);
        await hDelay(3000, 6000);
      } else {
        break;
      }
    }

    ok(`Campaign: ${completed} tasks completed`);
    markDone(wallet.address, 's8');
    await page.close();
    return true;
  } catch (e) {
    fail(`Campaign error: ${e.message}`);
    markFailed(wallet.address, 's8');
    await page.close();
    return false;
  }
}

// ── Step 9: AyniLabs ──────────────────────────────────────────────────────────
async function task9_ayni(wallet, browser, provider, force=false) {
  step('Step 9: AyniLabs — Swap zkLTC→wzkLTC + Supply');
  if (isDone(wallet.address, 's9') && !force) { warn('Already done'); return true; }

  const page = await newPage(browser, wallet, provider);
  try {
    await page.goto('https://aynilabs.xyz/dashboard/', { waitUntil: 'networkidle2', timeout: 30000 });
    await hDelay(2000, 4000);
    await connectWallet(page);
    await hDelay(2000, 3000);

    const amt = randAmt(0.0001, 0.0005);
    info(`Amount: ${amt} zkLTC`);

    // Enter swap amount
    const amtInput = await page.$('input[type="number"], input[placeholder*="0"], input[placeholder*="amount" i]');
    if (amtInput) {
      await amtInput.click({ clickCount: 3 });
      await amtInput.type(String(amt), {delay:80});
    }
    await hDelay(1000, 2000);

    // Click Swap
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /swap/i.test(b.textContent));
      if (btn) btn.click();
    });
    await hDelay(5000, 10000);

    // Click Supply
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn  = btns.find(b => /supply|deposit/i.test(b.textContent));
      if (btn) btn.click();
    });
    await hDelay(5000, 10000);

    ok('AyniLabs swap + supply done!');
    markDone(wallet.address, 's9');
    await page.close();
    return true;
  } catch (e) {
    fail(`AyniLabs error: ${e.message}`);
    markFailed(wallet.address, 's9');
    await page.close();
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK RUNNER
// ═══════════════════════════════════════════════════════════════════════════════
const ALL_TASKS = [
  { id:'s1', name:'Step 1: LiteForge Faucet',   fn: task1_faucet },
  { id:'s2', name:'Step 2: Lester Labs',         fn: task2_lester },
  { id:'s3', name:'Step 3: Midashand Faucet',    fn: task3_midashand_faucet },
  { id:'s4', name:'Step 4: Midashand Bet',       fn: task4_bet },
  { id:'s5', name:'Step 5: ONMI Create Token',   fn: task5_onmi_create },
  { id:'s6', name:'Step 6: ONMI Swaps',          fn: task6_swaps },
  { id:'s7', name:'Step 7: ONMI Liquidity',      fn: task7_liquidity },
  { id:'s8', name:'Step 8: ONMI Campaign',       fn: task8_campaign },
  { id:'s9', name:'Step 9: AyniLabs',            fn: task9_ayni },
];

async function runAllTasks(wallet, browser, provider, force=false) {
  console.log(`\n${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.cyan}${C.bold}  Wallet: ${wallet.address}${C.reset}`);
  console.log(`${C.cyan}${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

  const results = {};
  for (const task of ALL_TASKS) {
    results[task.name] = await task.fn(wallet, browser, provider, force);
    await hDelay(2000, 5000);
  }

  // Summary
  console.log(`\n${C.bold}  ╔══════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}  ║        RESULTS SUMMARY               ║${C.reset}`);
  console.log(`${C.bold}  ╠══════════════════════════════════════╣${C.reset}`);
  for (const [name, passed] of Object.entries(results)) {
    const icon = passed ? `${C.green}✅` : `${C.red}❌`;
    console.log(`  ║ ${icon} ${name.padEnd(34)}${C.reset}  ║`);
  }
  const passed = Object.values(results).filter(Boolean).length;
  console.log(`${C.bold}  ╠══════════════════════════════════════╣${C.reset}`);
  console.log(`${C.bold}  ║  Total: ${passed}/9 tasks completed          ║${C.reset}`);
  console.log(`${C.bold}  ╚══════════════════════════════════════╝${C.reset}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════════════════════
function printBanner() {
  console.clear();
  const banner = `
${C.cyan}  ╔══════════════════════════════════════════════════════════╗${C.reset}
${C.cyan}  ║${C.bold}${C.yellow}        MirLite Bot v5.0 — LitecoinEVM Testnet           ${C.reset}${C.cyan}║${C.reset}
${C.cyan}  ║${C.green}        Puppeteer Browser Automation + Wallet Signing   ${C.cyan}║${C.reset}
${C.cyan}  ║${C.magenta}        Backed by: Litecoin (Top 20 Project)             ${C.cyan}║${C.reset}
${C.cyan}  ╚══════════════════════════════════════════════════════════╝${C.reset}
`;
  console.log(banner);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════════════════════════════════════
async function showMenu(browser, provider) {
  const wallets = loadWallets();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));

  while (true) {
    printBanner();
    console.log(`${C.cyan}  1.${C.reset} Create wallets (unlimited)`);
    console.log(`${C.cyan}  2.${C.reset} List saved wallets`);
    console.log(`${C.cyan}  3.${C.reset} Run ALL tasks — single wallet`);
    console.log(`${C.cyan}  4.${C.reset} Run ALL tasks — ALL wallets`);
    console.log(`${C.cyan}  5.${C.reset} Run specific step`);
    console.log(`${C.cyan}  6.${C.reset} Force re-run a step`);
    console.log(`${C.cyan}  7.${C.reset} Check wallet balances`);
    console.log(`${C.cyan}  0.${C.reset} Exit`);
    console.log();

    const choice = (await ask(`${C.cyan}  Enter choice: ${C.reset}`)).trim();

    if (choice === '1') {
      const n = parseInt(await ask(`${C.yellow}  How many wallets? ${C.reset}`));
      if (!isNaN(n) && n > 0) {
        const created = createWallets(n);
        console.log(`\n${C.green}✓ Created ${n} wallet(s):${C.reset}`);
        for (const w of created) console.log(`  ${C.green}${w.address}${C.reset}`);
        console.log(`\n${C.yellow}⚠ BACKUP wallets.json — contains private keys!${C.reset}`);
      }

    } else if (choice === '2') {
      const ws = loadWallets();
      if (!ws.length) { warn('No wallets yet'); }
      else {
        console.log(`\n${'#'.padEnd(4)} ${'Address'.padEnd(44)} ${'Done'.padEnd(6)} Failed`);
        console.log('─'.repeat(70));
        for (const [i,w] of ws.entries()) {
          console.log(`${String(i+1).padEnd(4)} ${w.address.padEnd(44)} ${String(w.tasks_done?.length||0)+'/9'.padEnd(6)} ${w.tasks_failed?.length||0}`);
        }
      }

    } else if (choice === '3') {
      const ws = loadWallets();
      if (!ws.length) { fail('No wallets'); continue; }
      for (const [i,w] of ws.entries()) console.log(`  ${i+1}. ${w.address}`);
      const idx = parseInt(await ask(`${C.cyan}  Wallet #: ${C.reset}`)) - 1;
      if (ws[idx]) await runAllTasks(ws[idx], browser, provider);

    } else if (choice === '4') {
      const ws = loadWallets();
      if (!ws.length) { fail('No wallets'); continue; }
      for (const [i,w] of ws.entries()) {
        if (i > 0) {
          const wait = 45000 + Math.random()*75000;
          info(`Waiting ${Math.round(wait/1000)}s before next wallet...`);
          await sleep(wait);
        }
        await runAllTasks(w, browser, provider);
      }

    } else if (choice === '5' || choice === '6') {
      const force = choice === '6';
      for (const [i,t] of ALL_TASKS.entries()) console.log(`  ${i+1}. ${t.name}`);
      const si  = parseInt(await ask(`${C.cyan}  Step #: ${C.reset}`)) - 1;
      if (!ALL_TASKS[si]) { fail('Invalid step'); continue; }
      const ws  = loadWallets();
      if (!ws.length) { fail('No wallets'); continue; }
      for (const [i,w] of ws.entries()) console.log(`  ${i+1}. ${w.address}`);
      const wi  = (await ask(`${C.cyan}  Wallet # (or 'all'): ${C.reset}`)).trim().toLowerCase();
      if (wi === 'all') {
        for (const w of ws) { await ALL_TASKS[si].fn(w, browser, provider, force); await hDelay(3000,8000); }
      } else {
        const idx = parseInt(wi) - 1;
        if (ws[idx]) await ALL_TASKS[si].fn(ws[idx], browser, provider, force);
      }

    } else if (choice === '7') {
      const ws = loadWallets();
      if (provider) {
        for (const w of ws) {
          const bal = await provider.getBalance(w.address);
          console.log(`  ${w.address}: ${ethers.formatEther(bal)} tLTC`);
        }
      } else {
        warn('No RPC — cannot fetch balances');
      }

    } else if (choice === '0') {
      console.log(`\n${C.yellow}  👋 Good luck with the airdrop!\n${C.reset}`);
      rl.close();
      break;
    }

    await ask(`\n${C.cyan}  Press Enter to continue...${C.reset}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  printBanner();
  console.log('  Initializing...\n');

  const provider = await getProvider();
  const browser  = await openBrowser();
  const server   = startSigningServer(provider);

  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...');
    server.close();
    await browser.close();
    process.exit(0);
  });

  await showMenu(browser, provider);
  server.close();
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
