const Anthropic = require("@anthropic-ai/sdk");
const config = require("../../../config");

let client;

function getClient() {
  if (!client) client = new Anthropic.default({ apiKey: config.ai.anthropicKey });
  return client;
}

async function chat(messages) {
  // Anthropic expects system separately from messages array
  const system = messages.find((m) => m.role === "system")?.content || "";
  const convo  = messages.filter((m) => m.role !== "system");

  const res = await getClient().messages.create({
    model: config.ai.model || "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system,
    messages: convo,
  });
  return res.content[0]?.text?.trim() || "...";
}

module.exports = { chat };
