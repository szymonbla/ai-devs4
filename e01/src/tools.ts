import type OpenAI from "openai";
import { loadFilteredPeople } from "./pipeline/load-people.js";
import { callModel } from "./pipeline/people.js";
import { FILTER_TAG, GENDER, CITY, TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = "https://hub.ag3nts.org/verify";

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_filtered_people",
      description:
        "Load CSV and return people matching filters (male, born in Grudziądz, 1986-2006). Returns JSON array of {name, surname, job, birthDate}.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_jobs",
      description:
        "Tag a batch of jobs with categories. Accepts an array of {i, job} objects. Returns tagged results with {i, tags[]} for each. Call multiple times for large datasets.",
      parameters: {
        type: "object",
        properties: {
          jobs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                i: { type: "number", description: "Index of the person" },
                job: { type: "string", description: "Job description to tag" },
              },
              required: ["i", "job"],
            },
          },
        },
        required: ["jobs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "filter_by_tag",
      description:
        "Cross-reference people with tagged results and return only those matching a given tag. " +
        "Accepts people array, tagged array ({i, tags[]}), and tag string.",
      parameters: {
        type: "object",
        properties: {
          people: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                surname: { type: "string" },
                job: { type: "string" },
                birthDate: { type: "string" },
              },
            },
          },
          tagged: {
            type: "array",
            items: {
              type: "object",
              properties: {
                i: { type: "number" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
          tag: { type: "string", description: "Tag to filter by, e.g. 'transport'" },
        },
        required: ["people", "tagged", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_answer",
      description: "Submit the final answer to the verification endpoint.",
      parameters: {
        type: "object",
        properties: {
          answer: {
            type: "array",
            description: "Array of person objects to submit",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                surname: { type: "string" },
                gender: { type: "string" },
                born: { type: "number" },
                city: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        required: ["answer"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async get_filtered_people() {
    const people = loadFilteredPeople();
    return people.map((p) => ({ name: p.name, surname: p.surname, job: p.job, birthDate: p.birthDate }));
  },

  async tag_jobs({ jobs }) {
    const batch = jobs as Array<{ i: number; job: string }>;
    return { results: await callModel(batch) };
  },

  async filter_by_tag({ people, tagged, tag }) {
    const personArr = people as Array<{ name: string; surname: string; job: string; birthDate: string }>;
    const taggedArr = tagged as Array<{ i: number; tags: string[] }>;
    const tagStr = tag as string;

    const tagMap = new Map<number, string[]>();
    for (const { i, tags } of taggedArr) tagMap.set(i, tags);

    return personArr
      .map((p, idx) => ({ ...p, tags: tagMap.get(idx) ?? [] }))
      .filter((p) => p.tags.includes(tagStr));
  },

  async submit_answer({ answer }) {
    const res = await fetch(HUB_URL, {
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
