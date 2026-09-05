import { expect, test } from "bun:test"
import { sessionEpilogue } from "../src/tui-plugin/epilogue"
import { parseTuiArgs } from "../src/tui"

test("formats the Kilo session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  const plain = epilogue.replaceAll(/\x1b\[[0-9;]*m/g, "")
  expect(epilogue).toContain("\x1b[38;2;255;255;255m")
  expect(plain).toContain("██  ██")
  expect(plain).toContain("A session")
  expect(plain).toContain("kilo2 -s ses_123")
  expect(plain.toLowerCase()).not.toContain("opencode")
})

test("parses the displayed Kilo resume command", () => {
  expect(parseTuiArgs(["-s", "ses_123"])).toEqual({ sessionID: "ses_123" })
  expect(parseTuiArgs(["--session", "ses_123"])).toEqual({ sessionID: "ses_123" })
  expect(parseTuiArgs(["./project"])).toEqual({ directory: "./project" })
  expect(() => parseTuiArgs(["-s"])).toThrow("Usage: kilo2")
})
