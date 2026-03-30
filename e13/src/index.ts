import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { onToolCallFinish } from "./hooks.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are a robot controller navigating a 7x5 reactor grid from column 1 to column 7.

After each command, you receive a board state with a "recommended_action" field.
ALWAYS follow the recommended_action exactly. It tells you which command to send next.

Workflow:
1. First call send_command with "start"
2. Read the recommended_action from the result
3. Call send_command with the recommended command (right/left/wait)
4. Repeat until reached_goal is true
5. When reached_goal is true, stop — the mission is complete

IMPORTANT: Do NOT reason about danger yourself. The recommended_action already accounts for block positions and safety. Just follow it.`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Navigate the robot through the reactor to column 7. Start the game now." },
];

for (let i = 0; i < 30; i++) {
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

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const rawResult = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;

        // Hook: transform tool result before it reaches the LLM
        const processed = onToolCallFinish(name, rawResult);

        console.log(`   ✓ ${name} → ${processed.slice(0, 120)}${processed.length > 120 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: processed };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
