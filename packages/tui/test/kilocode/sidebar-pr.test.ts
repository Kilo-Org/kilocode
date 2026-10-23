import { expect, test } from "bun:test"
import { lookup, parent, select, type Run } from "../../src/kilocode/plugins/sidebar-pr"

test("shows the PR of the checked-out tracking ref first", async () => {
  const run: Run = async (cmd) => {
    if (cmd.join(" ") === "gh pr view --json number,title") return { code: 0, text: `{"number":7,"title":"Tracking"}` }
    return { code: 1, text: "" }
  }
  expect(await lookup("/repo", "feature", run)).toEqual({ number: 7, title: "Tracking" })
})

test("falls back to the branch name when the tracking ref has no PR", async () => {
  const run: Run = async (cmd) => {
    if (cmd.join(" ") === "gh pr view feature --json number,title")
      return { code: 0, text: `{"number":9,"title":"Branch"}` }
    return { code: 1, text: "" }
  }
  expect(await lookup("/repo", "feature", run)).toEqual({ number: 9, title: "Branch" })
})

test("accepts a SHA lookup only when headRefOid equals HEAD", async () => {
  const run: Run = async (cmd) => {
    const line = cmd.join(" ")
    if (line === "git rev-parse HEAD") return { code: 0, text: "abc123" }
    if (line.startsWith("gh pr list --state open --search abc123 is:pr"))
      return {
        code: 0,
        text: JSON.stringify([
          { number: 1, title: "Other", headRefOid: "zzz" },
          { number: 2, title: "Match", headRefOid: "abc123" },
        ]),
      }
    return { code: 1, text: "" }
  }
  expect(await lookup("/repo", "feature", run)).toEqual({ number: 2, title: "Match" })
  expect(select(`[{"number":1,"title":"Other","headRefOid":"zzz"}]`, "abc123")).toBeNull()
})

test("looks up the fork parent by head branch when the local repo has no PR", async () => {
  const run: Run = async (cmd) => {
    const line = cmd.join(" ")
    if (line === "git rev-parse HEAD") return { code: 0, text: "abc123" }
    if (line === "gh repo view --json nameWithOwner,parent")
      return {
        code: 0,
        text: JSON.stringify({ nameWithOwner: "me/fork", parent: { owner: { login: "up" }, name: "repo" } }),
      }
    if (line === "gh pr list -R up/repo --state open --head feature --limit 10 --json number,title,headRefOid")
      return { code: 0, text: JSON.stringify([{ number: 4, title: "Fork", headRefOid: "abc123" }]) }
    return { code: 1, text: "" }
  }
  expect(await lookup("/repo", "feature", run)).toEqual({ number: 4, title: "Fork" })
  expect(parent(JSON.stringify({ nameWithOwner: "up/repo", parent: null }))).toBeNull()
})

test("shows nothing when gh is unavailable", async () => {
  const run: Run = async () => ({ code: 127, text: "" })
  expect(await lookup("/repo", "feature", run)).toBeNull()
})
