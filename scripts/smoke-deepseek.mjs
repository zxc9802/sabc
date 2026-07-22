const endpoint = process.env.DEEPSEEK_API_ENDPOINT;
const model = process.env.DEEPSEEK_MODEL;
const apiKey = process.env.DEEPSEEK_API_KEY;

if (!endpoint || !model || !apiKey) {
  console.error("Missing DEEPSEEK_API_ENDPOINT, DEEPSEEK_MODEL, or DEEPSEEK_API_KEY.");
  process.exit(1);
}

try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Only return a json object." },
        { role: "user", content: "Return {\"ok\":true}." },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      stream: false,
    }),
  });

  if (!response.ok) {
    console.error(JSON.stringify({ status: response.status, validJson: false }));
    process.exit(1);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  let validJson = false;
  if (typeof content === "string") {
    try {
      JSON.parse(content);
      validJson = true;
    } catch {
      validJson = false;
    }
  }

  console.log(JSON.stringify({ status: response.status, validJson }));
  if (!validJson) process.exit(1);
} catch {
  console.error(JSON.stringify({ status: 0, validJson: false }));
  process.exit(1);
}
