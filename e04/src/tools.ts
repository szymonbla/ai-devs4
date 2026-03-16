import type OpenAI from "openai";
import { HUB_URL, MODEL, TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const openrouterKey = process.env.OPENROUTER_API_KEY!;

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch a URL and return the text body. Use for .md and other text files.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_image",
      description: "Fetch an image URL and use vision model to extract all text and data from it.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Image URL to analyze" },
          prompt: { type: "string", description: "What to extract from the image" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_declaration",
      description: "Submit the completed transport declaration to the verification endpoint.",
      parameters: {
        type: "object",
        properties: {
          declaration: { type: "string", description: "The completed declaration text" },
        },
        required: ["declaration"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async fetch_url({ url }) {
    const res = await fetch(url as string);
    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
    const text = await res.text();
    console.log(`[fetch_url] ${url} -> ${text.length} chars`);
    return text;
  },

  async analyze_image({ url, prompt }) {
    const imagePrompt = (prompt as string) ?? "Extract all text, data, and information from this image. Be thorough and precise.";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: imagePrompt },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      }),
    });
    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "No response";
    console.log(`[analyze_image] ${url} -> ${content.slice(0, 200)}`);
    return content;
  },

  async submit_declaration({ declaration }) {
    console.log(`[submit_declaration] Submitting declaration:\n${declaration}`);
    const payload = {
      apikey,
      task: TASK,
      answer: { declaration },
    };
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    console.log(`[submit_declaration] ${JSON.stringify(data)}`);
    return data;
  },
};
