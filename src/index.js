/**
 * Mystery Bot — Entry Point (SaaS Edition)
 * ─────────────────────────────────────────────────────────────────
 * One bot instance runs on Replit. Customers add it to their servers
 * and configure everything through Discord slash commands.
 *
 * No customer ever touches code or config files.
 * All per-guild configuration lives in src/config/guilds.json and is
 * managed entirely through /license, /setup, and /configure.
 * ─────────────────────────────────────────────────────────────────
 */

require("dotenv").config();

const path    = require("path");
const express = require("express");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config = require("./config");
const { startMonitoring } = require("./lib/cardano/monitor");

// ── Web server (Express) ───────────────────────────────────────
// Serves the buy/success pages and Stripe webhook.
// Also keeps the Repl alive for UptimeRobot (ping /health).
const PORT = process.env.PORT || 3000;
const app  = express();

// Serve static files from /public
app.use(express.static(path.join(__dirname, "../public")));

// Mount the Stripe checkout router (includes /buy, /success, /webhook, /health)
const checkoutRouter = require("./payments/checkout");
app.use("/", checkoutRouter);

app.listen(PORT, () => {
  console.log(`[Web] Express server on port ${PORT}`);
});

// ── Discord client ─────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ── Module loaders ─────────────────────────────────────────────
// Event-based modules (chatbot, buybot) are registered here.
// Their handlers check guild license at runtime.

function loadModules() {
  // GIF Bot slash command is handled via commandHandlers below.
  // Register gifbot for event fallback compatibility.
  require("./modules/gifbot").register(client);

  // Chatbot — register listener; module gates on per-guild config
  if (config.modules.chatbot) {
    require("./modules/chatbot").register(client);
  }

  // Buy/Sell/Liquidity — register listener; module reads guild config
  if (config.modules.buybot || config.modules.sellbot || config.modules.liquidity) {
    require("./modules/buybot").register(client);
  }
}

// ── Slash command handlers ─────────────────────────────────────

const commandHandlers = {
  configure: require("./commands/configure"),
  license:   require("./commands/license"),
  setup:     require("./commands/setup"),
  status:    require("./commands/status"),
  help:      require("./commands/help"),
  debug:     require("./commands/debug"),
  gif:       require("./modules/gifbot/index"),
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handler = commandHandlers[interaction.commandName];
  if (handler) {
    await handler.execute(interaction).catch((err) => {
      console.error(`[Bot] Error in /${interaction.commandName}:`, err);
    });
  }
});

// ── Boot ───────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`\n🤖 ${client.user.tag} is online`);
  console.log(`   Mode: Multi-server SaaS — all config via Discord commands`);
  console.log(`   Serving ${client.guilds.cache.size} server(s)`);
  client.user.setActivity("Cardano DEX markets", { type: 3 });

  // Start the Cardano DEX monitoring engine
  startMonitoring(client);
});

loadModules();
client.login(config.discord.token);
