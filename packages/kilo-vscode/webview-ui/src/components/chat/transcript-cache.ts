import type { CacheSnapshot } from "virtua"

const MEASUREMENT_LIMIT = 16
const SCROLL_LIMIT = 50

export interface LayoutMetrics {
  width: number
  ratio: number
  font: string
  size: string
  line: string
}

export type ScrollState =
  | { type: "bottom" }
  | {
      type: "anchor"
      key: string
      offset: number
    }

interface MeasurementState {
  keys: string
  layout: string
  cache: CacheSnapshot
}

const measurements = new Map<string, MeasurementState>()
const scrolls = new Map<string, ScrollState>()

function touch<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size <= limit) return
  const oldest = cache.keys().next().value
  if (oldest !== undefined) cache.delete(oldest)
}

export function rowFingerprint(keys: readonly string[]) {
  return keys.map((key) => `${key.length}:${key}`).join("|")
}

export function layoutFingerprint(metrics: LayoutMetrics) {
  return [metrics.width, metrics.ratio, metrics.font, metrics.size, metrics.line]
    .map((value) => `${String(value).length}:${value}`)
    .join("|")
}

export function setMeasurement(id: string, keys: string, layout: string, cache: CacheSnapshot) {
  touch(measurements, id, { keys, layout, cache }, MEASUREMENT_LIMIT)
}

export function getMeasurement(id: string, keys: string, layout: string) {
  const value = measurements.get(id)
  if (!value) return undefined
  if (value.keys !== keys || value.layout !== layout) {
    measurements.delete(id)
    return undefined
  }
  touch(measurements, id, value, MEASUREMENT_LIMIT)
  return value.cache
}

export function setScroll(id: string, state: ScrollState) {
  touch(scrolls, id, state, SCROLL_LIMIT)
}

export function getScroll(id: string) {
  const value = scrolls.get(id)
  if (!value) return undefined
  touch(scrolls, id, value, SCROLL_LIMIT)
  return value
}

export function resolveAnchor(state: ScrollState | undefined, keys: readonly string[]) {
  if (!state || state.type === "bottom") return undefined
  const index = keys.indexOf(state.key)
  if (index < 0) return undefined
  return { index, offset: state.offset }
}

export function resetTranscriptCaches() {
  measurements.clear()
  scrolls.clear()
}
