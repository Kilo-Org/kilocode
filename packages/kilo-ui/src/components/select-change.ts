export function changed<T>(current: T | undefined, next: T | undefined, key: (item: T) => string) {
  if (current === undefined || next === undefined) return current !== next
  return key(current) !== key(next)
}
