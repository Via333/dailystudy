const SOURCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "url", "publisher", "publishedAt"],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 180 },
    url: { type: "string", minLength: 10, maxLength: 600 },
    publisher: { type: "string", minLength: 2, maxLength: 100 },
    publishedAt: { type: "string", maxLength: 24 }
  }
};

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
    "introduction",
    "lessons",
    "radar",
    "practice",
    "closing"
  ],
  properties: {
    schemaVersion: { type: "integer", enum: [2] },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    title: { type: "string", minLength: 4, maxLength: 48 },
    subtitle: { type: "string", minLength: 8, maxLength: 140 },
    theme: { type: "string", minLength: 2, maxLength: 36 },
    estimatedMinutes: { type: "integer", minimum: 30, maximum: 45 },
    introduction: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "string", minLength: 12, maxLength: 320 }
    },
    lessons: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "module",
          "curriculum",
          "eyebrow",
          "title",
          "summary",
          "estimatedMinutes",
          "learningObjectives",
          "body",
          "keyPoints",
          "application",
          "boundary",
          "takeaway",
          "reflection",
          "sources"
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 72 },
          module: { type: "string", minLength: 2, maxLength: 48 },
          curriculum: {
            type: "object",
            additionalProperties: false,
            required: ["stageId", "stageTitle", "unitId", "unitTitle", "objective", "scope", "sequence", "totalUnits", "cycle"],
            properties: {
              stageId: { type: "string", minLength: 2, maxLength: 72 },
              stageTitle: { type: "string", minLength: 2, maxLength: 60 },
              unitId: { type: "string", minLength: 4, maxLength: 120 },
              unitTitle: { type: "string", minLength: 4, maxLength: 80 },
              objective: { type: "string", minLength: 16, maxLength: 200 },
              scope: { type: "string", minLength: 24, maxLength: 360 },
              sequence: { type: "integer", minimum: 1, maximum: 80 },
              totalUnits: { type: "integer", minimum: 1, maximum: 80 },
              cycle: { type: "integer", minimum: 1, maximum: 20 }
            }
          },
          eyebrow: { type: "string", minLength: 2, maxLength: 48 },
          title: { type: "string", minLength: 6, maxLength: 88 },
          summary: { type: "string", minLength: 20, maxLength: 220 },
          estimatedMinutes: { type: "integer", minimum: 12, maximum: 18 },
          learningObjectives: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: { type: "string", minLength: 8, maxLength: 140 }
          },
          body: {
            type: "array",
            minItems: 4,
            maxItems: 6,
            items: { type: "string", minLength: 30, maxLength: 620 }
          },
          keyPoints: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: { type: "string", minLength: 8, maxLength: 180 }
          },
          application: { type: "string", minLength: 20, maxLength: 360 },
          boundary: { type: "string", minLength: 16, maxLength: 300 },
          takeaway: { type: "string", minLength: 12, maxLength: 240 },
          reflection: { type: "string", minLength: 10, maxLength: 200 },
          sources: {
            type: "array",
            maxItems: 5,
            items: SOURCE_SCHEMA
          }
        }
      }
    },
    radar: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "estimatedMinutes", "body", "relatedModules", "sources"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 72 },
          title: { type: "string", minLength: 8, maxLength: 100 },
          summary: { type: "string", minLength: 20, maxLength: 220 },
          estimatedMinutes: { type: "integer", minimum: 3, maximum: 8 },
          body: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 30, maxLength: 520 }
          },
          relatedModules: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 2, maxLength: 48 }
          },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: SOURCE_SCHEMA
          }
        }
      }
    },
    practice: {
      type: "object",
      additionalProperties: false,
      required: ["title", "prompt", "steps", "estimatedMinutes"],
      properties: {
        title: { type: "string", minLength: 4, maxLength: 70 },
        prompt: { type: "string", minLength: 12, maxLength: 280 },
        steps: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: { type: "string", minLength: 8, maxLength: 180 }
        },
        estimatedMinutes: { type: "integer", minimum: 5, maximum: 10 }
      }
    },
    closing: { type: "string", minLength: 8, maxLength: 240 }
  }
};
