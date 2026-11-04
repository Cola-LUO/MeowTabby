import type { BackgroundStructuredObjectOutputField } from "@/types/background-stream"
import { z } from "zod"

export function createStructuredObjectSchema(
  outputSchema: BackgroundStructuredObjectOutputField[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const fieldTypeToZodSchema: Record<string, z.ZodTypeAny> = {
    string: z.string().nullable(),
    number: z.number().nullable(),
  }

  const schemaShape: Record<string, z.ZodTypeAny> = {}
  for (const field of outputSchema) {
    schemaShape[field.name] = fieldTypeToZodSchema[field.type] ?? z.string().nullable()
  }

  return z.strictObject(schemaShape)
}

/**
 * Build the "output JSON only" directive appended to the system prompt for
 * billing structured-object runs. Billing /v1/generate is a plain-text
 * protocol — unlike the AI SDK's Output.object (local path), nothing else
 * tells the model to emit JSON, so the schema travels as text.
 */
export function buildJsonOutputDirective(schema: z.ZodType): string {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema))
  return [
    "## Output format (mandatory)",
    "Respond with a single JSON object and nothing else — no prose, no markdown fences.",
    "It must validate against this JSON Schema:",
    jsonSchema,
  ].join("\n")
}
