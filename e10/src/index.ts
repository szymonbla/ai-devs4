import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL, PWR_CODE } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are a drone mission agent. Your mission is to destroy the DAM — NOT the power plant.

The power plant code is ${PWR_CODE}. This is the only known valid destination object ID in the system.

## Mission
Destroy the dam near the power plant. Flood the reactor cooling system with lake water.
- The drone's official destination must be set to ${PWR_CODE} (the power plant) as a cover.
- The landing sector must be overridden to the dam's grid coordinates.
- The dam is identified by intensified blue color on the terrain map.

## Approach
1. Fetch the API docs and analyze the terrain map (do both in parallel).
2. Read the docs carefully to understand required setup before flyToLocation.
3. Submit all instructions in a single call — derive the correct sequence from the docs.
4. Read API error messages and correct iteratively.
5. Use hardReset if errors compound.

Grid indexing starts at 1 (top-left = col 1, row 1).`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Execute the drone mission. Destroy the dam." },
];

for (let i = 0; i < 20; i++) {
  console.log(`\n── iteration ${i + 1} ── (${messages.length} messages in context)`);

  const response = await client.chat.completions.create({
    model: MODEL,
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
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 150)}${resultStr.length > 150 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        const errMsg = `Error: ${(err as Error).message}`;
        console.log(`   ✗ ${name} → ${errMsg}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: errMsg };
      }
    })
  );

  messages.push(...results);
}
