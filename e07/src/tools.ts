import type OpenAI from "openai";
import { TASK } from "./constants.js";
import { getRotationsNeeded } from "./vision.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_rotations_needed",
      description:
        "Fetch current board from server, compare each cell with the target (solved) image, and return how many 90-degree clockwise rotations each cell needs (0-3).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "rotate_field",
      description:
        "Rotate a single field 90 degrees clockwise. One call = one 90-degree rotation.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            description: "Field position in AxB format, e.g. '2x3'.",
          },
        },
        required: ["field"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_board",
      description: "Reset the board to its initial random state.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async get_rotations_needed() {
    const url = `${HUB_URL}/data/${apikey}/electricity.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch board: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    return await getRotationsNeeded(base64);
  },

  async rotate_field({ field }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer: { rotate: field } }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[rotate ${field}] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("\n*** FLAG:", match[0], "***\n");
    return data;
  },

  async reset_board() {
    const url = `${HUB_URL}/data/${apikey}/electricity.png?reset=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Reset failed: ${res.status}`);
    return { message: "Board reset" };
  },
};
