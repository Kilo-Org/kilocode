import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Notices } from "../../src/kilocode/notices"

const noticesPath = path.join(Global.Path.state, "notices.json")

beforeEach(async () => {
  await fs.rm(noticesPath, { force: true }).catch(() => {})
})

afterEach(async () => {
  await fs.rm(noticesPath, { force: true }).catch(() => {})
})

describe("Notices (mobile app promo targeting)", () => {
  test("does not show the notice for users who have never used a Cloud Agent / remote session", async () => {
    expect(await Notices.shouldShowMobileAppNotice()).toBe(false)
  })

  test("shows the notice once a Cloud Agent / remote session has been used", async () => {
    await Notices.markCloudAgentUsed()
    expect(await Notices.shouldShowMobileAppNotice()).toBe(true)
  })

  test("persists dismissal so the notice never shows again, even across separate reads", async () => {
    await Notices.markCloudAgentUsed()
    expect(await Notices.shouldShowMobileAppNotice()).toBe(true)

    await Notices.dismissMobileAppNotice()
    expect(await Notices.shouldShowMobileAppNotice()).toBe(false)

    // Simulate re-marking cloud agent usage (e.g. re-enabling /remote) — must stay dismissed.
    await Notices.markCloudAgentUsed()
    expect(await Notices.shouldShowMobileAppNotice()).toBe(false)
  })

  test("is idempotent when Cloud Agent usage is marked more than once", async () => {
    await Notices.markCloudAgentUsed()
    await Notices.markCloudAgentUsed()
    const raw = JSON.parse(await fs.readFile(noticesPath, "utf-8"))
    expect(raw.cloud_agent_used).toBe(true)
  })
})
