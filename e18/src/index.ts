import "./env.js";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import OpenAI from "openai";
import { tools, handlers, prefetch, getRemainingPoints } from "./tools.js";
import { MODEL } from "./constants.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const WORKSPACE = resolve(import.meta.dirname, "../workspace");
const HELP_PATH = `${WORKSPACE}/help.json`;
const MAP_PATH = `${WORKSPACE}/map.json`;

type MapResponse = {
  map: {
    size: number;
    tiles: Record<string, { label: string; symbol: string }>;
    grid: string[][];
  };
};

const COL = "ABCDEFGHIJK";

function coord(col: number, row: number) {
  return `${COL[col]}${row + 1}`;
}

function analyzeMap(data: MapResponse): string {
  const { grid, tiles, size } = data.map;

  // symbol → type name
  const symToType = Object.fromEntries(
    Object.entries(tiles).map(([type, { symbol }]) => [symbol, type]),
  );

  // find symbol for each type
  const roadSym = tiles["road"]?.symbol ?? "UL";

  // collect roads and B3 tiles
  const roads: string[] = [];
  const b3tiles: string[] = [];
  // find tallest block by floor count in label (e.g. "Blok 3p" = 3 floors)
  const blocksByFloors = Object.values(tiles)
    .map(({ symbol, label }) => ({
      symbol,
      floors: parseInt(label.match(/(\d+)p/i)?.[1] ?? "0"),
    }))
    .filter(({ floors }) => floors > 0)
    .sort((a, b) => b.floors - a.floors);
  const maxFloors = blocksByFloors[0]?.floors ?? 0;
  const tallSymbols = new Set(
    blocksByFloors.filter((b) => b.floors === maxFloors).map((b) => b.symbol),
  );

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const type = grid[r][c];
      const sym = tiles[type]?.symbol;
      if (sym === roadSym) roads.push(coord(c, r));
      if (tallSymbols.has(sym ?? "")) b3tiles.push(coord(c, r));
    }
  }

  // find roads adjacent to each B3 tile (within 1 step orthogonally)
  const roadSet = new Set(roads);
  const adjacentRoads = new Map<string, string[]>();
  for (const b3 of b3tiles) {
    const c = COL.indexOf(b3[0]);
    const r = parseInt(b3.slice(1)) - 1;
    const neighbors = [
      coord(c - 1, r),
      coord(c + 1, r),
      coord(c, r - 1),
      coord(c, r + 1),
    ];
    const adj = neighbors.filter((n) => roadSet.has(n));
    if (adj.length) adjacentRoads.set(b3, adj);
  }

  // group B3 tiles into clusters (connected components)
  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const b3 of b3tiles) {
    if (visited.has(b3)) continue;
    const cluster: string[] = [];
    const queue = [b3];
    while (queue.length) {
      const cur = queue.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      cluster.push(cur);
      const c = COL.indexOf(cur[0]);
      const r = parseInt(cur.slice(1)) - 1;
      for (const nb of [
        coord(c - 1, r),
        coord(c + 1, r),
        coord(c, r - 1),
        coord(c, r + 1),
      ]) {
        if (b3tiles.includes(nb) && !visited.has(nb)) queue.push(nb);
      }
    }
    clusters.push(cluster);
  }

  const lines: string[] = [
    `TALLEST BLOCK TILES — ${b3tiles.length} total (partisan is in one of these):`,
  ];
  clusters.forEach((cluster, i) => {
    const perTile = cluster.map((t) => {
      const adj = adjacentRoads.get(t) ?? [];
      // cost to reach this B3 tile: drive transporter to adjacent road (cheap) + scout walks 1 tile (7 pts) + inspect (1 pt)
      const reachable = adj.length > 0;
      return `${t}→drop@${adj[0] ?? "?"}(scout walks 1 tile=8pts)`;
    });
    const nearRoads = [
      ...new Set(cluster.flatMap((t) => adjacentRoads.get(t) ?? [])),
    ];
    lines.push(`  Cluster ${i + 1} [drop zones: ${nearRoads.join(", ")}]:`);
    lines.push(`    ${perTile.join("  ")}`);
  });
  lines.push(
    ``,
    `MOVEMENT COST RULE: transporter=1pt/tile (cheap), scout on foot=7pt/tile (expensive).`,
    `ALWAYS drive transporter to the road tile adjacent to target B3, then dismount scout for 1-tile walk.`,
    `NEVER send scouts walking more than 1-2 tiles.`,
    ``,
    `ROAD TILES: ${roads.join(", ")}`,
  );

  return lines.join("\n");
}

// Pre-fetch: help + reset + map (cache on disk)
let helpData: unknown;
let mapData: unknown;

const forceRefresh = process.argv.includes("--refresh");

if (!forceRefresh && existsSync(HELP_PATH) && existsSync(MAP_PATH)) {
  console.log("── loading cached help + map from workspace/");
  helpData = JSON.parse(readFileSync(HELP_PATH, "utf-8"));
  mapData = JSON.parse(readFileSync(MAP_PATH, "utf-8"));
} else {
  console.log("── fetching help + map from API");
  const { help, map } = await prefetch();
  helpData = help;
  mapData = map;
  writeFileSync(HELP_PATH, JSON.stringify(help, null, 2));
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
  console.log("── saved to workspace/");
}

const systemPrompt = `You are commanding a search-and-rescue operation in the ruined city of Domatowo.

MISSION: Find a partisan hiding in one of the B3 (3-floor = tallest) blocks and call helicopter for evacuation.

COSTS (action points):
- create scout: 5 | create transporter: 5 + 5×passengers
- move scout (on foot): 7 per tile — EXPENSIVE, minimize walking
- move transporter (road only): 1 per tile — CHEAP
- dismount: 0 | inspect (scout must be ON the tile): 1

CRITICAL RULES:
- DRIVER ARITHMETIC: transporter created with passengers=3 means 3 scouts inside. You may ONLY ever dismount 2 (keep 1 driver). Never call dismount with passengers=3 or the transporter is permanently stuck.
- Scouts CANNOT re-board after dismounting — once out, they walk forever
- Walk scouts MAXIMUM 1 tile to their target B3, then inspect
- NEVER call reset after the mission has started — reset rerolls the partisan position and wastes 20+ points
- After each action, check "action_points_left" in the server response — trust the server

MAP ANALYSIS (auto-computed from current map):
${analyzeMap(mapData as MapResponse)}

STRATEGY:
1. Create transporter with passengers=3 → you have 3 scouts total, 1 must ALWAYS stay as driver
2. Drive to road adjacent to first B3 cluster
3. Dismount passengers=2 (keep 1 driver!) → 2 scouts walk 1 tile each to B3 tiles, inspect
4. Drive transporter to next cluster's road tile, dismount passengers=1 → scout walks 1 tile, inspect
5. Keep repeating until all B3 tiles inspected or partisan found
6. When ANY inspect log mentions człowiek/człowieka/human/person → call_helicopter immediately with that coordinate

API REFERENCE (key params):
- create: type="transporter"|"scout", passengers=N
- move: object=<hash>, where=<coord e.g. "F6">
- dismount: object=<transporter_hash>, passengers=N  ← MAX passengers=(crew_count - 1)
- inspect: object=<scout_hash>
- getObjects, getLogs, searchSymbol (symbol="XX"), callHelicopter (destination=<coord>)`;

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: systemPrompt },
  {
    role: "user",
    content:
      "Begin the operation. Analyze the map, plan your route, and find the partisan.",
  },
];

let consecutiveNoTools = 0;

for (let i = 0; i < 60; i++) {
  console.log(
    `\n── iteration ${i + 1} ── remaining points: ${getRemainingPoints()} ── messages: ${messages.length}`,
  );
  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    consecutiveNoTools++;
    console.log(`\n── no tool calls (${consecutiveNoTools}/2)`);
    if (msg.content) console.log("Agent:", msg.content);
    // only stop if agent stops twice in a row — avoids premature exit on reasoning turns
    if (consecutiveNoTools >= 2) break;
    // push nudge to keep going
    messages.push({
      role: "user",
      content:
        "Continue the operation. Keep making tool calls until the mission is complete.",
    });
    continue;
  }
  consecutiveNoTools = 0;

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function")
      console.log(
        `   • ${tc.function.name}(${tc.function.arguments.slice(0, 120)})`,
      );
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function")
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: `Unsupported: ${tc.type}`,
        };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result =
          (await handlers[name]?.(args)) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(
          `   ✓ ${name} → ${resultStr.slice(0, 150)}${resultStr.length > 150 ? "..." : ""}`,
        );
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: resultStr,
        };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: `Error: ${(err as Error).message}`,
        };
      }
    }),
  );

  messages.push(...results);
}
