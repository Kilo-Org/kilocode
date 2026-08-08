import {
  FrameBufferRenderable,
  RGBA,
  type FrameBufferOptions,
  type OptimizedBuffer,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js"

type Tier = "high" | "xhigh" | "max" | "ultra"
type EffortOptions = Omit<FrameBufferOptions, "width" | "height"> & {
  width?: FrameBufferOptions["width"] | "100%"
  height?: FrameBufferOptions["height"]
  value?: Tier
  active?: boolean
  enabled?: boolean
  onActive?: (active: boolean) => void
}

const high = RGBA.fromHex("#8b5cf6")
const xhigh = RGBA.fromHex("#06b6d4")
const max = RGBA.fromHex("#ffbd2e")
const ultra = RGBA.fromHex("#9966cc")
const rainbow = ["#cc6677", "#dd9955", "#aabb55", "#55aacc", "#7777cc", "#aa66bb"].map((value) =>
  RGBA.fromHex(value),
)
const clear = RGBA.fromValues(0, 0, 0, 0)
const period = 900

export function effortLayout(value: Tier, width: number) {
  const size = value.length * 2 - 1
  return {
    size,
    start: Math.max(0, Math.floor((width - size) / 2)),
    middle: Math.floor((width - 1) / 2),
  }
}

export function effortProgress(elapsed: number) {
  return Math.min(Math.max(elapsed / period, 0), 1)
}

export function effortMaxColor(phase: number, index: number) {
  const light = 0.35 + (Math.sin(phase / 180 - index) * 0.5 + 0.5) * 0.65
  return RGBA.fromValues(max.r * light, max.g * light, max.b * light, 1)
}

export function effortRainbowIndex(phase: number, index: number) {
  return Math.floor((phase / 55 - index + rainbow.length) % rainbow.length)
}

export function effortShimmerColor(value: "high" | "xhigh", progress: number, index: number, length: number) {
  const base = value === "high" ? high : xhigh
  const head = progress * (length + 1) - 0.5
  const distance = Math.abs(index - head)
  const light = 0.24 + Math.exp(-(distance * distance) / 0.72) * 0.76
  return RGBA.fromValues(base.r * light, base.g * light, base.b * light, 1)
}

export function isEffortTier(value: string | undefined): value is Tier {
  return value === "high" || value === "xhigh" || value === "max" || value === "ultra"
}

export function createEffortReveal(enabled: Accessor<boolean>) {
  const [alpha, setAlpha] = createSignal(1)
  let timer: ReturnType<typeof setInterval> | undefined

  const active = (value: boolean) => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (value) {
      setAlpha(0)
      return
    }
    if (!enabled()) {
      setAlpha(1)
      return
    }

    const start = performance.now()
    timer = setInterval(() => {
      const progress = Math.min((performance.now() - start) / 220, 1)
      setAlpha(progress * progress * (3 - 2 * progress))
      if (progress < 1) return
      clearInterval(timer)
      timer = undefined
    }, 16)
  }

  onCleanup(() => {
    if (timer) clearInterval(timer)
  })

  return { alpha, active }
}

export class EffortRenderable extends FrameBufferRenderable {
  private tier: Tier = "high"
  private elapsed = 0
  private transition = false
  private targetFps: number | undefined
  private maxFps: number | undefined
  private onActive?: (active: boolean) => void

  constructor(ctx: RenderContext, options: EffortOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    super(ctx, {
      ...options,
      width,
      height: 1,
      live: options.live ?? true,
      respectAlpha: true,
    })
    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.value) this.tier = options.value
    this.onActive = options.onActive
    if (options.active) this.start()
  }

  set value(value: Tier | undefined) {
    if (!value) return
    this.tier = value
    this.start()
  }

  set active(value: boolean) {
    if (value) this.start()
    if (!value) this.finish()
  }

  set activeChange(value: ((active: boolean) => void) | undefined) {
    this.onActive = value
  }

  wake() {
    this.live = false
    this.live = true
    this._ctx.requestLive()
    this.requestRender()
  }

  step(deltaTime = 1000 / 60) {
    this.renderSelf(this.frameBuffer, deltaTime)
  }

  private start() {
    this.elapsed = 0
    this.transition = true
    this.onActive?.(true)
    const renderer = this._ctx as RenderContext & { targetFps?: number; maxFps?: number }
    this.targetFps ??= renderer.targetFps
    this.maxFps ??= renderer.maxFps
    renderer.targetFps = 60
    renderer.maxFps = 60
    this.wake()
  }

  private finish() {
    if (!this.transition) return
    this.transition = false
    const renderer = this._ctx as RenderContext & { targetFps?: number; maxFps?: number }
    if (this.targetFps !== undefined) renderer.targetFps = this.targetFps
    if (this.maxFps !== undefined) renderer.maxFps = this.maxFps
    this.targetFps = undefined
    this.maxFps = undefined
    this.live = false
    this.frameBuffer.clear(clear)
    this.onActive?.(false)
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0) {
    this.frameBuffer.clear(clear)
    const delta = Math.max(deltaTime, 1000 / 60)
    if (this.transition) {
      this.elapsed += delta
      this.drawTransition()
      if (this.elapsed >= period) {
        this.finish()
        this.frameBuffer.clear(clear)
      }
    }
    super.renderSelf(buffer)
  }

  private drawTransition() {
    const width = this.frameBuffer.width
    const text = this.tier.toUpperCase()
    const layout = effortLayout(this.tier, width)
    const progress = effortProgress(this.elapsed)
    const middle = layout.middle
    const base = this.tier === "high" ? high : this.tier === "xhigh" ? xhigh : this.tier === "max" ? max : ultra

    if (this.tier === "max" || this.tier === "ultra") {
      const radius = this.tier === "max" ? (1 - progress) * middle : progress * middle
      for (let x = 0; x < width; x++) {
        const edge = Math.abs(Math.abs(x - middle) - radius)
        if (edge < 1.5) this.frameBuffer.setCell(x, 0, "█", base, clear, 1)
        else if (edge < 3.5) this.frameBuffer.setCell(x, 0, "░", base, clear)
      }
    }

    for (let index = 0; index < text.length; index++) {
      const color =
        this.tier === "ultra"
          ? rainbow[Math.floor((this.elapsed / 55 + index) % rainbow.length)]
          : this.tier === "high" || this.tier === "xhigh"
            ? effortShimmerColor(this.tier, progress, index, text.length)
            : base
      this.frameBuffer.setCell(layout.start + index * 2, 0, text[index], color, clear, 1)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    effort_animation: typeof EffortRenderable
  }
}

extend({ effort_animation: EffortRenderable })

export class EffortLabelRenderable extends FrameBufferRenderable {
  private tier: Tier = "max"
  private phase = 0
  private animate = true

  constructor(ctx: RenderContext, options: EffortOptions = {}) {
    const value = options.value ?? "max"
    super(ctx, { ...options, width: value.length, height: 1, live: options.enabled ?? true, respectAlpha: true })
    this.tier = value
    this.animate = options.enabled ?? true
  }

  set value(value: Tier | undefined) {
    if (value) {
      this.tier = value
      this.frameBuffer.resize(value.length, 1)
      this.wake()
    }
  }

  set enabled(value: boolean) {
    if (value === this.animate) return
    this.animate = value
    if (value) {
      this.wake()
      return
    }
    this.live = false
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0) {
    this.frameBuffer.clear(clear)
    if (this.animate) this.phase = (this.phase + Math.max(deltaTime, 1000 / 60)) % 2000
    const text = this.tier.toLowerCase()
    for (let index = 0; index < text.length; index++) {
      const color =
        !this.animate
          ? this.tier === "ultra"
            ? ultra
            : max
          : this.tier === "ultra"
          ? rainbow[effortRainbowIndex(this.phase, index)]
          : effortMaxColor(this.phase, index)
      this.frameBuffer.setCell(index, 0, text[index], color, clear, 1)
    }
    super.renderSelf(buffer)
  }

  wake() {
    this.live = false
    this.live = true
    this._ctx.requestLive()
    this.requestRender()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    effort_label: typeof EffortLabelRenderable
  }
}

extend({ effort_label: EffortLabelRenderable })

export function EffortLabel(props: { value: Accessor<string | undefined>; enabled: Accessor<boolean> }) {
  let target: EffortLabelRenderable | undefined
  createEffect(() => {
    const value = props.value()
    if (target && isEffortTier(value)) target.value = value
  })
  createEffect(() => {
    if (target) target.enabled = props.enabled()
  })
  onMount(() => {
    if (props.enabled()) target?.wake()
  })
  return <effort_label ref={(value: EffortLabelRenderable) => (target = value)} value="max" enabled={props.enabled()} />
}

export function EffortAnimation(props: {
  value: Accessor<string | undefined>
  enabled: Accessor<boolean>
  ready: Accessor<boolean>
  onActive?: (active: boolean) => void
}) {
  const [target, setTarget] = createSignal<EffortRenderable>()
  let previous: string | undefined
  let initialized = false

  createEffect(() => {
    const value = props.value()
    const renderable = target()
    if (!props.ready() || !renderable) return
    if (!initialized) {
      previous = value
      initialized = true
      return
    }
    if (!props.enabled() || !isEffortTier(value) || value === previous) {
      renderable.active = false
      previous = value
      return
    }
    previous = value
    renderable.value = value
  })

  createEffect(() => {
    const renderable = target()
    if (renderable) renderable.activeChange = props.onActive
  })

  onCleanup(() => {
    const renderable = target()
    if (renderable) {
      renderable.activeChange = undefined
      renderable.active = false
    }
    setTarget(undefined)
  })

  return <effort_animation ref={setTarget} position="absolute" left={0} top={1} width="100%" height={1} />
}
