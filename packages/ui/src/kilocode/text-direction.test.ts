import { describe, expect, test } from "bun:test"
import { countDirectionalWords, textDirection } from "./text-direction"

describe("textDirection", () => {
  test("returns auto when there is nothing directional to measure", () => {
    expect(textDirection("")).toBe("auto")
    expect(textDirection(undefined)).toBe("auto")
    expect(textDirection("123 456 - !")).toBe("auto")
  })

  test("keeps english text left to right", () => {
    expect(textDirection("Fix the auth middleware token expiry check")).toBe("ltr")
  })

  test("keeps a single borrowed rtl word from flipping english text", () => {
    expect(textDirection("The word سلام means hello in Persian")).toBe("ltr")
  })

  test("flips rtl-majority text even when it starts with a latin word", () => {
    expect(textDirection("OK باشه من این تابع را عوض میکنم")).toBe("rtl")
    expect(textDirection("TypeScript این فایل را کامپایل نمیکند")).toBe("rtl")
  })

  test("flips arabic and hebrew the same way", () => {
    expect(textDirection("API لا يعمل بشكل صحيح الآن")).toBe("rtl")
    expect(textDirection("bug הקוד הזה לא עובד כאן")).toBe("rtl")
  })

  test("flips rtl prose that is outnumbered by latin identifiers", () => {
    expect(textDirection("لطفا handleSubmit و validateForm و parseConfig را صدا بزن")).toBe("rtl")
  })

  test("does not let invisible characters vote", () => {
    // U+061C ARABIC LETTER MARK is Script=Arabic but renders nothing, so text
    // that looks purely latin must not be flipped by it.
    expect(textDirection("deploy\u061c the build\u061c now")).toBe("ltr")
    expect(countDirectionalWords("deploy\u061c the build\u061c now")).toEqual({ rtl: 0, ltr: 4 })
  })

  test("stays fast on a long unbroken token", () => {
    const blob = "data:image/png;base64," + "Q".repeat(40000)
    const start = performance.now()
    textDirection(`این عکس ${blob} را ببین`)
    expect(performance.now() - start).toBeLessThan(50)
  })

  test("ignores code spans, fences, paths and mentions when counting", () => {
    const text = ["این تابع را عوض کن", "", "```ts", "const value = someVeryLongIdentifier", "```"].join("\n")
    expect(textDirection(text)).toBe("rtl")
    expect(countDirectionalWords(text).ltr).toBe(0)
    expect(countDirectionalWords("خطا در `useEffect` و src/app/main.ts و @config.json")).toEqual({ rtl: 4, ltr: 0 })
  })
})
