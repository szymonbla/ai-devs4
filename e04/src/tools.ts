import type OpenAI from "openai";
import { HUB_URL, MODEL, TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const openrouterKey = process.env.OPENROUTER_API_KEY!;

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp)$/i;

async function visionAnalyze(url: string, prompt: string): Promise<string> {
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
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    }),
  });
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "No response";
}

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a URL and return its content. For text files returns the body. For image files (png/jpg/etc) automatically runs vision analysis and returns extracted text/data. Returns a media reference with the original URL so you can re-analyze if needed.",
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
      description:
        "Analyze an image URL with a vision model. Use when you need to extract specific information from an image, or re-analyze an image with a targeted prompt.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Image URL to analyze" },
          prompt: {
            type: "string",
            description: "Specific question or extraction instruction for the image",
          },
        },
        required: ["url", "prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_declaration",
      description:
        "Submit the completed transport declaration to the verification endpoint. The declaration must be the full formatted text matching the official template.",
      parameters: {
        type: "object",
        properties: {
          declaration: {
            type: "string",
            description: "The completed declaration text, formatted exactly as the official template",
          },
        },
        required: ["declaration"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async fetch_url({ url }) {
    const urlStr = url as string;

    // Auto-detect images by extension and run vision analysis
    if (IMAGE_EXTENSIONS.test(urlStr)) {
      console.log(`[fetch_url] ${urlStr} -> detected as image, running vision analysis`);
      const analysis = await visionAnalyze(
        urlStr,
        "Extract ALL text, data, tables, route codes, and information from this image. Be thorough and precise. Reproduce any tables exactly.",
      );
      console.log(`[fetch_url/vision] ${urlStr} -> ${analysis.slice(0, 200)}`);
      return `<media url="${urlStr}" type="image" />\n\nVision analysis:\n${analysis}`;
    }

    const res = await fetch(urlStr);
    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;

    // Check content-type for images served without image extension
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) {
      console.log(`[fetch_url] ${urlStr} -> content-type ${contentType}, running vision analysis`);
      const analysis = await visionAnalyze(
        urlStr,
        "Extract ALL text, data, tables, route codes, and information from this image. Be thorough and precise. Reproduce any tables exactly.",
      );
      console.log(`[fetch_url/vision] ${urlStr} -> ${analysis.slice(0, 200)}`);
      return `<media url="${urlStr}" type="image" />\n\nVision analysis:\n${analysis}`;
    }

    const text = await res.text();
    console.log(`[fetch_url] ${urlStr} -> ${text.length} chars`);
    return text;
  },

  async analyze_image({ url, prompt }) {
    const urlStr = url as string;
    const promptStr =
      (prompt as string) ??
      "Extract all text, data, and information from this image. Be thorough and precise.";
    console.log(`[analyze_image] ${urlStr} prompt: ${promptStr.slice(0, 100)}`);
    const content = await visionAnalyze(urlStr, promptStr);
    console.log(`[analyze_image] ${urlStr} -> ${content.slice(0, 200)}`);
    return `<media url="${urlStr}" type="image" />\n\n${content}`;
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
