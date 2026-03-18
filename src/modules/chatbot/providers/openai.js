const { OpenAI } = require("openai");
const config = require("../../../config");

let client;

function getClient() {
  if (!client) client = new OpenAI({ apiKey: config.ai.openaiKey });
  return client;
}

async function chat(messages) {
  const res = await getClient().chat.completions.create({
    model: config.ai.model || "gpt-4o-mini",
    messages,
    max_tokens: 512,
    temperature: 0.8,
  });
  return res.choices[0]?.message?.content?.trim() || "...";
}

module.exports = { chat };
