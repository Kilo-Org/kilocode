import { describe, it, expect } from "bun:test"
import { isLibcCompatible } from "../../script/postinstall.mjs"

describe("postinstall libc guard (#13282)", () => {
  describe("glibc system (musl=false)", () => {
    it("accepts the standard glibc arm64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-arm64", false)).toBe(true)
    })

    it("rejects the musl arm64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-arm64-musl", false)).toBe(false)
    })

    it("accepts the standard glibc x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64", false)).toBe(true)
    })

    it("rejects the musl x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64-musl", false)).toBe(false)
    })

    it("rejects the baseline musl x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64-baseline-musl", false)).toBe(false)
    })

    it("accepts non-linux packages regardless of name", () => {
      expect(isLibcCompatible("@kilocode/cli-darwin-arm64", false)).toBe(true)
      expect(isLibcCompatible("@kilocode/cli-windows-x64", false)).toBe(true)
    })
  })

  describe("musl system (musl=true)", () => {
    it("rejects the standard glibc arm64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-arm64", true)).toBe(false)
    })

    it("accepts the musl arm64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-arm64-musl", true)).toBe(true)
    })

    it("rejects the standard glibc x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64", true)).toBe(false)
    })

    it("accepts the musl x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64-musl", true)).toBe(true)
    })

    it("accepts the baseline musl x64 package", () => {
      expect(isLibcCompatible("@kilocode/cli-linux-x64-baseline-musl", true)).toBe(true)
    })

    it("accepts non-linux packages regardless of name", () => {
      expect(isLibcCompatible("@kilocode/cli-darwin-arm64", true)).toBe(true)
      expect(isLibcCompatible("@kilocode/cli-windows-x64", true)).toBe(true)
    })
  })
})
