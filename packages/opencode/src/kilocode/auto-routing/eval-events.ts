// Port of services/auto-routing-benchmark/src/kilo-events.ts in Kilo-Org/cloud.
// Client eval results are graded against platform results, so the client must
// derive the answer text and cost from the same `kilo run --format json` event
// stream the platform container feeds to its grader.
type LooseEvent = {
  type?: unknown
  text?: unknown
  cost?: unknown
  time?: { end?: unknown }
  part?: {
    text?: unknown
    cost?: unknown
    time?: { end?: unknown }
  }
}

export type ParsedKiloRun = {
  text: string
  costUsd: number | null
}

function completed(evt: LooseEvent): boolean {
  const end = evt.part?.time?.end ?? evt.time?.end
  return end !== undefined && end !== null
}

function readText(evt: LooseEvent): string | null {
  if (typeof evt.part?.text === "string") return evt.part.text
  if (typeof evt.text === "string") return evt.text
  return null
}

function readCost(evt: LooseEvent): number | null {
  const cost = evt.part?.cost ?? evt.cost
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null
}

export function parseKiloRunEvents(lines: ReadonlyArray<string>): ParsedKiloRun {
  const textParts: string[] = []
  let costUsd: number | null = null
  for (const line of lines) {
    let evt: LooseEvent
    try {
      evt = JSON.parse(line) as LooseEvent
    } catch {
      continue
    }
    if (evt === null || typeof evt !== "object") continue
    if (evt.type === "text" && completed(evt)) {
      const text = readText(evt)
      if (text !== null) textParts.push(text)
    }
    if (evt.type === "step_finish" || evt.type === "step-finish") {
      const cost = readCost(evt)
      if (cost !== null) costUsd = (costUsd ?? 0) + cost
    }
  }
  return { text: textParts.join("\n"), costUsd }
}
