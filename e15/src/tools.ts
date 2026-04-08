import type OpenAI from "openai";
import { TASK } from "./constants.js";
import { planRoute } from "./planner.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

// Store raw API data for plan_route to use directly
const dataStore: {
  map?: string[][];
  vehicles: Record<string, { fuel_per_step: number; food_per_step: number }>;
} = { vehicles: {} };

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "toolsearch",
      description:
        "Search for available tools/endpoints. Send a natural language query or keywords to discover tools.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query in English" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_tool",
      description:
        "Call a discovered tool endpoint. Provide the full URL and a query. Returns JSON with up to 3 results. For /api/wehicles query each vehicle name separately: rocket, horse, walk, car. For /api/maps query a city name like Skolwin.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL path of the tool (e.g. /api/maps)" },
          query: { type: "string", description: "Query to send (English)" },
        },
        required: ["url", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_route",
      description:
        "Compute optimal route using stored map and vehicle data. Call this AFTER you've fetched the map and all 4 vehicles (rocket, horse, walk, car). Provide start/goal coordinates and walk_food_per_step. The grid is automatically used from the stored API response.",
      parameters: {
        type: "object",
        properties: {
          start: {
            type: "array",
            items: { type: "number" },
            description: "[x, y] of start (x=column, y=row, 0-indexed). Find S on the map.",
          },
          goal: {
            type: "array",
            items: { type: "number" },
            description: "[x, y] of goal (x=column, y=row, 0-indexed). Find G on the map.",
          },
          walk_food_per_step: {
            type: "number",
            description: "Food consumed per step when walking",
          },
        },
        required: ["start", "goal", "walk_food_per_step"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description:
        'Submit the final answer to centrala. The answer should be ["vehicle_name", "dir", "dir", ...].',
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "array",
            items: { type: "string" },
            description: "Route array: [vehicle_name, direction, direction, ...]",
          },
        },
        required: ["answer"],
      },
    },
  },
];

function parseVehicleCosts(note: string): { fuel_per_step: number; food_per_step: number } {
  // Try multiple patterns to be robust
  const fuelMatch = note.match(/[Ff]uel\s+consumption\s+(?:is\s+)?(\d+(?:\.\d+)?)/)
    ?? note.match(/(\d+(?:\.\d+)?)\s+fuel/i);
  const foodMatch = note.match(/[Ff]ood\s+consumption\s+(?:is\s+)?(\d+(?:\.\d+)?)/)
    ?? note.match(/(\d+(?:\.\d+)?)\s+food/i);
  return {
    fuel_per_step: fuelMatch ? parseFloat(fuelMatch[1]) : 0,
    food_per_step: foodMatch ? parseFloat(foodMatch[1]) : 1,
  };
}

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async toolsearch({ query }) {
    const res = await fetch(`${HUB_URL}/api/toolsearch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, query }),
    });
    const data = await res.json();
    console.log(`[toolsearch] query="${query}" → ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  },

  async call_tool({ url, query }) {
    let fullUrl = url as string;
    if (fullUrl.startsWith("/")) fullUrl = `${HUB_URL}${fullUrl}`;
    else if (!fullUrl.startsWith("http")) fullUrl = `${HUB_URL}/${fullUrl}`;

    const res = await fetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, query }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    const dataStr = JSON.stringify(data);
    console.log(`[call_tool] url="${url}" query="${query}" → ${dataStr.slice(0, 500)}`);

    // Auto-store map data (clear previous map first to ensure fresh data)
    if (data.map && Array.isArray(data.map)) {
      dataStore.map = data.map as string[][];
      console.log(`[call_tool] ✓ stored NEW map ${dataStore.map.length}x${dataStore.map[0]?.length}`);
    }

    // Auto-store vehicle data
    if (data.name && data.note && typeof data.note === "string") {
      const name = data.name as string;
      const costs = parseVehicleCosts(data.note);
      dataStore.vehicles[name] = costs;
      console.log(`[call_tool] ✓ stored vehicle "${name}": fuel=${costs.fuel_per_step}, food=${costs.food_per_step}`);
    }

    return data;
  },

  async plan_route(args) {
    const { start, goal, walk_food_per_step } = args as {
      start: [number, number];
      goal: [number, number];
      walk_food_per_step: number;
    };

    if (!dataStore.map) {
      return { answer: [], details: "Error: No map data stored. Call the maps API first." };
    }

    const vehicles = Object.entries(dataStore.vehicles)
      .filter(([name]) => name !== "walk")
      .map(([name, costs]) => ({ name, ...costs }));

    console.log(`[plan_route] Using stored map and ${vehicles.length} vehicles`);
    console.log(`[plan_route] Vehicles: ${JSON.stringify(dataStore.vehicles)}`);

    const result = planRoute({
      grid: dataStore.map,
      start,
      goal,
      vehicles,
      walk_food_per_step: walk_food_per_step ?? dataStore.vehicles.walk?.food_per_step ?? 2,
    });
    return result;
  },

  async submit_answer({ answer }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("\n🚩 Flag:", match[0]);
    return data;
  },
};
