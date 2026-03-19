/**
 * Register slash commands with Discord.
 * Run once (or after adding new commands):
 *   node src/register-commands.js
 *
 * Set DISCORD_GUILD_ID in .env for instant guild-scoped updates during dev.
 * Leave it unset to register globally (takes up to 1 hour to propagate).
 */

require("dotenv").config();
const { REST, Routes } = require("discord.js");
const config = require("./config");

const commands = [
  require("./commands/configure").command.toJSON(),
  require("./commands/license").command.toJSON(),
  require("./commands/setup").command.toJSON(),
  require("./commands/status").command.toJSON(),
  require("./commands/help").command.toJSON(),
  require("./modules/gifbot/index").command.toJSON(),
];

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash commands…`);

    const route = config.discord.guildId
      ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
      : Routes.applicationCommands(config.discord.clientId);

    const data = await rest.put(route, { body: commands });
    console.log(`✅ Registered ${data.length} commands successfully.`);
    console.log("Commands:", data.map((c) => `/${c.name}`).join(", "));
  } catch (err) {
    console.error("Failed to register commands:", err);
    process.exit(1);
  }
})();
