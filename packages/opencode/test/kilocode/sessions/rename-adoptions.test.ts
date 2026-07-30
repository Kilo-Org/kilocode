import { describe, expect, test } from "bun:test"
import {
  consumeAutoTitle,
  consumeRenameAdoption,
  markAutoTitle,
  markRenameAdopted,
} from "../../../src/kilo-sessions/rename-adoptions"

describe("rename-adoptions", () => {
  test("rename adoption consumes only on exact title match", () => {
    markRenameAdopted("ses_a", "Cloud title")
    expect(consumeRenameAdoption("ses_a", "other")).toBe(false)
    expect(consumeRenameAdoption("ses_a", "Cloud title")).toBe(true)
    expect(consumeRenameAdoption("ses_a", "Cloud title")).toBe(false)
  })

  test("auto-title mark consumes only on exact title match", () => {
    markAutoTitle("ses_b", "Auto title")
    expect(consumeAutoTitle("ses_b", "other")).toBe(false)
    expect(consumeAutoTitle("ses_b", "Auto title")).toBe(true)
    expect(consumeAutoTitle("ses_b", "Auto title")).toBe(false)
  })

  test("rename and auto-title marks are independent per session", () => {
    markRenameAdopted("ses_c", "R")
    markAutoTitle("ses_c", "A")
    expect(consumeAutoTitle("ses_c", "A")).toBe(true)
    expect(consumeRenameAdoption("ses_c", "R")).toBe(true)
  })
})
