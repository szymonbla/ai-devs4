import fs from "fs";
import nodePath from "path";
import { TASK } from "./constants.js";
import type OpenAI from "openai";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
export const WORKSPACE = nodePath.resolve(import.meta.dirname, "../workspace");

export async function callApi(answer: unknown): Promise<unknown> {
  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer }),
  });
  return res.json();
}

export function createToolsAndHandlers(actions: string[]): {
  tools: OpenAI.Chat.ChatCompletionTool[];
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
} {
  const stringActions = actions.filter((a) => typeof a === "string");
  const actionProp: Record<string, unknown> =
    stringActions.length > 0
      ? { type: "string", enum: stringActions, description: "API action name" }
      : { type: "string", description: "API action name" };

  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "read_workspace_file",
        description: "Read a file from the workspace directory",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path relative to workspace/ — e.g. 'ops/filesystem/workflow.md' or 'natan_notes/README.md'",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_workspace_dir",
        description: "List files/dirs inside a workspace subdirectory",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path relative to workspace/ (empty string = root)",
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "api_action",
        description:
          "Call Centrala filesystem API with a single operation. Build the answer object exactly as the API expects (see api-capabilities.md). Example: {action:'listDirectory',path:'/'} or {action:'reset'}.",
        parameters: {
          type: "object",
          properties: {
            answer: {
              type: "object",
              description: "Complete answer object sent verbatim to the API",
              properties: { action: actionProp },
              required: ["action"],
            },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "api_batch",
        description:
          "Send multiple filesystem API operations in one request (batch mode). The operations array is sent as the answer.",
        parameters: {
          type: "object",
          properties: {
            operations: {
              type: "array",
              description:
                "Array of operation objects, each with at least 'action'. Example: [{action:'createDirectory',path:'/foo'},{action:'createFile',path:'/foo/bar',content:'...'}]",
              items: {
                type: "object",
                properties: { action: actionProp },
                required: ["action"],
              },
            },
          },
          required: ["operations"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetch_url",
        description: "Fetch a URL — only the configured hub domain allowed",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch" },
          },
          required: ["url"],
          additionalProperties: false,
        },
      },
    },
  ];

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    async read_workspace_file({ path: filePath }) {
      const rel = String(filePath).replace(/^workspace\//, "");
      const full = nodePath.resolve(WORKSPACE, rel);
      if (!full.startsWith(WORKSPACE)) throw new Error("Path traversal not allowed");
      return fs.readFileSync(full, "utf8");
    },

    async list_workspace_dir({ path: dirPath = "" }) {
      const rel = String(dirPath ?? "").replace(/^workspace\//, "");
      const full = nodePath.resolve(WORKSPACE, rel);
      if (!full.startsWith(WORKSPACE)) throw new Error("Path traversal not allowed");
      const entries = fs.readdirSync(full, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    },

    async api_action({ answer }) {
      const action = (answer as Record<string, unknown>)?.action;
      const response = await callApi(answer);
      const text = JSON.stringify(response);
      console.log(`[api:${action}] ${text.slice(0, 400)}`);
      const flag = text.match(/\{FLG:[^}]+\}/);
      if (flag) console.log("\nFLAG:", flag[0]);
      return response;
    },

    async api_batch({ operations }) {
      const ops = Array.isArray(operations) ? operations : [];
      const response = await callApi(ops);
      const text = JSON.stringify(response);
      console.log(`[api_batch:${ops.length}] ${text.slice(0, 400)}`);
      const flag = text.match(/\{FLG:[^}]+\}/);
      if (flag) console.log("\nFLAG:", flag[0]);
      return response;
    },

    async fetch_url({ url }) {
      const u = new URL(String(url));
      const allowedHost = new URL(HUB_URL).hostname;
      if (u.hostname !== allowedHost && !u.hostname.endsWith(`.${allowedHost}`))
        throw new Error("Domain not in whitelist");
      const res = await fetch(String(url));
      return res.text();
    },
  };

  return { tools, handlers };
}
