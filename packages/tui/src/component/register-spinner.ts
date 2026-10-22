// kilocode_change start - register against Kilo's active OpenTUI runtime instead of opentui-spinner's nested 0.3 runtime
import {
  type ColorInput,
  type OptimizedBuffer,
  parseColor,
  Renderable,
  type RenderableOptions,
  type RenderContext,
  resolveRenderLib,
} from "@opentui/core"
import { extend, getComponentCatalogue } from "@opentui/solid/components"
import type { ColorGenerator } from "../ui/spinner"

interface SpinnerOptions extends RenderableOptions<SpinnerRenderable> {
  frames?: string[]
  interval?: number
  color?: ColorInput | ColorGenerator
}

class SpinnerRenderable extends Renderable {
  private list: string[]
  private delay: number
  private tone: ColorInput | ColorGenerator
  private parsed = parseColor("white")
  private frame = 0
  private encoded: Record<string, NonNullable<ReturnType<typeof OptimizedBuffer.prototype.encodeUnicode>>> = {}
  private lib = resolveRenderLib()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(ctx: RenderContext, options: SpinnerOptions) {
    super(ctx, options)
    this.list = options.frames?.length ? options.frames : ["⠋"]
    this.delay = options.interval ?? 80
    this.tone = options.color ?? "white"
    if (typeof this.tone !== "function") this.parsed = parseColor(this.tone)
    this.height = 1
    this.encode()
    this.start()
  }

  private encode() {
    this.encoded = {}
    this.width = 0
    for (const frame of this.list) {
      const encoded = this.lib.encodeUnicode(frame, this.ctx.widthMethod)
      if (!encoded) continue
      this.encoded[frame] = encoded
      this.width = Math.max(
        this.width,
        encoded.data.reduce((width, char) => width + char.width, 0),
      )
    }
  }

  private free() {
    for (const frame of Object.values(this.encoded)) this.lib.freeUnicode(frame)
    this.encoded = {}
  }

  private start() {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => {
      if (this.isDestroyed || !this.visible) return
      this.frame = (this.frame + 1) % this.list.length
      this.requestRender()
    }, this.delay)
    this.timer.unref()
  }

  get frames() {
    return this.list
  }

  set frames(value: string[]) {
    if (
      value.length === 0 ||
      (value.length === this.list.length && value.every((frame, index) => frame === this.list[index]))
    )
      return
    this.free()
    this.list = value
    this.frame = 0
    this.encode()
    this.requestRender()
  }

  get interval() {
    return this.delay
  }

  set interval(value: number) {
    if (value === this.delay) return
    this.delay = value
    this.start()
  }

  get color() {
    return this.tone
  }

  set color(value: ColorInput | ColorGenerator) {
    this.tone = value
    if (typeof value !== "function") this.parsed = parseColor(value)
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const frame = this.encoded[this.list[this.frame]]
    if (!frame) return
    const background = parseColor("transparent")
    let x = this.x
    for (let index = 0; index < frame.data.length; index++) {
      const char = frame.data[index]
      const color =
        typeof this.tone === "function"
          ? parseColor(this.tone(this.frame, index, this.list.length, frame.data.length))
          : this.parsed
      buffer.drawChar(char.char, x, this.y, color, background)
      x += char.width
    }
  }

  protected override destroySelf() {
    if (this.timer) clearInterval(this.timer)
    this.free()
    super.destroySelf()
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    spinner: typeof SpinnerRenderable
  }
}

export function registerOpencodeSpinner() {
  if (!getComponentCatalogue().spinner) extend({ spinner: SpinnerRenderable })
}
// kilocode_change end
