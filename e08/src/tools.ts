import type OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const DATA_DIR = resolve(import.meta.dirname, "../data");
const FILTERED_LOG = resolve(DATA_DIR, "filtered.log");
const RESULT_LOG = resolve(DATA_DIR, "result.log");

function grepLogs(keyword: string): string {
  const lines = readFileSync(FILTERED_LOG, "utf-8").split("\n");
  const re = new RegExp(keyword, "i");
  const matches: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) matches.push(lines[i]);
  }
  if (!matches.length) return "No matches found.";

  // Deduplicate by message pattern (strip timestamp), show first/last time + count
  const groups = new Map<string, { first: string; last: string; count: number; severity: string }>();
  for (const line of matches) {
    const ts = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/)?.[1] ?? "";
    const sev = line.match(/\[(WARN|ERRO|CRIT)\]/)?.[1] ?? "";
    // Message is everything after severity tag
    const msg = line.replace(/^\[.*?\]\s*\[.*?\]\s*/, "").trim();
    const key = `${sev}|${msg}`;
    const existing = groups.get(key);
    if (existing) {
      existing.last = ts;
      existing.count++;
    } else {
      groups.set(key, { first: ts, last: ts, count: 1, severity: sev });
    }
  }

  const result: string[] = [];
  for (const [key, g] of groups) {
    const msg = key.split("|").slice(1).join("|");
    const time = g.count > 1 ? `${g.first} .. ${g.last}` : g.first;
    result.push(`[${time}] [${g.severity}] (x${g.count}) ${msg}`);
  }
  return `${matches.length} total matches, ${groups.size} unique patterns:\n${result.join("\n")}`;
}

// ── Main agent tools ──

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_logs",
      description: "Grep filtered failure logs by keyword (case-insensitive regex). Returns matching lines with line numbers.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for in the logs" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_log",
      description: "Replace the entire result log. Lines auto-sorted by timestamp. Format: YYYY-MM-DD HH:MM SEVERITY SUBSYSTEM description",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "Full log content, one entry per line. Format: YYYY-MM-DD HH:MM SEVERITY SUBSYSTEM description" } },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_log",
      description: "Append lines to result log (keeps existing). Auto-sorted after append. Use to add missing subsystem events after feedback.",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "Log lines to append. Format: YYYY-MM-DD HH:MM SEVERITY SUBSYSTEM description" } },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_log",
      description: "Returns the current contents of the result log.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "count_tokens",
      description: "Returns estimated token count of the result log (heuristic: chars / 3.5).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the result log to Centrala for verification. Returns feedback or a flag.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

export function createHandlers(_client: InstanceType<typeof OpenAI>) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    async search_logs({ query }) {
      console.log(`   [search_logs] query: "${query}"`);
      return grepLogs(String(query));
    },

    async set_log({ content }) {
      const lines = String(content).trim().split("\n").filter(Boolean);
      // Auto-sort by timestamp
      lines.sort((a, b) => {
        const ta = a.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        const tb = b.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        return ta.localeCompare(tb);
      });
      const sorted = lines.join("\n") + "\n";
      writeFileSync(RESULT_LOG, sorted);
      const tokens = Math.ceil(sorted.length / 3.5);
      console.log(`   [set_log] ${lines.length} lines, ~${tokens} tokens`);
      return { lines: lines.length, tokens };
    },

    async append_log({ content }) {
      const existing = existsSync(RESULT_LOG) ? readFileSync(RESULT_LOG, "utf-8").trim() : "";
      const allLines = [...existing.split("\n").filter(Boolean), ...String(content).trim().split("\n").filter(Boolean)];
      // Deduplicate by exact match
      const unique = [...new Set(allLines)];
      unique.sort((a, b) => {
        const ta = a.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        const tb = b.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        return ta.localeCompare(tb);
      });
      const sorted = unique.join("\n") + "\n";
      writeFileSync(RESULT_LOG, sorted);
      const tokens = Math.ceil(sorted.length / 3.5);
      console.log(`   [append_log] ${unique.length} lines, ~${tokens} tokens`);
      return { lines: unique.length, tokens };
    },

    async get_current_log() {
      if (!existsSync(RESULT_LOG)) return "(empty)";
      const content = readFileSync(RESULT_LOG, "utf-8").trim();
      return content || "(empty)";
    },

    async count_tokens() {
      if (!existsSync(RESULT_LOG)) return { tokens: 0 };
      const text = readFileSync(RESULT_LOG, "utf-8");
      const tokens = Math.ceil(text.length / 3.5);
      return { tokens, chars: text.length };
    },


    async submit_answer() {
      const logs = existsSync(RESULT_LOG) ? readFileSync(RESULT_LOG, "utf-8").trim() : "";
      const res = await fetch(`${HUB_URL}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey, task: TASK, answer: { logs } }),
      });
      const data = await res.json();
      const text = JSON.stringify(data);
      console.log(`[submit_answer] ${text}`);
      const match = text.match(/\{FLG:[^}]+\}/);
      if (match) console.log("\n*** FLAG:", match[0], "***\n");
      return data;
    },
  };

  return handlers;
}
