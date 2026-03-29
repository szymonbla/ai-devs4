import type OpenAI from "openai";
import { TASK, SHELL_URL } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

const BLOCKED_PATHS = new Set(["/etc", "/root", "/proc"]);

function isBlocked(cmd: string): string | null {
  for (const p of BLOCKED_PATHS) {
    if (cmd.includes(p)) return p;
  }
  return null;
}

function learnGitignore(output: string, cwd = "") {
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const full = line.startsWith("/") ? line : `${cwd}/${line}`.replace(/\/+/g, "/");
    BLOCKED_PATHS.add(full.replace(/\/$/, ""));
  }
}

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "shell",
      description: "Execute a command on the remote virtual machine via the shell API. Start with 'help' to see available commands.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "The command to execute on the remote VM" },
        },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the ECCS code to headquarters once you have it.",
      parameters: {
        type: "object",
        properties: {
          confirmation: { type: "string", description: "The ECCS-xxxxxxxx code obtained from running cooler.bin" },
        },
        required: ["confirmation"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async shell({ cmd }) {
    const blocked = isBlocked(cmd as string);
    if (blocked) return `BLOCKED: access to '${blocked}' is forbidden by security policy`;

    try {
      const res = await fetch(SHELL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey, cmd }),
      });
      if (!res.ok) {
        const text = await res.text();
        return `HTTP ${res.status}: ${text}`;
      }
      const data = await res.json();

      // Auto-learn gitignore entries from any .gitignore read
      const cmdStr = cmd as string;
      if (cmdStr.includes(".gitignore")) {
        const output = typeof data === "string" ? data : JSON.stringify(data);
        const cwdMatch = cmdStr.match(/(?:^|[\s;])(?:cd|cat)\s+([\w./~-]+)/);
        learnGitignore(output, cwdMatch?.[1] ?? "");
        console.log(`[shell] learned gitignore entries, blocked now: ${[...BLOCKED_PATHS].join(", ")}`);
      }

      return data;
    } catch (err) {
      return `Network error: ${(err as Error).message}`;
    }
  },

  async submit_answer({ confirmation }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer: { confirmation } }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return data;
  },
};
