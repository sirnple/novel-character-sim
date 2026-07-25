/** JSON schema for chatWithTool (OpenAI-style parameters object). */
export const EXTRACT_WINDOW_CHARACTERS_SCHEMA = {
  name: "extract_window_characters",
  description:
    "Characters found in one text window after in-window coreference. Root is a JSON array.",
  parameters: {
    type: "object",
    description:
      "Wire format: the model returns a JSON **array** of Character objects (not wrapped in a root object).",
    properties: {
      // Documented shape for the array element (prompt carries the array root)
      _item: {
        type: "object",
        properties: {
          mentions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                surface: { type: "string" },
                textAnchor: { type: "string" },
              },
              required: ["surface", "textAnchor"],
            },
          },
          gender: { type: "string" },
          age: { type: "string" },
        },
        required: ["mentions"],
      },
    },
  },
} as const;
