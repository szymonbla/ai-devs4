import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export const tools: Tool[] = [
  {
    definition: {
      type: "function",
      name: "call_zmail",
      description: "Call the zmail mailbox API. Use action='help' first to discover available actions and their parameters.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "API action name (e.g. 'help', 'getInbox', etc.)" },
          params: { type: "object", description: "Additional parameters for the action (e.g. page, id)", additionalProperties: true },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
    handler: async ({ action, params }) => {
      const body = { apikey, action, ...(params as object ?? {}) };
      const res = await fetch(`${HUB_URL}/api/zmail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      const text = JSON.stringify(data);
      console.log(`[zmail] ${text}`);
      return text;
    },
  },
  {
    definition: {
      type: "function",
      name: "submit_answer",
      description: "Submit current best-guess answer to the hub. Hub returns feedback about which fields are correct/incorrect — use it to guide further searching.",
      parameters: {
        type: "object",
        properties: {
          password: { type: "string", description: "Password to the employee system" },
          date: { type: "string", description: "Planned attack date in YYYY-MM-DD format" },
          confirmation_code: { type: "string", description: "Security ticket confirmation code (SEC- followed by 32 characters)" },
        },
        required: ["password", "date", "confirmation_code"],
        additionalProperties: false,
      },
    },
    handler: async ({ password, date, confirmation_code }) => {
      const answer = { password, date, confirmation_code };
      const res = await fetch(`${HUB_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey, task: TASK, answer }),
      });
      const data = await res.json();
      const text = JSON.stringify(data);
      console.log(`[wyślij_odpowiedź] ${text}`);
      const match = text.match(/\{FLG:[^}]+\}/);
      if (match) console.log("\n*** FLAGA:", match[0], "***\n");
      return text;
    },
  },
  {
    definition: {
      type: "function",
      name: "wait",
      description: "Wait for a number of seconds before continuing. Use when inbox appears empty and you expect new messages to arrive.",
      parameters: {
        type: "object",
        properties: {
          seconds: { type: "number", description: "Seconds to wait (max 30)" },
        },
        required: ["seconds"],
        additionalProperties: false,
      },
    },
    handler: async ({ seconds }) => {
      const secs = Math.min(Number(seconds), 30);
      console.log(`[czekaj] czekam ${secs}s...`);
      await new Promise((r) => setTimeout(r, secs * 1000));
      return JSON.stringify({ waited: secs });
    },
  },
];

export const findTool = (name: string): Tool | undefined =>
  tools.find((t) => t.definition.name === name);
