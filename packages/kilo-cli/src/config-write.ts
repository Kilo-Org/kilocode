// Settings and privacy both edit the isolated profile. Share their in-process
// read/modify/write queue so concurrent RPCs cannot overwrite each other's keys.
const writes = new Map<string, Promise<unknown>>()

export function serializeConfigWrite<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const result = (writes.get(file) ?? Promise.resolve()).then(operation)
  const settled = result.then(
    () => undefined,
    () => undefined,
  )
  writes.set(file, settled)
  void settled.then(() => {
    if (writes.get(file) === settled) writes.delete(file)
  })
  return result
}
