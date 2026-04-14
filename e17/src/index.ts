import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM = `You are a wind turbine scheduling agent. Exactly 2 steps:

Step 1: Call prepare_session() — fetches all data, analyzes forecast, generates unlock codes, runs turbinecheck. Returns {configs, turbinecheck}.
Step 2: Call submit_and_done({configs}) — pass the configs object exactly as returned in step 1. Returns flag.

Do nothing else.`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM },
  { role: "user", content: "Start the windpower task now." },
];

for (let i = 0; i < 25; i++) {
  console.log(`\n── iteration ${i + 1} ── (${messages.length} messages)`);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← ${msg.tool_calls.length} tool call(s):`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") {
      console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 120)})`);
    }
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") {
        return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      }
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 150)}${resultStr.length > 150 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
