import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import {
  MARK_TTL_MS,
  clear,
  clearAll,
  consumeAutoTitle,
  consumeRenameAdoption,
  markAutoTitle,
  markRenameAdopted,
} from "../../../src/kilo-sessions/rename-adoptions"

describe("rename-adoptions", () => {
  beforeEach(() => clearAll())
  afterEach(() => clearAll())

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

  test("clear drops both marks for one session", () => {
    markRenameAdopted("ses_d", "R")
    markAutoTitle("ses_d", "A")
    markRenameAdopted("ses_e", "R2")
    clear("ses_d")
    expect(consumeRenameAdoption("ses_d", "R")).toBe(false)
    expect(consumeAutoTitle("ses_d", "A")).toBe(false)
    expect(consumeRenameAdoption("ses_e", "R2")).toBe(true)
  })

  test("stale marks expire after TTL", () => {
    const now = Date.now()
    const real = Date.now
    try {
      Date.now = () => now
      markRenameAdopted("ses_ttl", "Old")
      markAutoTitle("ses_ttl", "Auto")
      Date.now = () => now + MARK_TTL_MS + 1
      expect(consumeRenameAdoption("ses_ttl", "Old")).toBe(false)
      expect(consumeAutoTitle("ses_ttl", "Auto")).toBe(false)
    } finally {
      Date.now = real
    }
  })

  test("fresh marks survive within TTL", () => {
    const now = Date.now()
    const real = Date.now
    try {
      Date.now = () => now
      markRenameAdopted("ses_fresh", "Live")
      Date.now = () => now + MARK_TTL_MS - 1
      expect(consumeRenameAdoption("ses_fresh", "Live")).toBe(true)
    } finally {
      Date.now = real
    }
  })
})
