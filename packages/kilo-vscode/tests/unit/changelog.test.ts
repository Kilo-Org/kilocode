import { describe, expect, it, mock } from "bun:test"
import { changelog, showChangelogOnUpdate } from "../../src/changelog"

describe("showChangelogOnUpdate", () => {
  it("stores version on first run", async () => {
    const update = mock(async () => {})
    const show = mock(async () => "")
    const open = mock(async () => true)

    await showChangelogOnUpdate({
      version: "1.2.3",
      previous: undefined,
      update,
      show,
      open,
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith("1.2.3")
    expect(show).toHaveBeenCalledTimes(0)
    expect(open).toHaveBeenCalledTimes(0)
  })

  it("does nothing when version is unchanged", async () => {
    const update = mock(async () => {})
    const show = mock(async () => "")
    const open = mock(async () => true)

    await showChangelogOnUpdate({
      version: "1.2.3",
      previous: "1.2.3",
      update,
      show,
      open,
    })

    expect(update).toHaveBeenCalledTimes(0)
    expect(show).toHaveBeenCalledTimes(0)
    expect(open).toHaveBeenCalledTimes(0)
  })

  it("updates version and skips links when user does not click action", async () => {
    const update = mock(async () => {})
    const show = mock(async () => undefined)
    const open = mock(async () => true)

    await showChangelogOnUpdate({
      version: "1.2.3",
      previous: "1.2.2",
      update,
      show,
      open,
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(0)
  })

  it("opens release URL when user clicks action", async () => {
    const update = mock(async () => {})
    const show = mock(async () => changelog.action)
    const open = mock(async () => true)

    await showChangelogOnUpdate({
      version: "1.2.3-beta+1",
      previous: "1.2.2",
      update,
      show,
      open,
    })

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(`${changelog.release}/v1.2.3-beta%2B1`)
  })

  it("falls back to changelog when release URL fails", async () => {
    const update = mock(async () => {})
    const show = mock(async () => changelog.action)
    const open = mock(async (url: string) => !url.includes("/tag/"))

    await showChangelogOnUpdate({
      version: "v1.2.3",
      previous: "1.2.2",
      update,
      show,
      open,
    })

    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenNthCalledWith(1, `${changelog.release}/v1.2.3`)
    expect(open).toHaveBeenNthCalledWith(2, changelog.url)
  })

  it("ignores empty version", async () => {
    const update = mock(async () => {})
    const show = mock(async () => "")
    const open = mock(async () => true)

    await showChangelogOnUpdate({
      version: "",
      previous: "1.2.2",
      update,
      show,
      open,
    })

    expect(update).toHaveBeenCalledTimes(0)
    expect(show).toHaveBeenCalledTimes(0)
    expect(open).toHaveBeenCalledTimes(0)
  })
})
