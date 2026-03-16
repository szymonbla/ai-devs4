---
name: scaffold-exercise
description: Creates file structure for a new exercise (e.g. e03/) matching e01/e02 patterns — package.json, tsconfig, env, agent loop, tools skeleton. Use when user wants to create, scaffold, or set up a new exercise directory.
---

# Scaffold Exercise

## Quick start

```
/scaffold-exercise e03
```

Creates `e03/` with all boilerplate files, ready for plan-based implementation.

## Workflow

1. **Determine exercise ID** — from argument (e.g. `e03`) or next available `eXX/`
2. **Ask** — exercise name/task, model to use, any known API endpoints or data sources
3. **Create files** in order below
4. **Run `pnpm install`** in the new directory
5. **Report** — list created files

## Files to create

```
eXX/
├── package.json        # from TEMPLATES — update "name" field
├── tsconfig.json       # extends ../tsconfig.base.json
├── data/               # empty dir (touch data/.gitkeep)
├── src/
│   ├── env.ts          # dotenv loader (identical every time)
│   ├── constants.ts    # exercise-specific constants (stub)
│   ├── tools.ts        # tools array + handlers map (stub)
│   └── index.ts        # agent loop (from template)
```

## Templates

### package.json
```json
{
  "name": "eXX",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "dotenv": "^16.4.0",
    "openai": "^6.27.0"
  },
  "devDependencies": {
    "@types/node": "^25.4.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
```

### tsconfig.json
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

### src/env.ts
```ts
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(import.meta.dirname, "../../.env") });
```

### src/constants.ts
```ts
// Exercise-specific constants — fill during implementation
export const TASK = "TODO";
export const MODEL = "openai/gpt-4o-mini";
```

### src/tools.ts
```ts
import type OpenAI from "openai";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = "REDACTED_HUB_URL";

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
```

### src/index.ts
```ts
import "./env.js";
import OpenAI from "openai";
import { tools, handlers } from "./tools.js";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: "system", content: "TODO: system prompt" },
  { role: "user", content: "TODO: user prompt" },
];

for (let i = 0; i < 15; i++) {
  console.log(`\n── iteration ${i + 1} ── sending ${messages.length} messages...`);
  const response = await client.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages,
    tools,
    tool_choice: "auto",
  });

  const msg = response.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) {
    console.log("\n── no more tool calls → done");
    console.log("Agent:", msg.content);
    break;
  }

  console.log(`← model wants ${msg.tool_calls.length} tool call(s)`);
  for (const tc of msg.tool_calls) {
    if (tc.type === "function") console.log(`   • ${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`);
  }

  const results = await Promise.all(
    msg.tool_calls.map(async (tc) => {
      if (tc.type !== "function") return { role: "tool" as const, tool_call_id: tc.id, content: `Unsupported: ${tc.type}` };
      const { name, arguments: argsStr } = tc.function;
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      try {
        const result = await handlers[name]?.(args) ?? `Unknown tool: ${name}`;
        const resultStr = JSON.stringify(result);
        console.log(`   ✓ ${name} → ${resultStr.slice(0, 120)}${resultStr.length > 120 ? "..." : ""}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: resultStr };
      } catch (err) {
        console.log(`   ✗ ${name} → Error: ${(err as Error).message}`);
        return { role: "tool" as const, tool_call_id: tc.id, content: `Error: ${(err as Error).message}` };
      }
    })
  );

  messages.push(...results);
}
```

## Rules

- Always replace `eXX` with actual exercise ID in package.json name
- Replace `TODO` markers in constants.ts, tools.ts, index.ts — these are implementation targets for run-plan
- Only add `csv-parse` dep if exercise uses CSV data (ask first)
- Do not add data files — those come during implementation
- Run `pnpm install` after creating files
