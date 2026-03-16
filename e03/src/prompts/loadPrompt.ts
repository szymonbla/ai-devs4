import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrompt(file: string, vars: Record<string, string>): string {
  const raw = readFileSync(join(__dirname, file), "utf-8");
  const body = raw.replace(/^---[\s\S]*?---\n/, "");
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, v),
    body
  );
}

export const marcinSystemPrompt = loadPrompt("SYSTEM_PROMPT.md", {
  date: new Date().toLocaleDateString("pl-PL", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
});
