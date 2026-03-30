import { TASK } from "./constants.js";
import { ChatCompletionTool } from "openai/resources";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "send_command",
      description:
        "Send a command to the reactor robot. Available commands: start (init game), right (move right), left (move left), wait (stay), reset (restart).",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: ["start", "right", "left", "wait", "reset"],
            description: "The command to send to the robot",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description:
        "Submit the final answer/flag to the verification endpoint.",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string", description: "The answer to submit" },
        },
        required: ["answer"],
      },
    },
  },
];

export const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
> = {
  async send_command({ command }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey,
        task: TASK,
        answer: { command },
      }),
    });
    const data = await res.json();
    return data;
  },

  async submit_answer({ answer }) {
    const res = await fetch(`${HUB_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey, task: TASK, answer }),
    });
    const data = await res.json();
    const text = JSON.stringify(data);
    console.log(`[submit_answer] ${text}`);
    const match = text.match(/\{FLG:[^}]+\}/);
    if (match) console.log("Flag:", match[0]);
    return data;
  },
};
