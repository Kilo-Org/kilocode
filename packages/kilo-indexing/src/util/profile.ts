export type IndexingProfileValue = string | number | boolean
export type IndexingProfileFields = Record<string, IndexingProfileValue | undefined>
export type IndexingProfileOutcome = "success" | "error" | "cancelled" | "disabled" | "waiting"

export type IndexingProfileRecord = {
  type: "kilo-indexing-profile"
  event: string
  durationMs: number
  outcome: IndexingProfileOutcome
  fields: Record<string, IndexingProfileValue>
}

export type IndexingProfileSpan = {
  add(fields: IndexingProfileFields): void
  outcome(value: IndexingProfileOutcome): void
  end(): void
  [Symbol.dispose](): void
}

const noop: IndexingProfileSpan = {
  add() {},
  outcome() {},
  end() {},
  [Symbol.dispose]() {},
}

function clean(input: IndexingProfileFields) {
  const fields: Record<string, IndexingProfileValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) fields[key] = value
  }
  return fields
}

function emit(record: IndexingProfileRecord) {
  try {
    console.info(JSON.stringify(record))
  } catch (err) {
    console.error("failed to emit indexing profile", err)
  }
}

export namespace IndexingProfile {
  export function start(event: string, fields: IndexingProfileFields = {}): IndexingProfileSpan {
    if (process.env.KILO_INDEXING_PROFILE !== "1") return noop

    const time = performance.now()
    const data = clean(fields)
    let outcome: IndexingProfileOutcome = "error"
    let ended = false
    const end = () => {
      if (ended) return
      ended = true
      emit({
        type: "kilo-indexing-profile",
        event,
        durationMs: Math.max(0, performance.now() - time),
        outcome,
        fields: data,
      })
    }

    return {
      add(fields) {
        Object.assign(data, clean(fields))
      },
      outcome(value) {
        outcome = value
      },
      end,
      [Symbol.dispose]: end,
    }
  }
}
