import type OpenAI from "openai";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  // TODO: define tools during implementation
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async submit_answer({ answer }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: "TODO", answer }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return data;
  },
};
