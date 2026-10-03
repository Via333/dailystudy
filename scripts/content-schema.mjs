import { DEFAULT_IDENTITIES, isDateString } from "./lib.mjs";

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

const LABELED_POINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "text"],
  properties: {
    title: { type: "string", minLength: 2, maxLength: 12 },
    text: { type: "string", minLength: 16, maxLength: 50 }
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
    "estimatedMinutes",
    "introduction",
    "lessons",
    "radar"
  ],
  properties: {
    schemaVersion: { type: "integer", enum: [4] },
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    title: { type: "string", minLength: 4, maxLength: 40 },
    subtitle: { type: "string", minLength: 8, maxLength: 100 },
    estimatedMinutes: { type: "integer", minimum: 20, maximum: 40 },
    introduction: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: { type: "string", minLength: 20, maxLength: 160 }
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
          "estimatedMinutes",
          "coreQuestion",
          "framework",
          "keyPoints",
          "caseStudy",
          "exercise",
          "conclusion",
          "sources"
        ],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 72 },
          module: { type: "string", minLength: 2, maxLength: 48 },
          learningIdentity: { type: "string", enum: ["personal", "work"] },
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
          estimatedMinutes: { type: "integer", minimum: 14, maximum: 26 },
          coreQuestion: { type: "string", minLength: 12, maxLength: 48 },
          framework: {
            type: "object",
            additionalProperties: false,
            required: ["name", "definition", "steps", "boundary"],
            properties: {
              name: { type: "string", minLength: 2, maxLength: 18 },
              definition: { type: "string", minLength: 20, maxLength: 70 },
              steps: {
                type: "array",
                minItems: 2,
                maxItems: 3,
                items: LABELED_POINT_SCHEMA
              },
              boundary: { type: "string", minLength: 16, maxLength: 56 }
            }
          },
          keyPoints: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: LABELED_POINT_SCHEMA
          },
          caseStudy: {
            type: "object",
            additionalProperties: false,
            required: ["title", "context", "analysis", "lesson"],
            properties: {
              title: { type: "string", minLength: 4, maxLength: 28 },
              context: { type: "string", minLength: 20, maxLength: 70 },
              analysis: { type: "string", minLength: 30, maxLength: 100 },
              lesson: { type: "string", minLength: 12, maxLength: 48 }
            }
          },
          exercise: {
            type: "object",
            additionalProperties: false,
            required: ["prompt", "steps", "deliverable"],
            properties: {
              prompt: { type: "string", minLength: 16, maxLength: 60 },
              steps: {
                type: "array",
                minItems: 2,
                maxItems: 3,
                items: { type: "string", minLength: 8, maxLength: 40 }
              },
              deliverable: { type: "string", minLength: 8, maxLength: 36 }
            }
          },
          conclusion: { type: "string", minLength: 10, maxLength: 48 },
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
        required: ["id", "module", "title", "estimatedMinutes", "whatChanged", "whyItMatters", "watchNext", "sources"],
        properties: {
          id: { type: "string", pattern: "^[a-z0-9-]+$", maxLength: 72 },
          module: { type: "string", minLength: 2, maxLength: 48 },
          title: { type: "string", minLength: 8, maxLength: 48 },
          estimatedMinutes: { type: "integer", minimum: 3, maximum: 5 },
          whatChanged: { type: "string", minLength: 30, maxLength: 140 },
          whyItMatters: { type: "string", minLength: 20, maxLength: 80 },
          watchNext: { type: "string", minLength: 16, maxLength: 70 },
          sources: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: SOURCE_SCHEMA
          }
        }
      }
    }
  }
};

// The archive schema remains backwards-compatible. API structured output needs
// every offered property to be required, so old-date generation omits this field.
export function dailySchemaForDate(date, config = DEFAULT_IDENTITIES) {
  if (!isDateString(date)) throw new Error("Schema 日期必须是有效的 YYYY-MM-DD");
  const schema = structuredClone(DAILY_SCHEMA);
  const lesson = schema.properties.lessons.items;
  if (date >= config.effectiveDate) lesson.required.push("learningIdentity");
  else delete lesson.properties.learningIdentity;
  return schema;
}
