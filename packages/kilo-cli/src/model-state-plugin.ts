import { define, type Plugin } from "@opencode-ai/plugin/effect/plugin"
import { ModelStateRpc } from "@opencode-ai/schema/kilocode/model-state"
import { Effect, Schema, Semaphore } from "effect"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

type Selections = typeof ModelStateRpc.Selections.Type
const document = Schema.Record(Schema.String, Schema.Unknown)
const decodeDocument = Schema.decodeUnknownSync(Schema.fromJsonString(document))

/** One queue per host, shared by all Location registrations and extension panels. */
export function createModelStatePlugin(state: string): Plugin {
  const lock = Semaphore.makeUnsafe(1)
  const file = path.join(state, "model.json")
  const apply = (change?: (current: Selections) => Selections) =>
    lock.withPermit(
      Effect.tryPromise(async () => {
        const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "{}"
          throw error
        })
        const current = decodeDocument(text)
        const models = Schema.is(document)(current.model) ? current.model : {}
        const selections = Object.fromEntries(
          Object.entries(models).flatMap(([agent, value]) =>
            Schema.is(ModelStateRpc.Selection)(value)
              ? [[agent, { providerID: value.providerID, modelID: value.modelID }] as const]
              : [],
          ),
        )
        if (!change) return selections
        const next = change(selections)
        await mkdir(state, { recursive: true })
        const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify({ ...current, model: next }), { mode: 0o600 })
          await rename(temporary, file)
        } finally {
          await rm(temporary, { force: true })
        }
        return next
      }),
    )

  return define({
    id: "kilocode.model-state",
    effect: (ctx) =>
      ctx.rpc
        .register(ModelStateRpc.Definition, {
          list: (_input, call) =>
            apply().pipe(Effect.mapError(() => call.error("kilocode.model-state", "Unable to read model selections"))),
          set: (input, call) =>
            apply((current) => ({
              ...current,
              [input.agent]: { providerID: input.providerID, modelID: input.modelID },
            })).pipe(Effect.mapError(() => call.error("kilocode.model-state", "Unable to save model selection"))),
          clear: (input, call) =>
            apply((current) =>
              Object.fromEntries(Object.entries(current).filter(([agent]) => agent !== input.agent)),
            ).pipe(Effect.mapError(() => call.error("kilocode.model-state", "Unable to clear model selection"))),
          reset: (_input, call) =>
            apply(() => ({})).pipe(
              Effect.mapError(() => call.error("kilocode.model-state", "Unable to reset model selections")),
            ),
        })
        .pipe(Effect.asVoid, Effect.orDie),
  })
}
