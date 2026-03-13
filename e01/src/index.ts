import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { FILTER_TAG, GENDER, CITY } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: "system",
    content:
      "You are a data analyst. Use tools to: 1) load filtered people, 2) tag their jobs in batches of ~20, " +
      "3) filter for those tagged '" + FILTER_TAG + "', 4) submit the answer.\n" +
      "The submit_answer tool expects an array of {name, surname, gender, born, city, tags}.\n" +
      `Use gender="${GENDER}" and city="${CITY}". Extract birth year from birthDate (YYYY-MM-DD).`,
  },
  {
    role: "user",
    content: "Find all transport workers from the dataset and submit them.",
  },
];

for (let i = 0; i < 15; i++) {
  console.log(`\n── iteration ${i + 1} ── sending ${messages.length} messages...`);
  const response = await client.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no more tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← model wants ${msg.tool_calls.length} tool call(s):`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 120)}${resultStr.length > 120 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
