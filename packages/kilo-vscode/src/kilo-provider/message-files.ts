import { z } from "zod"

const file = z.object({
  mime: z.string(),
  url: z.string().refine((url) => url.startsWith("file://") || url.startsWith("data:")),
  filename: z.string().optional(),
})

export function parseMessageFiles(value: unknown) {
  return z.array(file).optional().catch(undefined).parse(value)
}
