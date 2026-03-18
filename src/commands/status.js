const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { keyInfo, FREE_MODULES }             = require("../license/manager");
const config                                = require("../config");

const command = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show which bot modules are active");

async function execute(interaction) {
  const info     = keyInfo(config.license.key);
  const modules  = config.modules;

  const statusLine = (enabled, name) =>
    `${enabled ? "🟢" : "⚫"} **${name}** ${enabled ? "Active" : "Disabled"}`;

  const embed = new EmbedBuilder()
    .setColor(0xc9a84c)
    .setTitle("🕵️ Mystery Bot — Module Status")
    .addFields(
      { name: "License",      value: info.valid ? `✅ ${info.label || "Valid"} (${info.tier || ""})` : "⚠️ Free tier", inline: false },
      { name: "Modules",      value: [
          statusLine(true,              "GIF Bot (free)"),
          statusLine(modules.chatbot,   "Chatbot"),
          statusLine(modules.buybot,    "Buy Alerts"),
          statusLine(modules.sellbot,   "Sell Alerts"),
          statusLine(modules.liquidity, "Liquidity Monitor"),
        ].join("\n"), inline: false },
      { name: "AI Provider",  value: modules.chatbot ? `${config.ai.provider} / ${config.ai.model}` : "—", inline: true },
      { name: "Chain Source", value: modules.buybot  ? `${config.chain.source} / ${config.chain.blockfrostNet}` : "—", inline: true },
      { name: "Token",        value: modules.buybot  ? config.chain.ticker : "—", inline: true },
    )
    .setFooter({ text: "Mystery Bot • github.com/lnc415/mystery-bot" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { command, execute };
