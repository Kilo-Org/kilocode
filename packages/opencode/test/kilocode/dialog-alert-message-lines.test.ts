import { describe, expect, test } from "bun:test"
import { dialogAlertMessageLines } from "../../src/cli/cmd/tui/ui/dialog-alert"

describe("dialogAlertMessageLines", () => {
  test("splits newline-delimited alert messages into renderable lines", () => {
    expect(dialogAlertMessageLines("You're not a member of any teams.\nVisit https://app.kilo.ai")).toEqual([
      "You're not a member of any teams.",
      "Visit https://app.kilo.ai",
    ])
  })

  test("handles CRLF alert messages", () => {
    expect(dialogAlertMessageLines("first\r\nsecond\rthird")).toEqual(["first", "second", "third"])
  })
})
