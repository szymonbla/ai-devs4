import fs from "fs";
import nodePath from "path";
import type OpenAI from "openai";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
export const WORKSPACE = nodePath.resolve(import.meta.dirname, "../workspace");

async function callApi(answer: unknown): Promise<unknown> {
  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer }),
  });
  const data = await res.json();
  const text = JSON.stringify(data);
  const flag = text.match(/\{FLG:[^}]+\}/);
  if (flag) console.log("\nFLAG:", flag[0]);
  return data;
}

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "reset",
      description: "Reset warehouse state to initial (clears all orders)",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "HTTP GET a URL (only the configured hub hostname allowed). Returns body as text.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace_file",
      description: "Read a file from workspace/ by relative path (e.g. 'help.json')",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_workspace_file",
      description: "Write (overwrite) a file in workspace/ by relative path. Use to save progress data between steps.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sql_query",
      description: "Execute a read-only SQL query against the warehouse SQLite database. Use 'show tables' to list tables.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_signature",
      description: "Generate SHA1 signature via signatureGenerator. Pass all fields from help.json signatureGenerator schema as direct top-level properties (login, birthday, destination, action, etc.).",
      parameters: {
        type: "object",
        properties: {
          login: { type: "string" },
          birthday: { type: "string" },
          destination: { type: "number" },
          action: { type: "string" },
        },
        additionalProperties: true,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_orders",
      description: "Get list of current warehouse orders",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "create_order",
      description: "Create a new order for a city",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          creatorID: { type: "number" },
          destination: { type: "string" },
          signature: { type: "string" },
        },
        required: ["title", "creatorID", "destination", "signature"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_items",
      description: "Append items to an order in batch mode. items is an object mapping item names to quantities.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Order ID" },
          items: {
            type: "object",
            description: "Map of item name to quantity",
            additionalProperties: { type: "number" },
          },
        },
        required: ["id", "items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_done",
      description: "Submit all orders for final validation and receive flag",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async reset() {
    return callApi({ tool: "reset" });
  },

  async fetch_url({ url }) {
    const u = new URL(String(url));
    const allowedHost = new URL(HUB_URL).hostname;
    if (u.hostname !== allowedHost && !u.hostname.endsWith(`.${allowedHost}`))
      throw new Error("Domain not in whitelist");
    const res = await fetch(String(url));
    return res.text();
  },

  async read_workspace_file({ path: filePath }) {
    const rel = String(filePath).replace(/^workspace\//, "");
    const full = nodePath.resolve(WORKSPACE, rel);
    if (!full.startsWith(WORKSPACE)) throw new Error("Path traversal not allowed");
    return fs.readFileSync(full, "utf8");
  },

  async write_workspace_file({ path: filePath, content }) {
    const rel = String(filePath).replace(/^workspace\//, "");
    const full = nodePath.resolve(WORKSPACE, rel);
    if (!full.startsWith(WORKSPACE)) throw new Error("Path traversal not allowed");
    fs.mkdirSync(nodePath.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(content), "utf8");
    return `Written: ${rel}`;
  },

  async sql_query({ query }) {
    return callApi({ tool: "database", query });
  },

  async generate_signature(args) {
    return callApi({ tool: "signatureGenerator", ...args });
  },

  async get_orders() {
    return callApi({ tool: "orders", action: "get" });
  },

  async create_order({ title, creatorID, destination, signature }) {
    return callApi({ tool: "orders", action: "create", title, creatorID, destination, signature });
  },

  async append_items({ id, items }) {
    return callApi({ tool: "orders", action: "append", id, items });
  },

  async call_done() {
    return callApi({ tool: "done" });
  },
};
