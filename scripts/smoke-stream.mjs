const baseUrl = process.env.SABC_BASE_URL ?? "http://localhost:3001";
const startedAt = Date.now();
let status = 0;
let deltaCount = 0;
let firstDeltaMs = null;
let completed = false;

try {
  const response = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "smoke-project",
      projectDescription: "验证流式访谈是否可以立即显示内容。",
      messages: [
        {
          id: "smoke-user-1",
          role: "user",
          content: "这是一次流式聊天冒烟测试，请简短追问一个问题。",
          round: 0,
        },
      ],
      interviewDepth: "medium",
      round: 0,
    }),
  });
  status = response.status;
  if (!response.ok || !response.body) {
    printResult({ status, deltaCount, firstDeltaMs, completed });
    process.exit(1);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let frame = takeFrame(buffer);
    while (frame) {
      buffer = frame.rest;
      for (const line of frame.value.split(/\r?\n/u)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        try {
          const event = JSON.parse(data);
          if (
            event?.type === "assistant_delta" &&
            typeof event.delta === "string" &&
            event.delta.length > 0
          ) {
            deltaCount += 1;
            firstDeltaMs ??= Date.now() - startedAt;
          }
          if (
            event?.type === "complete" &&
            typeof event.content === "string" &&
            event.content.length > 0
          ) {
            completed = true;
          }
        } catch {
          // A malformed app frame makes completion fail without exposing its body.
        }
      }
      frame = takeFrame(buffer);
    }
    if (done) break;
  }

  printResult({ status, deltaCount, firstDeltaMs, completed });
  if (deltaCount === 0 || !completed) process.exit(1);
} catch {
  printResult({ status, deltaCount, firstDeltaMs, completed });
  process.exit(1);
}

function takeFrame(buffer) {
  const match = /\r?\n\r?\n/u.exec(buffer);
  if (!match || match.index === undefined) return null;
  return {
    value: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

function printResult(result) {
  console.log(JSON.stringify(result));
}
