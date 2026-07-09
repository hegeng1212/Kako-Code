import type { ToolDefinition, ToolHandler } from "@kako/shared";

export function createStructuredOutputTool(
  schema: Record<string, unknown>,
): { definition: ToolDefinition; handler: ToolHandler } {
  const definition: ToolDefinition = {
    name: "StructuredOutput",
    description:
      "Submit the final structured result. You MUST call this tool once with JSON matching the required schema.",
    inputSchema: schema,
  };

  const handler: ToolHandler = async (input) => JSON.stringify(input, null, 2);

  return { definition, handler };
}

export function parseStructuredOutput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
