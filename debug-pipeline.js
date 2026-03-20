require('dotenv').config();
const bf          = require('./src/lib/cardano/blockfrost');
const koios       = require('./src/lib/cardano/koios');
const guildConfig = require('./src/lib/guildConfig');

const GUILD_ID  = '1184940966080159965';
const POLICY_ID = '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa';
const ASSET_HEX = '4e49474854';
const TX_HASH   = '15a8d774dbbe28635550e86ea21c19fb264e14951c676d1045caaf46a1217126';
const API_KEY   = process.env.BLOCKFROST_API_KEY;

async function run() {
  console.log('=== STEP 1: Guild Config ===');
  const cfg        = guildConfig.getGuildConfig(GUILD_ID);
  const buybotCfg  = guildConfig.getModuleConfig(GUILD_ID, 'buybot');
  console.log('modules:', cfg.modules);
  console.log('hasBuybot:', guildConfig.hasModule(GUILD_ID, 'buybot'));
  console.log('buybot channelId:', buybotCfg.channelId || 'MISSING ❌');
  console.log('buybot ticker:',    buybotCfg.ticker    || 'MISSING ❌');
  console.log('buybot policyId:',  buybotCfg.policyId  || 'MISSING ❌');

  console.log('\n=== STEP 2: Blockfrost returns this TX? ===');
  const txList = await bf.getAssetTransactions(POLICY_ID, ASSET_HEX, API_KEY);
  const found  = txList.find(t => t.txHash === TX_HASH);
  console.log('TX in Blockfrost response:', found ? '✅ YES' : '❌ NO — too old or outside window');
  console.log('Total txs returned:', txList.length);
  if (txList.length) {
    console.log('Most recent blockTime:', new Date(txList[0].blockTime * 1000).toISOString());
    console.log('Oldest blockTime:',     new Date(txList[txList.length-1].blockTime * 1000).toISOString());
  }

  console.log('\n=== STEP 3: Classification of target TX ===');
  const utxos  = await bf.getTransactionDetails(TX_HASH, API_KEY);
  const action = bf.classifyTransaction(utxos, POLICY_ID);
  const ada    = bf.extractAdaAmount(utxos, POLICY_ID);
  const tokens = bf.extractTokenAmount(utxos, POLICY_ID);
  console.log('Action:', action, action === 'buy' ? '✅' : '❌');
  console.log('ADA:',    ada);
  console.log('Tokens:', tokens);

  console.log('\n=== STEP 4: blockTime cutoff check ===');
  const txDetails = txList.find(t => t.txHash === TX_HASH);
  const cutoff    = Math.floor(Date.now() / 1000) - 600;
  if (txDetails) {
    console.log('TX blockTime:', txDetails.blockTime, '→', new Date(txDetails.blockTime * 1000).toISOString());
    console.log('Cutoff (10min ago):', cutoff, '→', new Date(cutoff * 1000).toISOString());
    console.log('Passes cutoff:', txDetails.blockTime >= cutoff ? '✅' : '❌ TOO OLD — filtered out');
  } else {
    console.log('TX not in Blockfrost response — cannot check cutoff');
  }

  console.log('\n=== STEP 5: Koios sees this TX? ===');
  try {
    const koiosTrades = await koios.getRecentTrades(POLICY_ID);
    const koiosFound  = koiosTrades.find(t => t.txHash === TX_HASH);
    console.log('TX in Koios response:', koiosFound ? '✅ YES' : '❌ NO');
    console.log('Koios total trades:', koiosTrades.length);
    if (koiosFound) console.log('Koios action:', koiosFound.action);
  } catch(e) {
    console.log('Koios error:', e.message);
  }

  console.log('\n=== SUMMARY ===');
  const issues = [];
  if (!guildConfig.hasModule(GUILD_ID, 'buybot'))  issues.push('buybot not in modules');
  if (!buybotCfg.channelId) issues.push('channelId missing');
  if (!buybotCfg.policyId)  issues.push('policyId missing');
  if (!found)               issues.push('TX not in Blockfrost window');
  if (action !== 'buy')     issues.push('classified as ' + action + ' not buy');
  if (issues.length === 0)  console.log('✅ No issues found — check if bot is actually running');
  else issues.forEach(i => console.log('❌', i));
}

run().catch(console.error);
