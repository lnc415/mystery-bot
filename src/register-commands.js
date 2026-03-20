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

const commandFiles = [
  { name: "configure", path: "./commands/configure"      },
  { name: "license",   path: "./commands/license"        },
  { name: "setup",     path: "./commands/setup"          },
  { name: "status",    path: "./commands/status"         },
  { name: "help",      path: "./commands/help"           },
  { name: "debug",     path: "./commands/debug"          },
  { name: "gif",       path: "./modules/gifbot/index"    },
];

const commands = [];
for (const { name, path: filePath } of commandFiles) {
  try {
    const mod = require(filePath);
    if (!mod.command) throw new Error("missing .command export");
    commands.push(mod.command.toJSON());
    console.log(`  ✅ Loaded: /${name}`);
  } catch (err) {
    console.error(`  ❌ Failed to load /${name}: ${err.message}`);
  }
}

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
