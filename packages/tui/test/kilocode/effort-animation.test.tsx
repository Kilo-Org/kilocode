import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import {
  createEffortReveal,
  effortLayout,
  effortMaxColor,
  effortProgress,
  effortRainbowIndex,
  effortShimmerColor,
  isEffortTier,
} from "../../src/kilocode/effort-animation"

describe("effort animation", () => {
  test("centers labels inside the prompt content width", () => {
    expect(effortLayout("high", 71)).toEqual({ size: 7, start: 32, middle: 35 })
    expect(effortLayout("xhigh", 71)).toEqual({ size: 9, start: 31, middle: 35 })
    expect(effortLayout("max", 71)).toEqual({ size: 5, start: 33, middle: 35 })
    expect(effortLayout("ultra", 71)).toEqual({ size: 9, start: 31, middle: 35 })
  })

  test("advances intermediate frames before completion", () => {
    expect(effortProgress(0)).toBe(0)
    expect(effortProgress(450)).toBeCloseTo(0.5)
    expect(effortProgress(900)).toBe(1)
  })

  test("recognizes only supported effort tiers", () => {
    expect(isEffortTier("high")).toBe(true)
    expect(isEffortTier("xhigh")).toBe(true)
    expect(isEffortTier("max")).toBe(true)
    expect(isEffortTier("ultra")).toBe(true)
    expect(isEffortTier("medium")).toBe(false)
    expect(isEffortTier("ultracode")).toBe(false)
  })

  test("changes max brightness over time without using invalid alpha values", () => {
    const start = effortMaxColor(0, 0).toInts()
    const peak = effortMaxColor(Math.PI * 90, 0).toInts()
    expect(start).not.toEqual(peak)
    expect(start[3]).toBe(255)
    expect(peak[3]).toBe(255)
    expect(peak[0]).toBeGreaterThan(start[0])
  })

  test("moves persistent max and ultra accents from left to right", () => {
    const maxLeft = effortMaxColor(Math.PI * 90, 0).toInts()[0]
    const maxRight = effortMaxColor(Math.PI * 90, 1).toInts()[0]
    const maxLaterLeft = effortMaxColor((Math.PI / 2 + 1) * 180, 0).toInts()[0]
    const maxLaterRight = effortMaxColor((Math.PI / 2 + 1) * 180, 1).toInts()[0]
    expect(maxLeft).toBeGreaterThan(maxRight)
    expect(maxLaterRight).toBeGreaterThan(maxLaterLeft)
    expect(effortRainbowIndex(0, 0)).toBe(0)
    expect(effortRainbowIndex(55, 1)).toBe(0)
  })

  test("moves the high and xhigh shimmer between letters", () => {
    const highStart = effortShimmerColor("high", 0.1, 0, 4).toInts()
    const highEnd = effortShimmerColor("high", 0.9, 0, 4).toInts()
    const xhighStart = effortShimmerColor("xhigh", 0.1, 0, 5).toInts()
    expect(highStart[0]).toBeGreaterThan(highEnd[0])
    expect(highStart[3]).toBe(255)
    expect(xhighStart[3]).toBe(255)
    expect(highStart.slice(0, 3)).not.toEqual(xhighStart.slice(0, 3))
  })

  test("renders intermediate frames centered in its parent width", async () => {
    let target: import("../../src/kilocode/effort-animation").EffortRenderable | undefined
    const app = await testRender(
      () => (
        <box width={40}>
          <effort_animation ref={(value) => (target = value)} width="100%" height={1} live />
        </box>
      ),
      { width: 80, height: 2 },
    )

    try {
      await app.renderOnce()
      expect(target!.width).toBe(40)
      expect(target!.frameBuffer.width).toBe(40)
      target!.value = "xhigh"
      target!.step(180)
      const raw = new TextDecoder().decode(target!.frameBuffer.getRealCharBytes(true))
      expect(raw).toContain("X H I G H")
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("X H I G H")
      expect(frame.indexOf("X H I G H")).toBe(15)
    } finally {
      app.renderer.destroy()
    }
  })

  test("reports active state only for the transition duration", async () => {
    const states: boolean[] = []
    let target: import("../../src/kilocode/effort-animation").EffortRenderable | undefined
    const app = await testRender(
      () => <effort_animation ref={(value) => (target = value)} width={40} height={1} onActive={states.push.bind(states)} />,
      { width: 40, height: 1 },
    )

    try {
      await app.renderOnce()
      target!.value = "max"
      target!.step(450)
      target!.step(450)
      expect(states).toEqual([true, false])
    } finally {
      app.renderer.destroy()
    }
  })

  test("can replay an effort tier after another variant", async () => {
    const states: boolean[] = []
    let target: import("../../src/kilocode/effort-animation").EffortRenderable | undefined
    const app = await testRender(
      () => <effort_animation ref={(value) => (target = value)} width={40} height={1} onActive={states.push.bind(states)} />,
      { width: 40, height: 1 },
    )

    try {
      await app.renderOnce()
      target!.value = "max"
      target!.step(900)
      target!.value = "max"
      target!.step(900)
      expect(states).toEqual([true, false, true, false])
    } finally {
      app.renderer.destroy()
    }
  })

  test("reveals metadata immediately when animations are disabled", async () => {
    let reveal: ReturnType<typeof createEffortReveal> | undefined
    const app = await testRender(() => {
      reveal = createEffortReveal(() => false)
      return <text>{reveal.alpha()}</text>
    })

    try {
      reveal!.active(true)
      expect(reveal!.alpha()).toBe(0)
      reveal!.active(false)
      expect(reveal!.alpha()).toBe(1)
    } finally {
      app.renderer.destroy()
    }
  })

  test("stops persistent effort labels when animations are disabled", async () => {
    let target: import("../../src/kilocode/effort-animation").EffortLabelRenderable | undefined
    const app = await testRender(
      () => <effort_label ref={(value) => (target = value)} value="ultra" enabled={false} />,
      { width: 10, height: 1 },
    )

    try {
      await app.renderOnce()
      expect(target!.live).toBe(false)
      target!.enabled = true
      expect(target!.live).toBe(true)
    } finally {
      app.renderer.destroy()
    }
  })

  test("renders an absolute transition on the metadata row without changing parent height", async () => {
    let target: import("../../src/kilocode/effort-animation").EffortRenderable | undefined
    const app = await testRender(
      () => (
        <box position="relative" width={40} height={2} paddingTop={1}>
          <effort_animation
            ref={(value) => (target = value)}
            position="absolute"
            left={0}
            top={1}
            width="100%"
            height={1}
          />
        </box>
      ),
      { width: 80, height: 3 },
    )

    try {
      await app.renderOnce()
      target!.value = "xhigh"
      target!.step(180)
      await app.renderOnce()
      const lines = app.captureCharFrame().split("\n")
      expect(lines[0]?.trim()).toBe("")
      expect(lines[1]).toContain("X H I G H")
      expect(target!.parent?.height).toBe(2)
    } finally {
      app.renderer.destroy()
    }
  })
})
