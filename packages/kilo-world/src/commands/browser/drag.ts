import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"

export namespace Drag {
  export type Input = {
    session?: string
    from?: string
    to?: string
  }

  const REF_RE = /^e\d+$/

  async function point(
    page: import("playwright").Page,
    session: string,
    raw: string,
  ): Promise<{ x: number; y: number }> {
    const ref = REF_RE.test(raw) ? raw : undefined
    const selector = ref ? undefined : raw
    return Refs.use(page, session, ref, selector, async (target) => {
      const box = await target.boundingBox()
      if (!box) throw new Error(`no bounding box for ${raw}`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
  }

  export async function run(input: Input): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    const fromRaw = input.from
    const toRaw = input.to
    if (!fromRaw || !toRaw) throw new Error("--from and --to are required")
    const from = await point(page, session, fromRaw)
    const to = await point(page, session, toRaw)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    return { from, to }
  }
}
