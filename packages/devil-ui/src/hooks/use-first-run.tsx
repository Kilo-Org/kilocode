/**
 * useFirstRun — tracks whether the user is in their first-run experience.
 *
 * Reads from and persists to a storage key via the provided options.
 * Designed for both DOM (localStorage) and TUI (file-based) contexts by
 * accepting an abstract storage interface through UseFirstRunOptions.
 */
import { createSignal, type Accessor } from "solid-js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type UseFirstRunOptions = {
  /**
   * Storage key used to persist the "first run completed" flag.
   * Consumers typically prefix by product / feature (e.g. "kilo.onboarding.done").
   */
  storageKey: string
  /**
   * Returns whether the given key is present + truthy in storage.
   * Defaults to localStorage when omitted (DOM-safe fallback).
   */
  readStorage?: (key: string) => boolean
  /**
   * Persists the given key to storage.
   * Defaults to localStorage.setItem when omitted (DOM-safe fallback).
   */
  writeStorage?: (key: string, value: string) => void | Promise<void>
}

export type UseFirstRunResult = {
  /** Reactive accessor — true when first-run has NOT yet been completed. */
  isFirstRun: Accessor<boolean>
  /** Marks first run as complete; persists the flag and updates the accessor. */
  markComplete: () => Promise<void>
}

// ---------------------------------------------------------------------------
// DOM-safe default storage
// ---------------------------------------------------------------------------

function defaultRead(key: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "done"
  } catch {
    return false
  }
}

async function defaultWrite(key: string, value: string): Promise<void> {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value)
    }
  } catch {
    // TUI / SSR — no-op
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns `{ isFirstRun, markComplete }`.
 *
 * - `isFirstRun` is true when storage does NOT contain the completed flag.
 * - `markComplete()` writes the flag and sets `isFirstRun` to false.
 */
export function useFirstRun(options: UseFirstRunOptions): UseFirstRunResult {
  const read = options.readStorage ?? defaultRead
  const write = options.writeStorage ?? defaultWrite

  const alreadyDone = read(options.storageKey)
  const [isFirstRun, setIsFirstRun] = createSignal<boolean>(!alreadyDone)

  const markComplete = async (): Promise<void> => {
    await write(options.storageKey, "done")
    setIsFirstRun(false)
  }

  return { isFirstRun, markComplete }
}
