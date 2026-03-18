/**
 * Mystery Bot — Entry Point
 * ─────────────────────────────────────────────────────────────────
 * Loads config → validates license → registers active modules.
 * ─────────────────────────────────────────────────────────────────
 */

require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const config   = require("./config");
const license  = require("./license/manager");

// ── Discord client ─────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // required for chatbot text reading
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

// ── License check ──────────────────────────────────────────────

const entitlements = license.getEntitlements(config.license.key);

function isAllowed(module) {
  // Free modules always pass
  if (license.FREE_MODULES.includes(module)) return true;
  // Paid modules require license
  if (!entitlements.has(module)) {
    console.log(`[License] Module "${module}" not unlocked — skipping.`);
    return false;
  }
  return true;
}

// ── Module loader ──────────────────────────────────────────────

function loadModules() {
  if (config.modules.gifbot && isAllowed("gifbot")) {
    require("./modules/gifbot").register(client);
  }

  if (config.modules.chatbot && isAllowed("chatbot")) {
    require("./modules/chatbot").register(client);
  }

  if (
    (config.modules.buybot || config.modules.sellbot || config.modules.liquidity) &&
    (isAllowed("buybot") || isAllowed("sellbot") || isAllowed("liquidity"))
  ) {
    require("./modules/buybot").register(client);
  }
}

// ── Slash command handler ──────────────────────────────────────

const commandHandlers = {
  help:   require("./commands/help"),
  status: require("./commands/status"),
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handler = commandHandlers[interaction.commandName];
  if (handler) await handler.execute(interaction).catch(console.error);
});

// ── Boot ───────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`\n🤖 ${client.user.tag} online`);
  console.log(`   License: ${config.license.key ? "✅ Active" : "⚠️  Free tier"}`);
  console.log(`   Modules: ${[...entitlements].join(", ")}`);
  client.user.setActivity("the $141 mystery", { type: 3 }); // type 3 = Watching
});

loadModules();
client.login(config.discord.token);
