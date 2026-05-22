import { expect, test } from "bun:test"
import { lines } from "../../src/cli/cmd/tui/ui/dialog-alert"

test("DialogAlert splits message newlines into renderable lines", () => {
  expect(lines("You're not a member of any teams.\nVisit https://app.kilo.ai to create or join a team.")).toEqual([
    "You're not a member of any teams.",
    "Visit https://app.kilo.ai to create or join a team.",
  ])
})
