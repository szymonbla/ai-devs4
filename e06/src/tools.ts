import type OpenAI from "openai";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_csv",
      description: "Fetch the list of items to classify from the hub. Returns CSV with id and description columns.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "classify_item",
      description:
        "Submit a classifier prompt for a single item to the hub. The hub runs the prompt through its internal model and returns whether the classification was correct. " +
        "The prompt must be ≤100 tokens total (including the item id and description). " +
        "Keep the static instructions at the start and the dynamic item data at the end to maximize cache hit across calls.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Full prompt with item id and description substituted in. Must end with the item data.",
          },
        },
        required: ["prompt"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async fetch_csv() {
    const res = await fetch(`${HUB_URL}/data/${apikey}/categorize.csv`);
    const text = await res.text();
    console.log(`[fetch_csv] ${text.split("\n").length - 1} items`);
    return text;
  },

  async classify_item({ prompt }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer: { prompt } }),
    });
    const data = await res.json() as Record<string, unknown>;
    const text = JSON.stringify(data);
    console.log(`[classify_item] ${text.slice(0, 200)}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return data;
  },
};
