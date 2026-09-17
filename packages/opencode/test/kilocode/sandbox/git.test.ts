import { describe, expect, test } from "bun:test"
import { mutates } from "@/kilocode/sandbox/git"

const read = [
  "git status",
  "git diff --cached",
  "git log --oneline -5",
  "git show HEAD:file.ts",
  "git rev-parse --show-toplevel",
  "git remote",
  "git remote -v",
  "git remote --verbose",
  "git remote show origin",
  "git remote get-url origin",
  "git stash list",
  "git stash show",
  "git stash show -p",
  "git branch",
  "git branch -v",
  "git branch -vv",
  "git branch -a",
  "git branch -r",
  "git branch --list",
  "git tag",
  "git tag -l",
  "git tag --list",
  "git ls-remote",
  "git ls-remote --heads origin",
  "git config --get user.name",
  "git config --list",
  "git worktree list",
  "git worktree list --porcelain",
  "git reflog",
  "git reflog show",
  "git reflog exists HEAD",
  "git notes",
  "git notes list",
  "git notes show HEAD",
  "GIT_DIR=/repo/.git git status",
  "GIT_INDEX_FILE=/tmp/index git diff",
]

const write = [
  "git add src/index.ts",
  "git commit -m message",
  "git checkout -b feature",
  "git merge main",
  "git rebase main",
  "git fetch origin",
  "git pull",
  "git push origin main",
  "git clone https://example.com/repo.git",
  "git remote add origin url",
  "git remote set-url origin url",
  "git remote remove origin",
  "git remote rename origin upstream",
  "git remote prune origin",
  "git stash",
  "git stash push",
  "git stash pop",
  "git stash drop",
  "git stash apply",
  "git stash clear",
  "git branch feature",
  "git branch -d feature",
  "git branch -D feature",
  "git branch -m old new",
  "git branch --set-upstream-to origin/main",
  "git tag v1.0.0",
  "git tag -d v1.0.0",
  "git tag -a v1.0.0 -m release",
  "git config user.name Agent",
  "git config --unset user.name",
  "git worktree add ../wt",
  "git worktree remove ../wt",
  "git worktree prune",
  "git reflog expire --all",
  "git reflog delete HEAD@{0}",
  "git notes add -m note",
  "git notes remove HEAD",
  "git -C /repo reset --hard HEAD",
  "git unknown-subcommand",
  "GIT_INDEX_FILE=/tmp/index git commit -m message",
  "KILO_TEST=1 GIT_INDEX_FILE=/tmp/index git add src/index.ts",
]

describe("sandbox Git mutation classification", () => {
  test("allows read-only Git commands to remain sandboxed", () => {
    for (const command of read) {
      expect(mutates(command)).toBe(false)
    }
  })

  test("requires escalation for Git state mutations", () => {
    for (const command of write) {
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
