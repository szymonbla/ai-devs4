export const TASK = "drone";
export const MODEL = "openai/gpt-4o-mini";
export const VISION_MODEL = "openai/gpt-5.4";
export const PWR_CODE = "PWR6132PL";

export const mapAnalysisSchema = {
  name: "map_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      grid_size: {
        type: "object",
        properties: {
          cols: { type: "number" },
          rows: { type: "number" },
        },
        required: ["cols", "rows"],
        additionalProperties: false,
      },
      dam_sector: {
        type: "object",
        properties: {
          col: { type: "number" },
          row: { type: "number" },
        },
        required: ["col", "row"],
        additionalProperties: false,
      },
      reasoning: { type: "string" },
    },
    required: ["grid_size", "dam_sector", "reasoning"],
    additionalProperties: false,
  },
} as const;
