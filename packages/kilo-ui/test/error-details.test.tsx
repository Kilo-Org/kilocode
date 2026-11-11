import { afterEach, expect, test } from "bun:test"
import { ErrorDetails } from "../src/components/error-details"
import { mount, type Mounted } from "./harness"

const mounted: Mounted[] = []

afterEach(() => {
  for (const value of mounted) value.dispose()
  mounted.length = 0
})

test("shows the technical record of a structured error as readable JSON", () => {
  const value = mount(() => (
    <ErrorDetails
      error={{ type: "provider.rate-limit", message: "Slow down", status: 429, response: { body: "{}" } }}
    />
  ))
  mounted.push(value)

  const pre = value.host.querySelector(".error-details .error-detail-pre")
  expect(pre).not.toBeNull()
  expect(JSON.parse(pre!.textContent ?? "")).toEqual({
    type: "provider.rate-limit",
    message: "Slow down",
    status: 429,
    response: { body: "{}" },
  })
})

test("falls back to the text of a value JSON cannot hold", () => {
  const value = mount(() => <ErrorDetails error={10n} />)
  mounted.push(value)

  expect(value.host.querySelector(".error-detail-pre")?.textContent).toBe("10")
})
