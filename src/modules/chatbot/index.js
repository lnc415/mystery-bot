/**
 * Chatbot Module
 * ─────────────────────────────────────────────────────────────────
 * Routes messages through a configurable AI provider (Groq / OpenAI
 * / Anthropic). Keeps a per-user conversation history (last 10 turns)
 * so the bot has context. Trigger: @mention or any message in channel.
 * ─────────────────────────────────────────────────────────────────
 */

const { Events } = require("discord.js");
const config     = require("../../config");

// Conversation history: userId → [{role, content}]
const history = new Map();
const MAX_HISTORY = 10;

function getProvider() {
  switch (config.ai.provider) {
    case "openai":    return require("./providers/openai");
    case "anthropic": return require("./providers/anthropic");
    default:          return require("./providers/groq");
  }
}

function buildMessages(userId, userMessage) {
  const system = {
    role: "system",
    content: `${config.ai.persona}\n\nYour name is ${config.ai.botName}. Keep responses under 200 words. Never give financial advice. Be fun and in-character.`,
  };

  const userHistory = history.get(userId) || [];
  userHistory.push({ role: "user", content: userMessage });

  // Trim to max history (pairs of user+assistant)
  while (userHistory.length > MAX_HISTORY * 2) userHistory.shift();

  history.set(userId, userHistory);
  return [system, ...userHistory];
}

function shouldRespond(message) {
  // Never respond to bots
  if (message.author.bot) return false;

  // Channel filter
  if (config.ai.channel !== "all" && message.channelId !== config.ai.channel)
    return false;

  // Trigger mode
  if (config.ai.trigger === "mention") {
    return message.mentions.has(message.client.user);
  }

  return true;
}

/**
 * Register this module's event listener on the Discord client.
 * @param {import("discord.js").Client} client
 */
function register(client) {
  const provider = getProvider();
  console.log(`[Chatbot] Active — provider: ${config.ai.provider}, model: ${config.ai.model}`);

  client.on(Events.MessageCreate, async (message) => {
    if (!shouldRespond(message)) return;

    // Strip the @mention from the message content
    const content = message.content
      .replace(/<@!?\d+>/g, "")
      .trim();

    if (!content) return;

    try {
      await message.channel.sendTyping();
      const messages = buildMessages(message.author.id, content);
      const reply    = await provider.chat(messages);

      // Append assistant reply to history
      const userHistory = history.get(message.author.id) || [];
      userHistory.push({ role: "assistant", content: reply });
      history.set(message.author.id, userHistory);

      await message.reply(reply);
    } catch (err) {
      console.error("[Chatbot] Error:", err.message);
      await message.reply("My magnifying glass broke. Try again in a sec.").catch(() => {});
    }
  });
}

module.exports = { register };
