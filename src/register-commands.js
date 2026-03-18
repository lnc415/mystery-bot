/**
 * Register slash commands with Discord.
 * Run once after setup: node src/register-commands.js
 */

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const config = require("./config");

const commands = [
  require("./commands/help").command.toJSON(),
  require("./commands/status").command.toJSON(),
  require("./modules/gifbot/index").command.toJSON(),
];

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    console.log("Registering slash commands…");

    const route = config.discord.guildId
      ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
      : Routes.applicationCommands(config.discord.clientId);

    const data = await rest.put(route, { body: commands });
    console.log(`✅ Registered ${data.length} commands.`);
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
})();
