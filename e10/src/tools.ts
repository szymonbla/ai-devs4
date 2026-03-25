import "./env.js";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { TASK, VISION_MODEL, mapAnalysisSchema } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

const DRONE_DOCS_URL = "REDACTED_URL";

const vision = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_drone_docs",
      description: "Fetch the drone API documentation. Call this to understand available commands and the correct instruction format before submitting.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_map",
      description: "Analyze the terrain map image using a vision model to identify the grid sector containing the dam. Returns grid size, dam sector coordinates (1-indexed), and reasoning.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_drone_instructions",
      description: "Submit drone flight instructions to the /verify endpoint. Read error messages carefully and correct the instructions iteratively.",
      parameters: {
        type: "object",
        properties: {
          instructions: {
            type: "array",
            items: { type: "string" },
            description: "Ordered list of drone instruction strings derived from the API docs",
          },
        },
        required: ["instructions"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async fetch_drone_docs() {
    console.log(`[fetch_drone_docs] fetching ${DRONE_DOCS_URL}`);
    const res = await fetch(DRONE_DOCS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("image") || ct.includes("octet-stream")) {
      throw new Error(`fetch_drone_docs got binary content (${ct}) — URL is likely wrong: ${DRONE_DOCS_URL}`);
    }
    const text = await res.text();
    if (text.startsWith("\x89PNG") || text.startsWith("PNG")) {
      throw new Error(`fetch_drone_docs received PNG binary — DRONE_DOCS_URL is wrong: ${DRONE_DOCS_URL}`);
    }
    const limited = text.slice(0, 40000);
    console.log(`[fetch_drone_docs] got ${text.length} chars (returning first ${limited.length})`);
    return limited;
  },

  async analyze_map() {
    const mapUrl = `${HUB_URL}/data/${apikey}/drone.png`;
    console.log(`[analyze_map] analyzing ${mapUrl}`);

    const response = await vision.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this terrain map image. Identify the grid layout and locate the dam.
The dam is marked with an intensified blue color.
Grid is indexed from 1 (top-left is col=1, row=1).`,
            },
            { type: "image_url", image_url: { url: mapUrl } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: mapAnalysisSchema },
    });

    const content = response.choices[0].message.content ?? "";
    console.log(`[analyze_map] raw response: ${content.slice(0, 300)}`);
    return JSON.parse(content);
  },

  async submit_drone_instructions({ instructions }) {
    const body = { apikey, task: TASK, answer: { instructions } };
    console.log(`[submit_drone_instructions] POST instructions:`, JSON.stringify(instructions));
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_drone_instructions] response: ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("*** FLAG:", match[0], "***");
    return data;
  },
};
