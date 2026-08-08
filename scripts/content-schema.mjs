export const DAILY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "date",
    "title",
    "subtitle",
    "theme",
    "estimatedMinutes",
    "freshRatio",
    "introduction",
    "sections",
    "practice",
    "closing"
  ],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    title: { type: "string", minLength: 4, maxLength: 42 },
    subtitle: { type: "string", minLength: 8, maxLength: 120 },
    theme: { type: "string", minLength: 2, maxLength: 32 },
    estimatedMinutes: { type: "integer", minimum: 30, maximum: 45 },
    freshRatio: { type: "number", minimum: 0.2, maximum: 0.4 },
    introduction: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string", minLength: 12, maxLength: 260 }
    },
    sections: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "module",
          "eyebrow",
          "title",
          "summary",
          "estimatedMinutes",
          "freshness",
          "body",
          "keyPoints",
          "takeaway",
          "reflection",
          "sources"
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 48 },
          module: { type: "string", minLength: 2, maxLength: 48 },
          eyebrow: { type: "string", minLength: 2, maxLength: 32 },
          title: { type: "string", minLength: 6, maxLength: 80 },
          summary: { type: "string", minLength: 16, maxLength: 180 },
          estimatedMinutes: { type: "integer", minimum: 3, maximum: 10 },
          freshness: { type: "string", enum: ["latest", "evergreen"] },
          body: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "string", minLength: 20, maxLength: 520 }
          },
          keyPoints: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "string", minLength: 6, maxLength: 180 }
          },
          takeaway: { type: "string", minLength: 10, maxLength: 220 },
          reflection: { type: "string", minLength: 8, maxLength: 180 },
          sources: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "url", "publisher", "publishedAt"],
              properties: {
                title: { type: "string", minLength: 2, maxLength: 160 },
                url: { type: "string", minLength: 10, maxLength: 600 },
                publisher: { type: "string", minLength: 2, maxLength: 80 },
                publishedAt: { type: "string", maxLength: 24 }
              }
            }
          }
        }
      }
    },
    practice: {
      type: "object",
      additionalProperties: false,
      required: ["title", "prompt", "steps", "estimatedMinutes"],
      properties: {
        title: { type: "string", minLength: 4, maxLength: 60 },
        prompt: { type: "string", minLength: 12, maxLength: 240 },
        steps: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: { type: "string", minLength: 6, maxLength: 160 }
        },
        estimatedMinutes: { type: "integer", minimum: 3, maximum: 10 }
      }
    },
    closing: { type: "string", minLength: 8, maxLength: 220 }
  }
};
