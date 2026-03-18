require("dotenv").config();

const required = (key) => {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  return process.env[key];
};

const optional = (key, fallback = "") => process.env[key] || fallback;
const bool = (key, fallback = false) =>
  process.env[key] ? process.env[key].toLowerCase() === "true" : fallback;

module.exports = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: optional("DISCORD_GUILD_ID"),
  },

  license: {
    key: optional("LICENSE_KEY"),
    apiUrl: optional("LICENSE_API_URL"), // https://your-dashboard.com
    signingSecret: optional("LICENSE_SIGNING_SECRET"), // for signature verification
  },

  modules: {
    gifbot:    bool("ENABLE_GIFBOT", true),
    chatbot:   bool("ENABLE_CHATBOT", false),
    buybot:    bool("ENABLE_BUYBOT", false),
    sellbot:   bool("ENABLE_SELLBOT", false),
    liquidity: bool("ENABLE_LIQUIDITY", false),
  },

  ai: {
    provider: optional("AI_PROVIDER", "groq"),
    model:    optional("AI_MODEL", "llama-3.3-70b-versatile"),
    groqKey:       optional("GROQ_API_KEY"),
    openaiKey:     optional("OPENAI_API_KEY"),
    anthropicKey:  optional("ANTHROPIC_API_KEY"),
    botName:    optional("BOT_NAME", "Assistant"),
    persona:    optional("BOT_PERSONA", "You are a helpful Discord bot."),
    channel:    optional("CHATBOT_CHANNEL", "all"),
    trigger:    optional("CHATBOT_TRIGGER", "mention"),
  },

  chain: {
    source:           optional("CHAIN_SOURCE", "blockfrost"),
    blockfrostId:     optional("BLOCKFROST_PROJECT_ID"),
    blockfrostNet:    optional("BLOCKFROST_NETWORK", "mainnet"),
    tapToolsKey:      optional("TAPTOOLS_API_KEY"),
    policyId:         optional("TOKEN_POLICY_ID"),
    tokenName:        optional("TOKEN_NAME"),
    ticker:           optional("TOKEN_TICKER", "$TOKEN"),
    buyMinAda:        parseInt(optional("BUY_MIN_ADA", "10")),
    pollInterval:     parseInt(optional("POLL_INTERVAL", "30")),
    buyChannel:       optional("BUY_ALERT_CHANNEL"),
    sellChannel:      optional("SELL_ALERT_CHANNEL"),
    liquidityChannel: optional("LIQUIDITY_ALERT_CHANNEL"),
  },

  gif: {
    source:   optional("GIF_SOURCE", "local"),
    path:     optional("GIF_PATH", "./gifs"),
    command:  optional("GIF_COMMAND", "gif"),
    channels: optional("GIF_CHANNELS", "all"),
  },
};
