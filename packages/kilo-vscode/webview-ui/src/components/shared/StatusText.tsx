/**
 * StatusText
 *
 * The working indicator is a centered cluster, so replacing the status label
 * outright moved the spinner by half the width delta — a visible jump every time
 * the agent switched from reading to editing to writing a response.
 *
 * The label box is locked to the outgoing width, then released to the incoming
 * width, so the cluster glides to its new position instead of teleporting. The
 * outgoing label stays mounted for that one crossfade, and the incoming label
 * shimmers with the same treatment the edit and write tools use for a pending
 * title, so the row reads as one live element that is being rewritten.
 */

import { type Component, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { TextShimmer } from "@kilocode/kilo-ui/text-shimmer"

/** Outlasts the width spring in chat-layout.css so the lock is released last. */
const SWAP = 520

const measure = (el: HTMLElement | undefined) => (el ? `${Math.ceil(el.getBoundingClientRect().width)}px` : undefined)

export const StatusText: Component<{ text: string }> = (props) => {
  const [label, setLabel] = createSignal(props.text)
  const [old, setOld] = createSignal<string>()
  const [width, setWidth] = createSignal<string>()

  let box: HTMLSpanElement | undefined
  let line: HTMLSpanElement | undefined
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const settle = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
    frame = undefined
    timer = undefined
    setOld(undefined)
    setWidth(undefined)
  }

  // A label that outgrows the row is clipped rather than ellipsized: it is measured
  // at its natural width for the glide, so it cannot also be clamped to the box. A
  // fade marks the cut instead, and because it is only a mask it never feeds back
  // into layout or into the measurement. Mid-glide that same fade covers the part
  // of the incoming label the box has not opened up for yet.
  //
  // Only the live label is compared. The outgoing copy stays mounted, invisible,
  // until the lock is released, and on a shrink it is wider than the box for the
  // whole glide: judged by `scrollWidth` it would mask the tail of a label that
  // does fit.
  const check = () => {
    if (!box || !line) return
    box.toggleAttribute("data-clip", line.getBoundingClientRect().width > box.clientWidth + 1)
  }

  createEffect(
    on(
      () => props.text,
      (next) => {
        if (next === label()) return
        // Read the box before the swap: mid-glide this is the animated width, so a
        // status change during a glide continues from where the box actually is.
        const from = measure(box)
        const prev = label()
        settle()
        setLabel(next)
        // Without layout (the dock is `display: none` between turns) every measure
        // is 0px, and the lock would blank the label until it is released.
        if (from === undefined || from === "0px") return
        setOld(prev)
        setWidth(from)
        // The line is `justify-self: start` and never wraps, so it keeps its
        // natural width inside the locked box and can be measured directly. The
        // frame also guarantees the swapped DOM is laid out before it is read.
        frame = requestAnimationFrame(() => {
          frame = undefined
          setWidth(measure(line))
          check()
          timer = setTimeout(settle, SWAP)
        })
      },
      { defer: true },
    ),
  )

  onCleanup(settle)

  // The box is observed because the clip state changes with its used width, whether
  // that is the surface resizing or a glide. A swap under a locked box changes only
  // the label, so the swap effect runs the same check itself.
  onMount(() => {
    const el = box
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(check)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
    check()
  })

  return (
    <span class="working-status" ref={box} data-swap={old() === undefined ? undefined : ""} style={{ width: width() }}>
      {/* Keyed so each label is a fresh node: the entry animation replays on every
          swap, which an in-place text update would not do. */}
      <Show when={label()} keyed>
        {(text) => (
          <span class="working-status-line" ref={line}>
            <TextShimmer text={text} />
          </span>
        )}
      </Show>
      <Show when={old()} keyed>
        {(text) => (
          <span class="working-status-line" data-old="" aria-hidden="true">
            <TextShimmer text={text} active={false} />
          </span>
        )}
      </Show>
    </span>
  )
}
