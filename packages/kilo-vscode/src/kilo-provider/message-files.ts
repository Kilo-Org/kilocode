import { z } from "zod"

const source = z.object({
  type: z.literal("file"),
  path: z.string(),
  text: z.object({
    value: z.string(),
    start: z.number(),
    end: z.number(),
  }),
})

const file = z.object({
  mime: z.string(),
  url: z.string().refine((url) => url.startsWith("file://") || url.startsWith("data:")),
  filename: z.string().optional(),
  source: source.optional(),
})

export type MessageFile = z.infer<typeof file>

export function parseMessageFiles(value: unknown) {
  return z.array(file).optional().catch(undefined).parse(value)
}
