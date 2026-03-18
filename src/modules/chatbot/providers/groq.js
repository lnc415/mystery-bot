const Groq = require("groq-sdk");
const config = require("../../../config");

let client;

function getClient() {
  if (!client) client = new Groq({ apiKey: config.ai.groqKey });
  return client;
}

/**
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function chat(messages) {
  const res = await getClient().chat.completions.create({
    model: config.ai.model || "llama-3.3-70b-versatile",
    messages,
    max_tokens: 512,
    temperature: 0.8,
  });
  return res.choices[0]?.message?.content?.trim() || "...";
}

module.exports = { chat };
