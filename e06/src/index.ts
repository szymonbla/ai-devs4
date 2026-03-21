import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL, STATIC_PREFIX } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: `You are a cargo classifier agent. Your job:
1. Fetch the CSV list of items using fetch_csv.
2. For each item, call classify_item with a prompt that classifies it as DNG or NEU.
   Rules: weapons/explosives/mines → DNG. Reactor/nuclear/fuel cassette items → NEU. Everything else → NEU.
   IMPORTANT: Use the same static instruction prefix for all calls — only the item id and description change at the end.
   Use this exact static prefix: "${STATIC_PREFIX}"
   Append: \\nItem: {id} - {description}
   IMPORTANT: Call classify_item ONE AT A TIME. Do NOT batch multiple classify_item calls in a single response. Send exactly one classify_item call, wait for the result, then send the next one.
3. Report the flag when received.`,
  },
  { role: "user", content: "Fetch the CSV and classify all items." },
];

for (let i = 0; i < 20; i++) {
  console.log(`\n── iteration ${i + 1} ── sending ${messages.length} messages...`);
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });



  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← ${msg.tool_calls.length} tool call(s)`);

  const results: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];
  for (const tc of msg.tool_calls) {
    if (tc.type !== "function") { results.push({ role: "tool", tool_call_id: tc.id, content: `Unsupported: ${tc.type}` }); continue; }
    const { name, arguments: argsStr } = tc.function;
    const args = JSON.parse(argsStr) as Record<string, unknown>;
    console.log(`   • ${name}(${argsStr.slice(0, 120)})`);
    try {
      const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
      const parsed = typeof result === "string" ? (() => { try { return JSON.parse(result); } catch { return null; } })() : result;
      if (parsed?.code === -923) {
        console.log(`   ⟳ already classified, skipping`);
        results.push({ role: "tool", tool_call_id: tc.id, content: `Already classified. Move on to the next unclassified item.` });
      } else {
        results.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    } catch (err) {
      results.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${(err as Error).message}` });
    }
  }

  messages.push(...results);
}
