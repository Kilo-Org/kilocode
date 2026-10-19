import { expect, test } from "bun:test"
import { suiteTimes } from "./test-durations"

test("reads suite times per file from a merged runner report", () => {
  const xml = [
    '<testsuites name="packages/tui" tests="4" failures="1" time="9.000">',
    '<testsuite name="test\\cli\\a.test.tsx" file="test\\cli\\a.test.tsx" tests="2" failures="0" time="2.5">',
    '  <testsuite name="a describe block" file="test\\cli\\a.test.tsx" tests="2" failures="0" time="2.25">',
    "  </testsuite>",
    "</testsuite>",
    '<testsuite name="test/b.test.ts" file="test/b.test.ts" tests="1" failures="0" time="0.004">',
    "</testsuite>",
    '  <testsuite name="[batch 2: test/c.test.ts ..]" tests="1" failures="1" time="300.000">',
    "  </testsuite>",
    "</testsuites>",
  ].join("\n")
  expect(Object.fromEntries(suiteTimes(xml))).toEqual({
    "packages/tui/test/cli/a.test.tsx": 2500,
    "packages/tui/test/b.test.ts": 4,
  })
})
