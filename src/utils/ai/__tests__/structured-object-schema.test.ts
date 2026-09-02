import { describe, expect, it } from "vitest"
import { z } from "zod"
import { buildJsonOutputDirective, createStructuredObjectSchema } from "../structured-object-schema"

describe("buildJsonOutputDirective", () => {
  it("embeds the JSON Schema of a flat custom-action schema", () => {
    const schema = createStructuredObjectSchema([
      { name: "term", type: "string" },
      { name: "score", type: "number" },
    ])
    const directive = buildJsonOutputDirective(schema)

    expect(directive).toContain('"term"')
    expect(directive).toContain('"score"')
    expect(directive).toContain('"type":"string"')
    expect(directive).toContain('"type":"number"')
  })

  it("forbids extra properties and non-JSON output", () => {
    const schema = createStructuredObjectSchema([{ name: "term", type: "string" }])
    const directive = buildJsonOutputDirective(schema)

    // strictObject → additionalProperties: false in the embedded schema
    expect(directive).toContain('"additionalProperties":false')
    expect(directive).toContain("JSON")
  })

  it("supports nested schemas (note suggestion envelope shape)", () => {
    const schema = z.object({
      action: z.object({ summaryFieldName: z.string().nullable() }),
      notes: z.array(
        z.object({ fields: z.array(z.object({ name: z.string(), value: z.string() })) }),
      ),
    })
    const directive = buildJsonOutputDirective(schema)

    expect(directive).toContain('"notes"')
    expect(directive).toContain('"array"')
  })
})
