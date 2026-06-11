import { Effect } from "effect"

export function mergeEnvTuiConfig(input: {
  file?: string
  merge: (file: string) => Effect.Effect<void>
  loaded: (file: string) => void
}) {
  if (!input.file) return Effect.void
  const file = input.file
  return input.merge(file).pipe(Effect.tap(() => Effect.sync(() => input.loaded(file))))
}
