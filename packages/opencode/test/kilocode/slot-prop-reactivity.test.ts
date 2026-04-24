/**
 * Regression test for the Slot wrapper in plugin/slots.tsx.
 *
 * This test locks in two things:
 *   1. A static invariant: the wrapper does NOT spread raw props (`...props`),
 *      which would silently reintroduce the regression on refactors.
 *   2. A runtime check: forwarding props through the same pattern used in
 *      slots.tsx preserves reactivity for arbitrary props (not just children).
 */

import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { children, createEffect, createRoot, createSignal, mergeProps } from "solid-js"

const SLOTS_FILE = path.resolve(import.meta.dir, "../../src/cli/cmd/tui/plugin/slots.tsx")

describe("Slot wrapper preserves prop reactivity", () => {
  test("slots.tsx does not use `{...props}` spread to forward props", () => {
    // Spread on a plain object in Solid evaluates every prop once and freezes
    // it. mergeProps (or a getter per prop) is required to keep reactivity.
    const content = fs.readFileSync(SLOTS_FILE, "utf-8")
    const wrapper = content.match(/export const Slot[\s\S]*?^}/m)?.[0] ?? ""
    expect(wrapper).not.toBe("")
    expect(wrapper).not.toMatch(/\.\.\.props/)
  })

  test("slots.tsx forwards props through mergeProps (or per-prop getters)", () => {
    const content = fs.readFileSync(SLOTS_FILE, "utf-8")
    const wrapper = content.match(/export const Slot[\s\S]*?^}/m)?.[0] ?? ""
    const usesMergeProps = /mergeProps\s*\(/.test(wrapper)
    expect(usesMergeProps).toBe(true)
  })

  test("mergeProps preserves reactivity of non-children props", () => {
    // Simulates the exact pattern used in slots.tsx: resolve children via the
    // `children()` helper and forward the rest via mergeProps. Non-children
    // reactive props (like `visible`, `disabled`, `ref`) must keep tracking
    // their source signals — otherwise the slot-internal consumer (opentui
    // registry → plugin) sees a frozen initial value.
    const [visible, setVisible] = createSignal(true)
    const [disabled, setDisabled] = createSignal(false)
    const refCalls: Array<string> = []
    const refA = () => refCalls.push("a")
    const refB = () => refCalls.push("b")
    const [ref, setRef] = createSignal<() => void>(refA)

    const seen: Array<{ visible: boolean; disabled: boolean }> = []
    const refSeen: Array<() => void> = []

    const dispose = createRoot((dispose) => {
      // Pretend JSX: reactive props passed into the Slot wrapper.
      const sourceProps = {
        get visible() {
          return visible()
        },
        get disabled() {
          return disabled()
        },
        get ref() {
          return ref()
        },
        children: "unused",
      }

      // This mirrors plugin/slots.tsx exactly.
      const value = children(() => sourceProps.children)
      const merged = mergeProps(sourceProps, {
        get children() {
          return value()
        },
      }) as typeof sourceProps

      createEffect(() => {
        seen.push({ visible: merged.visible, disabled: merged.disabled })
      })
      createEffect(() => {
        refSeen.push(merged.ref)
      })

      return dispose
    })

    // Initial render tracked.
    expect(seen).toEqual([{ visible: true, disabled: false }])
    expect(refSeen.length).toBe(1)
    expect(refSeen[0]).toBe(refA)

    // Flip the source signals — the merged view must update.
    setVisible(false)
    expect(seen).toEqual([
      { visible: true, disabled: false },
      { visible: false, disabled: false },
    ])

    setDisabled(true)
    expect(seen[seen.length - 1]).toEqual({ visible: false, disabled: true })

    // Ref callback must also track through the wrapper — this is what makes
    // the session prompt ref={bind} actually attach/re-attach correctly.
    setRef(() => refB)
    expect(refSeen.length).toBe(2)
    expect(refSeen[1]).toBe(refB)

    dispose()
  })

  test("plain `{...props}` spread does NOT preserve reactivity (proves the regression)", () => {
    // Negative control: the exact bug we're guarding against. A spread into a
    // plain object decouples the reactive source, so an effect on the copy
    // only fires once.
    const [visible, setVisible] = createSignal(true)
    let fires = 0

    const dispose = createRoot((dispose) => {
      const sourceProps = {
        get visible() {
          return visible()
        },
      }

      // BUG pattern — copies the value at evaluation time.
      const frozen = { ...sourceProps } as { visible: boolean }

      createEffect(() => {
        // Touch frozen.visible to subscribe (but it's a static property now).
        void frozen.visible
        fires++
      })

      return dispose
    })

    expect(fires).toBe(1)
    setVisible(false)
    // A correctly reactive wrapper would have fired again; the frozen copy
    // does not. Keeping this assertion documents why mergeProps is required.
    expect(fires).toBe(1)

    dispose()
  })
})
