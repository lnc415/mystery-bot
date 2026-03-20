require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { postBuyAlert } = require('./src/lib/cardano/monitor');

const GUILD_ID = '1184940966080159965';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.login(process.env.DISCORD_TOKEN).then(async () => {
  await new Promise(r => setTimeout(r, 2000));

  console.log('🐟 Firing Small buy (₳85)...');
  await postBuyAlert(client, GUILD_ID, {
    action: 'buy', adaAmount: 85, tokenAmount: 3200,
    txHash: 'smalltest0001aabb', time: Math.floor(Date.now()/1000),
    dex: 'MinSwap', source: 'Blockfrost', ticker: '$NIGHT'
  });

  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('🐬 Firing Medium buy (₳450)...');
  await postBuyAlert(client, GUILD_ID, {
    action: 'buy', adaAmount: 450, tokenAmount: 15000,
    txHash: 'medtest0002ccdd', time: Math.floor(Date.now()/1000),
    dex: 'SundaeSwap', source: 'Koios', ticker: '$NIGHT'
  });

  console.log('Waiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));

  console.log('🐋 Firing Whale buy (₳2,500)...');
  await postBuyAlert(client, GUILD_ID, {
    action: 'buy', adaAmount: 2500, tokenAmount: 75000,
    txHash: 'whaletest0003eeff', time: Math.floor(Date.now()/1000),
    dex: 'MuesliSwap', source: 'Blockfrost', ticker: '$NIGHT'
  });

  console.log('✅ All three tiers fired!');
  client.destroy();
});
