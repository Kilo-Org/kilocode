import { z } from "zod"

export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => cb(schema.parse(input))
  result.force = (input: z.infer<T>) => cb(input)
  result.schema = schema
  return result
}
