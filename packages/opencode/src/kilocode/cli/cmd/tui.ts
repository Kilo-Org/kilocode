export function preload(compiled: boolean, resolve: () => string) {
  if (compiled) return []
  return [resolve()]
}
