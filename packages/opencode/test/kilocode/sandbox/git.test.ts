import { describe, expect, test } from "bun:test"
import { mutates } from "@/kilocode/sandbox/git"

describe("sandbox Git mutation classification", () => {
  test("allows read-only Git commands to remain sandboxed", () => {
    for (const command of [
      "git status",
      "git diff --cached",
      "git log --oneline -5",
      "git show HEAD:file.ts",
      "git rev-parse --show-toplevel",
      "git branch --all",
      "git tag --list",
      "git config --get user.name",
      "GIT_DIR=/repo/.git git status",
      "GIT_INDEX_FILE=/tmp/index git diff",
    ]) {
      expect(mutates(command)).toBe(false)
    }
  })

  test("requires escalation for Git state mutations", () => {
    for (const command of [
      "git add src/index.ts",
      "git commit -m message",
      "git checkout -b feature",
      "git merge main",
      "git rebase main",
      "git stash push",
      "git -C /repo reset --hard HEAD",
      "git config user.name Agent",
      "git unknown-subcommand",
      "GIT_INDEX_FILE=/tmp/index git commit -m message",
      "KILO_TEST=1 GIT_INDEX_FILE=/tmp/index git add src/index.ts",
    ]) {
      expect(mutates(command)).toBe(true)
    }
  })

  test("does not classify unrelated commands as Git mutations", () => {
    expect(mutates("echo git commit -m unsafe")).toBe(false)
    expect(mutates("npm run git-status")).toBe(false)
  })

  test("classifies Git mutations inside compound shell commands", () => {
    expect(mutates("git add .")).toBe(true)
    expect(mutates("git add . && git commit -m message")).toBe(false)
  })
})
