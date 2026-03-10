import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSV_PATH = join(__dirname, "..", "data", "people.csv");
export const GENDER = "M";
export const BIRTH_PLACE = "Grudziądz";
export const BIRTH_YEAR_MIN = 1986;
export const BIRTH_YEAR_MAX = 2006;

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const MODEL = "openai/gpt-4o-mini";
export const BATCH_SIZE = 20;
export const FILTER_TAG = "transport";
export const CITY = "Grudziądz";
export const TASK = "people";
export const HUB_URL = "https://hub.ag3nts.org/verify";
