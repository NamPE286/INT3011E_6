/** JSON Schema for OpenAI Structured Outputs. Required fields + no extra properties. */
const string = { type: "string" };
const optionalString = { type: ["string", "null"] };
const integer = { type: "integer" };

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
const arr = (items: unknown) => ({ type: "array", items });
function segment(children: Record<string, unknown> = {}) {
  return obj({
    number: string,
    title: optionalString,
    start_line: integer,
    heading_end_line: integer,
    end_line: integer,
    ...children,
  });
}
const point = segment();
const clause = segment({ points: arr(point) });
const article = segment({ clauses: arr(clause) });
const section = segment({ articles: arr(article) });
const chapter = segment({ sections: arr(section), articles: arr(article) });
const part = segment({ chapters: arr(chapter), sections: arr(section), articles: arr(article) });

export const SEGMENTATION_JSON_SCHEMA = obj({
  document_title: string,
  parts: arr(part),
  chapters: arr(chapter),
  sections: arr(section),
  articles: arr(article),
});
