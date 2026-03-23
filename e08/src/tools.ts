import type OpenAI from "openai";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { TASK, SUBAGENT_MODEL, SUBAGENT_MAX_ITERATIONS } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const DATA_DIR = resolve(import.meta.dirname, "../data");
const FILTERED_LOG = resolve(DATA_DIR, "filtered.log");
const RESULT_LOG = resolve(DATA_DIR, "result.log");

// ── Subagent for searching logs ──

const subagentTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "grep_logs",
      description: "Regex search over filtered.log. Returns matching lines with line numbers.",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string", description: "Keyword or regex pattern to search for (case-insensitive)" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_lines",
      description: "Read a range of lines from filtered.log (1-indexed).",
      parameters: {
        type: "object",
        properties: {
          from: { type: "number", description: "Start line (1-indexed, inclusive)" },
          to: { type: "number", description: "End line (1-indexed, inclusive)" },
        },
        required: ["from", "to"],
      },
    },
  },
];

const subagentHandlers: Record<string, (args: Record<string, unknown>) => string> = {
  grep_logs({ keyword }) {
    const lines = readFileSync(FILTERED_LOG, "utf-8").split("\n");
    const re = new RegExp(String(keyword), "i");
    const matches: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) matches.push(`${i + 1}: ${lines[i]}`);
    }
    if (!matches.length) return "No matches found.";
    return matches.slice(0, 50).join("\n") + (matches.length > 50 ? `\n... (${matches.length} total)` : "");
  },

  read_lines({ from, to }) {
    const lines = readFileSync(FILTERED_LOG, "utf-8").split("\n");
    const start = Math.max(0, Number(from) - 1);
    const end = Math.min(lines.length, Number(to));
    return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
  },
};

async function runSubagent(client: InstanceType<typeof OpenAI>, query: string): Promise<string> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a log search assistant. You have access to a pre-filtered failure log file.
Use grep_logs to find lines matching keywords, and read_lines to get context around matches.
Search thoroughly for all events related to the user's query. Return ALL relevant log lines you find, preserving their original format.`,
    },
    { role: "user", content: query },
  ];

  for (let i = 0; i < SUBAGENT_MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: SUBAGENT_MODEL,
      messages,
      tools: subagentTools,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return msg.content ?? "No results found.";
    }

    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      const result = subagentHandlers[tc.function.name]?.(args) ?? "Unknown tool";
      console.log(`      [subagent] ${tc.function.name}(${JSON.stringify(args).slice(0, 60)}) → ${result.split("\n").length} lines`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  for (let j = messages.length - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role === "assistant" && "content" in m && m.content) return m.content as string;
  }
  return "Subagent reached iteration limit.";
}

// ── Main agent tools ──

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_logs",
      description: "Search the filtered failure logs using a subagent. Provide a natural language query describing what events/subsystems you're looking for.",
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
      description: "Replace the entire result log with the given content. Lines will be auto-sorted by timestamp. Each line: [YYYY-MM-DD HH:MM] [SEVERITY] SUBSYSTEM description",
      parameters: {
        type: "object",
        properties: { content: { type: "string", description: "Full log content, one entry per line, each starting with [YYYY-MM-DD HH:MM]" } },
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

export function createHandlers(client: InstanceType<typeof OpenAI>) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    async search_logs({ query }) {
      console.log(`   [search_logs] query: "${query}"`);
      const result = await runSubagent(client, String(query));
      return result;
    },

    async set_log({ content }) {
      const lines = String(content).trim().split("\n").filter(Boolean);
      // Auto-sort by timestamp
      lines.sort((a, b) => {
        const ta = a.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        const tb = b.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? "";
        return ta.localeCompare(tb);
      });
      const sorted = lines.join("\n") + "\n";
      writeFileSync(RESULT_LOG, sorted);
      const tokens = Math.ceil(sorted.length / 3.5);
      console.log(`   [set_log] ${lines.length} lines, ~${tokens} tokens`);
      return { lines: lines.length, tokens };
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
