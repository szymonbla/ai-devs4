import type OpenAI from "openai";
import { TASK } from "./constants.js";
import costs from "../workspace/costs.json" with { type: "json" };
import helpJson from "../workspace/help.json" with { type: "json" };

type HelpAction = {
  action: string;
  description: string;
  params: Record<string, string> | [];
};

function buildApiDescription(): string {
  const actions = (helpJson as { actions: HelpAction[] }).actions;
  const lines = [
    "Call a Domatowo API action. Pass action params inside the `params` object.\n\nACTIONS:",
  ];
  for (const a of actions) {
    const hasParams =
      !Array.isArray(a.params) && Object.keys(a.params).length > 0;
    const paramStr = hasParams
      ? `params: ${JSON.stringify(a.params)}`
      : "no params";
    lines.push(`  ${a.action} — ${a.description} | ${paramStr}`);
  }
  lines.push(
    '\nEXAMPLE: {"action":"create","params":{"type":"transporter","passengers":3}}',
  );
  lines.push(
    'EXAMPLE: {"action":"move","params":{"object":"<hash>","where":"F6"}}',
  );
  lines.push(
    'EXAMPLE: {"action":"inspect","params":{"object":"<scout_hash>"}}',
  );
  return lines.join("\n");
}

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

let remainingPoints = costs.budget;

function spend(points: number) {
  remainingPoints -= points;
  console.log(`   [points] spent ${points}, remaining ${remainingPoints}`);
}

export function getRemainingPoints() {
  return remainingPoints;
}

async function hubCall(answer: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer }),
  });
  return res.json();
}

export async function prefetch(): Promise<{ help: unknown; map: unknown }> {
  console.log("── pre-fetch: help");
  const help = await hubCall({ action: "help" });
  console.log("── pre-fetch: reset");
  await hubCall({ action: "reset" }).catch(() => null);
  console.log("── pre-fetch: getMap");
  const map = await hubCall({ action: "getMap" });
  return { help, map };
}

// --- cost estimation for known actions ---
function estimateCost(action: string, params: Record<string, unknown>): number {
  switch (action) {
    case "create": {
      if (params.type === "scout") return costs.costs.create_scout;
      const p = (params.passengers as number) ?? 0;
      return (
        costs.costs.create_transporter_base +
        p * costs.costs.create_transporter_per_passenger
      );
    }
    case "inspect":
      return costs.costs.inspect;
    case "dismount":
      return costs.costs.drop_scouts;
    default:
      return 0;
  }
}

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "call_api",
      description: buildApiDescription(),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "API action name",
          },
          params: {
            type: "object",
            description:
              "Action parameters as key-value pairs matching the API spec",
            additionalProperties: true,
          },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_helicopter",
      description:
        "Call evacuation helicopter. ONLY call this after a scout confirms partisan location via inspect.",
      parameters: {
        type: "object",
        properties: {
          destination: {
            type: "string",
            description:
              "Coordinates where scout confirmed partisan, e.g. 'F6'",
          },
        },
        required: ["destination"],
      },
    },
  },
];

export const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  async call_api({ action, ...rest }) {
    const actionStr = action as string;
    // agent may pass params nested or flat — support both
    const nested = (rest.params ?? {}) as Record<string, unknown>;
    const flat = Object.fromEntries(
      Object.entries(rest).filter(([k]) => k !== "params"),
    );
    const p = { ...flat, ...nested };
    const cost = estimateCost(actionStr, p);
    if (cost > 0) spend(cost);
    const answer = { action: actionStr, ...p };
    const result = await hubCall(answer);
    return { result, remaining_points: remainingPoints };
  },

  async call_helicopter({ destination }) {
    const result = await hubCall({ action: "callHelicopter", destination });
    const text = JSON.stringify(result);
    console.log(`[call_helicopter] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return { result, remaining_points: remainingPoints };
  },
};
