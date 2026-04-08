import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";
import { MODEL, MAX_ITERATIONS } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are a route-planning agent. Your goal: get our messenger to the city of Skolwin via the optimal route on a 10x10 map.

Resources: 10 fuel, 10 food. Different vehicles have different fuel/food costs per step. Walking uses no fuel but more food (slower = longer journey).

Steps:
1. Use toolsearch with various keywords to discover tool endpoints. Try queries like "map", "vehicles". Each search returns max 3 matching tools.

2. Use call_tool to query discovered endpoints. IMPORTANT about how these tools work:
   - Each tool returns max 3 best-matching results per query
   - The tools match on KEYWORDS in your query, not full sentences
   - For /api/wehicles: query with SPECIFIC vehicle names. Known vehicles: rocket, horse, walk, car. Query each one separately, e.g. query="rocket", query="horse", query="walk", query="car"
   - For /api/maps: query with "Skolwin"
   - Keep queries SHORT — one or two words work best

3. Collect ALL data before planning:
   - Full 10x10 grid map
   - All vehicle specs (fuel_per_step, food_per_step for each)
   - Walking food cost per step

4. Once you have all data, call plan_route with structured data.

5. CRITICAL: The map is NON-DETERMINISTIC — it changes each time you query it! If plan_route returns "No feasible path found", the current map layout may be unsolvable. In that case:
   - Call call_tool again with url="/api/maps" query="Skolwin" to get a NEW map
   - Then call plan_route again with the same start/goal coordinates (re-check S and G positions on the new map!)
   - Repeat until a solvable map is found. Do NOT give up!

6. Submit the result with submit_answer.

Important:
- All tools communicate in English only.
- Obstacles: W=water, T=tree, R=river, M=mountain are impassable. S=start, G=goal, .=passable grass.
- Grid is indexed as grid[row][col]. Start/goal coordinates are [x, y] where x=COLUMN index and y=ROW index.
- Example: if S is at row 7, col 0 → start=[0, 7]. If G is at row 4, col 8 → goal=[8, 4].
- Find S and G positions in the grid carefully — count rows (y) and columns (x).
- Pass the grid exactly as received from the API, as a 10x10 array.
- The messenger can exit a vehicle and walk (no returning to vehicle).`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content:
      "Plan the optimal route to Skolwin. Start by discovering available tools with toolsearch, then gather map, vehicles, and movement rules. Finally compute and submit the route.",
  },
];

for (let i = 0; i < MAX_ITERATIONS; i++) {
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
    console.log("\n── no more tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 120)}...)`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
