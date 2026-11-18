export * as KiloSchedule from "./schedule.js"

import { DateTime, Option } from "effect"

const OFFSET = /\d(?:z|[+-]\d{2}:?\d{2})$/i

/**
 * Reads a schedule instant as epoch milliseconds: a value carrying an offset is absolute, and a wall-clock time is read
 * in `zone`. The core scheduler and the `/periodic` wizard share it, so the wizard accepts exactly what the server does.
 */
export function parseAt(input: string, zone: DateTime.TimeZone | string) {
  return Option.map(
    OFFSET.test(input) ? DateTime.make(input) : DateTime.makeZoned(input, { timeZone: zone, adjustForTimeZone: true }),
    DateTime.toEpochMillis,
  )
}
