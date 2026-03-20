export const TASK = "sendit";
export const MODEL = "openai/gpt-4o"; // needs vision for image files in docs
export const HUB_URL = process.env.HUB_URL!;
export const DOCS_INDEX = `${process.env.HUB_URL}/dane/doc/index.md`;
export const MAX_ITERATIONS = 20;
