import { HostedAiOutputFieldTypeSchema } from "@read-frog/api-contract"
import { z } from "zod"

// The contract's field-type enum is the source of truth: these values ride the
// wire to hostedAi.customAction unchanged. Only the enum is shared — length
// caps and strictness stay hosted-only so BYOK actions are not constrained.
export const selectionToolbarCustomActionOutputTypeSchema = HostedAiOutputFieldTypeSchema

export const selectionToolbarCustomActionOutputFieldSchema = z.object({
  id: z.string().nonempty(),
  name: z.string().trim().min(1),
  type: selectionToolbarCustomActionOutputTypeSchema,
  description: z.string(),
  speaking: z.boolean(),
})

export const selectionToolbarBuiltInActionStateSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().nonempty(),
})

export const selectionToolbarBuiltInActionsSchema = z.object({
  dictionary: selectionToolbarBuiltInActionStateSchema,
})

export const selectionToolbarCustomActionSchema = z
  .object({
    id: z.string().nonempty(),
    name: z.string().nonempty(),
    enabled: z.boolean().optional(),
    icon: z.string(),
    providerId: z.string().nonempty(),
    systemPrompt: z.string(),
    prompt: z.string(),
    outputSchema: z.array(selectionToolbarCustomActionOutputFieldSchema).min(1),
  })
  .superRefine((action, ctx) => {
    const nameSet = new Set<string>()
    const outputFieldIds = new Set<string>()

    action.outputSchema.forEach((field, index) => {
      if (nameSet.has(field.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate output schema name "${field.name}".`,
          path: ["outputSchema", index, "name"],
        })
        return
      }
      nameSet.add(field.name)
      outputFieldIds.add(field.id)
    })
  })

export const selectionToolbarCustomActionsSchema = z
  .array(selectionToolbarCustomActionSchema)
  .superRefine((actions, ctx) => {
    const idSet = new Set<string>()
    actions.forEach((action, index) => {
      if (action.id === "default-dictionary") {
        ctx.addIssue({
          code: "custom",
          message: 'Action id "default-dictionary" is reserved for the built-in Dictionary.',
          path: [index, "id"],
        })
      }

      if (idSet.has(action.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate action id "${action.id}"`,
          path: [index, "id"],
        })
      }
      idSet.add(action.id)
    })

    const nameSet = new Set<string>()
    actions.forEach((action, index) => {
      if (nameSet.has(action.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate action name "${action.name}"`,
          path: [index, "name"],
        })
      }
      nameSet.add(action.name)
    })
  })

// TODO: make these vairbale shorter by deleteing SelectionToolbar or "selectionToolbar"
export type SelectionToolbarCustomActionOutputType = z.infer<
  typeof selectionToolbarCustomActionOutputTypeSchema
>
export type SelectionToolbarCustomActionOutputField = z.infer<
  typeof selectionToolbarCustomActionOutputFieldSchema
>
export type SelectionToolbarBuiltInActionState = z.infer<
  typeof selectionToolbarBuiltInActionStateSchema
>
export type SelectionToolbarBuiltInActions = z.infer<typeof selectionToolbarBuiltInActionsSchema>
export type SelectionToolbarCustomAction = z.infer<typeof selectionToolbarCustomActionSchema>
