import z from "zod"
import { Database, eq } from "@/storage/db"
import { CustomLlm2Table } from "./custom-llm.sql"
import { Identifier } from "@/id/id"

export namespace CustomLlm {
  export const Info = z
    .object({
      id: z.string(),
      name: z.string().min(1),
      config: z.string().min(2),
      time_created: z.number(),
      time_updated: z.number(),
    })
    .meta({ ref: "CustomLlm" })

  export type Info = z.infer<typeof Info>

  export const Create = z.object({
    name: z.string().min(1, "Name is required"),
    config: z.string().refine(
      (val) => {
        try {
          JSON.parse(val)
          return true
        } catch {
          return false
        }
      },
      { message: "Config must be valid JSON" },
    ),
  })

  export type Create = z.infer<typeof Create>

  export const Update = z.object({
    id: z.string().min(1),
    name: z.string().min(1, "Name is required").optional(),
    config: z
      .string()
      .refine(
        (val) => {
          try {
            JSON.parse(val)
            return true
          } catch {
            return false
          }
        },
        { message: "Config must be valid JSON" },
      )
      .optional(),
  })

  export type Update = z.infer<typeof Update>

  export function list(): Info[] {
    return Database.use((db) => db.select().from(CustomLlm2Table).all())
  }

  export function get(id: string): Info | undefined {
    return Database.use((db) => db.select().from(CustomLlm2Table).where(eq(CustomLlm2Table.id, id)).get())
  }

  export function create(input: Create): Info {
    const id = Identifier.ascending("tool")
    return Database.use((db) => {
      const now = Date.now()
      db.insert(CustomLlm2Table)
        .values({
          id,
          name: input.name,
          config: input.config,
          time_created: now,
          time_updated: now,
        })
        .run()
      return db.select().from(CustomLlm2Table).where(eq(CustomLlm2Table.id, id)).get()!
    })
  }

  export function update(input: Update): Info | undefined {
    return Database.use((db) => {
      const values: Record<string, unknown> = {}
      if (input.name !== undefined) values.name = input.name
      if (input.config !== undefined) values.config = input.config
      values.time_updated = Date.now()
      db.update(CustomLlm2Table).set(values).where(eq(CustomLlm2Table.id, input.id)).run()
      return db.select().from(CustomLlm2Table).where(eq(CustomLlm2Table.id, input.id)).get()
    })
  }

  export function remove(id: string): boolean {
    return Database.use((db) => {
      const row = db.select().from(CustomLlm2Table).where(eq(CustomLlm2Table.id, id)).get()
      if (!row) return false
      db.delete(CustomLlm2Table).where(eq(CustomLlm2Table.id, id)).run()
      return true
    })
  }
}
