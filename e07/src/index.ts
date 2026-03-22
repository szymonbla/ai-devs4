import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { AGENT_MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are an agent solving a 3x3 electricity grid puzzle.

## Tools
- get_rotations_needed: fetches current board, compares with target, returns rotations per cell (0-3)
- rotate_field: rotates one cell 90° clockwise (one call = one rotation)
- reset_board: resets to random initial state

## Procedure
1. Call reset_board to start fresh
2. Call get_rotations_needed to see how many rotations each cell needs
3. For each cell with rotations > 0, call rotate_field that many times
   Example: if "2x3" needs 2 rotations, call rotate_field("2x3") twice
4. After ALL rotations, call get_rotations_needed again to verify
5. If any cell still needs rotations, apply them
6. Max 5 verify iterations
7. When rotate_field returns a flag {FLG:...}, report it and stop

IMPORTANT: Execute ALL needed rotations before verifying. Do not verify after each single rotation.`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: "Solve the electricity puzzle." },
];

const MAX_ITERATIONS = 50;

for (let i = 0; i < MAX_ITERATIONS; i++) {
  console.log(`\n── iteration ${i + 1} ──`);
  const response = await client.chat.completions.create({
    model: AGENT_MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("── done");
    console.log("Agent:", msg.content);
    break;
  }

  for (const tc of msg.tool_calls) {
    if (tc.type === "function")
      console.log(`   → ${tc.function.name}(${tc.function.arguments.slice(0, 80)})`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function")
        return { role: "tool" as const, tool_call_id: tc.id, content: "unsupported" };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown: ${name}`;
        const s = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${s.slice(0, 200)}${s.length > 200 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: s };
      } catch (err) {
        const e = (err as Error).message;
        console.log(`   ✗ ${name} → ${e}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${e}` };
      }
    })
  );

  messages.push(...results);
}
