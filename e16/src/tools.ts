import "./env.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { chromium, type BrowserContext } from "playwright";
import { convert } from "html-to-text";
import type OpenAI from "openai";
import { TASK } from "./constants.js";

const apikey = process.env.AG3NTS_API_KEY!;
const HUB_URL = process.env.HUB_URL!;
const PANEL_URL = "https://oko.ag3nts.org";
const PANEL_LOGIN = "Zofia";
const PANEL_PASSWORD = "Zofia2026!";
const STORAGE_FILE = join(process.cwd(), "sessions", "storage.json");
export const WORKSPACE_DIR = join(process.cwd(), "workspace");

// ── Browser context (singleton) ───────────────────────────────────────────────

let ctx: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (ctx) return ctx;

  const browser = await chromium.launch({ headless: true });

  const storageState = existsSync(STORAGE_FILE)
    ? (JSON.parse(readFileSync(STORAGE_FILE, "utf-8")) as Parameters<typeof browser.newContext>[0]["storageState"])
    : undefined;

  ctx = await browser.newContext({ storageState });

  const page = await ctx.newPage();
  await page.goto(`${PANEL_URL}/incydenty`);
  const isLoggedIn = !(await page.locator("text=LOGOWANIE OPERATORA").isVisible().catch(() => false));

  if (!isLoggedIn) {
    console.log("[auth] session invalid — logging in");
    await page.goto(PANEL_URL);
    await page.fill('[name="login"]', PANEL_LOGIN);
    await page.fill('[name="password"]', PANEL_PASSWORD);
    await page.fill('[name="access_key"]', apikey);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.toString().includes("login") || url.toString() === `${PANEL_URL}/`, {
      timeout: 5000,
    }).catch(() => {});
    console.log("[auth] logged in, saving storage state");
    mkdirSync(join(process.cwd(), "sessions"), { recursive: true });
    await ctx.storageState({ path: STORAGE_FILE });
  } else {
    console.log("[auth] reusing saved session");
  }

  await page.close();
  return ctx;
}

// ── HTML stripper ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return convert(html, {
    selectors: [
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { linkBrackets: ["(", ")"] } },
    ],
    wordwrap: false,
  });
}

// ── Core functions (exported for direct use) ──────────────────────────────────

export async function callOkoApi(action: string, payload?: Record<string, unknown>): Promise<unknown> {
  const body = { apikey, task: TASK, answer: { action, ...payload } };
  console.log(`[api] POST /verify action=${action}`, JSON.stringify(body.answer).slice(0, 200));

  const res = await fetch(`${HUB_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(`[api] response:`, JSON.stringify(data).slice(0, 300));
  return data;
}

export async function readOkoPage(path: string): Promise<string> {
  const context = await getContext();
  const url = `${PANEL_URL}${path.startsWith("/") ? path : "/" + path}`;
  console.log(`[panel] GET ${url}`);

  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const html = await page.content();
  await page.close();

  const text = stripHtml(html);
  console.log(`[panel] ${url} → ${text.length} chars`);
  return text;
}

// ── Phase 1: scrape all pages and save to workspace ───────────────────────────

export async function scrapeToWorkspace(): Promise<Record<string, string>> {
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Fetch top-level pages in parallel
  console.log("\n[scrape] fetching top-level pages...");
  const [notatki, incydenty, zadania] = await Promise.all([
    readOkoPage("/notatki"),
    readOkoPage("/incydenty"),
    readOkoPage("/zadania"),
  ]);

  writeFileSync(join(WORKSPACE_DIR, "notatki.txt"), notatki, "utf-8");
  writeFileSync(join(WORKSPACE_DIR, "incydenty.txt"), incydenty, "utf-8");
  writeFileSync(join(WORKSPACE_DIR, "zadania.txt"), zadania, "utf-8");

  // Extract individual page IDs from list pages
  const incydentIds = [...incydenty.matchAll(/\(\/incydenty\/([a-f0-9]{32})\)/g)].map((m) => m[1]);
  const zadanieIds = [...zadania.matchAll(/\(\/zadania\/([a-f0-9]{32})\)/g)].map((m) => m[1]);
  const notatkiIds = [...notatki.matchAll(/\(\/notatki\/([a-f0-9]{32})\)/g)].map((m) => m[1]);

  console.log(`[scrape] found ${incydentIds.length} incydenty, ${zadanieIds.length} zadania, ${notatkiIds.length} notatki`);

  // Fetch all individual pages in parallel
  const individualPages = await Promise.all([
    ...incydentIds.map(async (id) => {
      const text = await readOkoPage(`/incydenty/${id}`);
      writeFileSync(join(WORKSPACE_DIR, `incydent_${id}.txt`), text, "utf-8");
      return [`incydent_${id}`, text] as const;
    }),
    ...zadanieIds.map(async (id) => {
      const text = await readOkoPage(`/zadania/${id}`);
      writeFileSync(join(WORKSPACE_DIR, `zadanie_${id}.txt`), text, "utf-8");
      return [`zadanie_${id}`, text] as const;
    }),
    ...notatkiIds.map(async (id) => {
      const text = await readOkoPage(`/notatki/${id}`);
      writeFileSync(join(WORKSPACE_DIR, `notatka_${id}.txt`), text, "utf-8");
      return [`notatka_${id}`, text] as const;
    }),
  ]);

  const pages: Record<string, string> = { notatki, incydenty, zadania };
  for (const [key, text] of individualPages) pages[key] = text;

  console.log(`[scrape] saved ${Object.keys(pages).length} files to workspace/`);
  return pages;
}

// ── OpenAI tool definitions ───────────────────────────────────────────────────

export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "read_panel_page",
      description: "Fetch a live page from the OKO panel to check current state. Use to verify what exists before making changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Panel path e.g. /notatki, /incydenty, /zadania, /notatki/<id>, /incydenty/<id>" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "call_oko_api",
      description: "Call the OKO /verify API. action='help' shows available actions. action='update' modifies a record. action='done' finalizes and returns the flag.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "API action: help, update, done" },
          page: { type: "string", description: "For update: incydenty, zadania, or notatki" },
          id: { type: "string", description: "For update: 32-char hex record ID" },
          title: { type: "string", description: "For update: new title" },
          content: { type: "string", description: "For update: new content text" },
          done: { type: "string", description: "ONLY valid when page=zadania. Value YES or NO." },
        },
        required: ["action"],
      },
    },
  },
];

export const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  read_panel_page: (args) => readOkoPage(args.path as string),
  call_oko_api: (args) => {
    const { action, ...rest } = args;
    // done field is only valid for zadania page — strip it otherwise to avoid -780 error
    if (rest.page !== "zadania") delete rest.done;
    const payload = Object.keys(rest).length > 0 ? rest : undefined;
    return callOkoApi(action as string, payload);
  },
};
