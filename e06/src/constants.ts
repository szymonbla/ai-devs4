export const TASK = "categorize";
export const MODEL = "openai/gpt-4o-mini";

// Static prefix for classifier prompt — must stay identical across all 10 calls for cache hit.
// Dynamic part (id + description) appended at the end.
export const STATIC_PREFIX =
  "Classify item as DNG or NEU. Weapons, explosives, mines → DNG. Reactor/nuclear/fuel cassette items → NEU. All other items → NEU. Reply only: DNG or NEU.";
