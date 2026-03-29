import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: `You are a sensor anomaly detection agent. Execute these tools in order:
1. fetch_data — download and unzip sensor readings
2. analyze_sensors — programmatic validation of all sensor files
3. classify_notes — LLM batch analysis of operator notes for inconsistencies
4. submit_answer — submit the final anomaly list

Call each tool exactly once, in this order, with no arguments. After submit_answer returns, report the server response.`,
  },
  {
    role: "user",
    content: "Run the full sensor anomaly detection pipeline and submit the results.",
  },
];

for (let i = 0; i < 10; i++) {
  console.log(`\n── iteration ${i + 1} ── sending ${messages.length} messages...`);
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no more tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 100)})`);
  }

  const results: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
  for (const tc of msg.tool_calls) {
    if (tc.type !== "function") {
      results.push({ role: "tool", tool_call_id: tc.id, content: `Unsupported: ${tc.type}` });
      continue;
    }
    const { name, arguments: argsStr } = tc.function;
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    try {
      const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
      const resultStr = JSON.stringify(result);
      console.log(`   ✓ ${name} → ${resultStr.slice(0, 120)}${resultStr.length > 120 ? "..." : ""}`);
      results.push({ role: "tool", tool_call_id: tc.id, content: resultStr });
    } catch (err) {
      console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
      results.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${(err as Error).message}` });
    }
  }

  messages.push(...results);
}
