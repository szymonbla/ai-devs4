export const JOB_TAGS = [
  "IT",
  "transport",
  "edukacja",
  "medycyna",
  "praca z ludźmi",
  "praca z pojazdami",
  "praca fizyczna",
];

export const jobTagsSchema = {
  name: "job_tags",
  strict: true,
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "number" },
            tags: {
              type: "array",
              items: { type: "string", enum: [...JOB_TAGS] },
            },
          },
          required: ["i", "tags"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
} as const;
