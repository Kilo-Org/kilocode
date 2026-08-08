import { dirname } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import { Launch } from "../../core/browser/launch"
import { Runner } from "../../core/browser/runner"

export namespace Screenshot {
  export type Format = "png" | "jpeg"

  export type Input = {
    session?: string
    out: string
    full?: boolean
    waitMs?: number
    type?: Format
    quality?: number
  }

  export async function run(input: Input): Promise<{ out: string; bytes: number; mime: string }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    mkdirSync(dirname(input.out), { recursive: true })
    const wait = input.waitMs ?? Launch.SCREENSHOT_PAINT_WAIT_MS_DEFAULT
    if (wait > 0) await page.waitForTimeout(wait)
    const type: Format = input.type ?? "jpeg"
    const quality = clampQuality(input.quality)
    const buffer = await page.screenshot({
      fullPage: input.full ?? false,
      type,
      timeout: Launch.SCREENSHOT_TIMEOUT_MS_DEFAULT,
      ...(type === "jpeg" ? { quality } : {}),
    })
    writeFileSync(input.out, buffer)
    return {
      out: input.out,
      bytes: buffer.byteLength,
      mime: `image/${type}`,
    }
  }
}

function clampQuality(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 80
  if (value < 50) return 50
  if (value > 100) return 100
  return Math.round(value)
}
