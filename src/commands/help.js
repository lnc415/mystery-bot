const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const config = require("../config");

const command = new SlashCommandBuilder()
  .setName("help")
  .setDescription("List available bot commands");

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x00d4ff)
    .setTitle(`🕵️ ${config.ai.botName} — Help`)
    .setDescription("Here's what I can do:")
    .addFields(
      { name: `/help`,           value: "This message", inline: true },
      { name: `/status`,         value: "Show active modules & license", inline: true },
      { name: `/${config.gif.command}`, value: "Drop a random GIF", inline: true },
    )
    .setFooter({ text: "Powered by Mystery Bot" });

  if (config.modules.chatbot) {
    embed.addFields({
      name: "💬 Chatbot",
      value: config.ai.trigger === "mention"
        ? `@mention me to chat with ${config.ai.botName}`
        : `Say anything in <#${config.ai.channel}> to chat`,
    });
  }

  if (config.modules.buybot || config.modules.sellbot || config.modules.liquidity) {
    embed.addFields({
      name: "📡 Alerts",
      value: "Automatic — watching the chain 24/7",
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { command, execute };
