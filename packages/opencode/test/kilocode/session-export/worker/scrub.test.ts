import { describe, test, expect } from "bun:test"
import { scrubString, isHighRiskPath, Scrubber, secretlintSecrets } from "@/kilocode/session-export/worker/scrub"

describe("scrubber", () => {
  test("redacts AWS access key id", () => {
    const out = scrubString("token=AKIAIOSFODNN7EXAMPLE here")
    expect(out.value).toContain("<<REDACTED:aws_access_key>>")
    expect(out.redactionsByType.aws_access_key).toBe(1)
  })

  test("redacts aws secret key only when anchored to the key name", () => {
    const out = scrubString('aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"')
    expect(out.value).toContain("<<REDACTED:aws_secret_key>>")
    expect(out.redactionsByType.aws_secret_key).toBe(1)
  })

  test("does not flag bare 40-char hex strings (git SHAs)", () => {
    const sha = "a".repeat(40)
    const out = scrubString(`commit ${sha} added foo`)
    expect(out.value).toContain(sha)
    expect(out.redactionsByType.aws_secret_key).toBeUndefined()
  })

  test("redacts JWT three-segment tokens", () => {
    const jwt = "eyJhbGciOi.eyJzdWIiOi.SflKxwRJSMeKKF2Q"
    const out = scrubString(`Authorization: Bearer ${jwt}`)
    expect(out.value).toContain("<<REDACTED:jwt>>")
  })

  test("redacts SSH private key block", () => {
    const blob = "-----BEGIN OPENSSH PRIVATE KEY-----\nMIIB...===\n-----END OPENSSH PRIVATE KEY-----"
    const out = scrubString(blob)
    expect(out.value).toContain("<<REDACTED:ssh_private_key>>")
    expect(out.redactionsByType.ssh_private_key).toBe(1)
  })

  test("redacts SECRET_ / *_TOKEN / PASSWORD env-style assignments", () => {
    const out = scrubString('SECRET_FOO="abc"\nDB_TOKEN=xyz\nPASSWORD=hunter2')
    expect(out.redactionsByType.env_secret).toBeGreaterThanOrEqual(3)
  })

  test("redacts provider keys with separators after sk prefix", () => {
    const out = scrubString("token=sk-proj-abcdefghijklmnopqrstuvwxyz_1234567890")
    expect(out.value).toContain("<<REDACTED:openai_key>>")
    expect(out.redactionsByType.openai_key).toBe(1)
  })

  test("isHighRiskPath flags credential-looking paths", () => {
    expect(isHighRiskPath(".env")).toBe(true)
    expect(isHighRiskPath(".env.local")).toBe(true)
    expect(isHighRiskPath(".aws/credentials")).toBe(true)
    expect(isHighRiskPath("credentials.json")).toBe(true)
    expect(isHighRiskPath("config/gcp/credentials.json")).toBe(true)
    expect(isHighRiskPath("server.pem")).toBe(true)
    expect(isHighRiskPath("server.key")).toBe(true)
    expect(isHighRiskPath(".ssh/id_rsa")).toBe(true)
    expect(isHighRiskPath("src/index.ts")).toBe(false)
  })

  test("Scrubber.scrubEvent walks string fields and accumulates counts", async () => {
    const scrubber = new Scrubber()
    const ev = { type: "x", input: { prompt: "AKIAIOSFODNN7EXAMPLE" } }
    const out = await scrubber.scrubEvent(ev)
    expect(out.success).toBe(true)
    expect(out.data.input.prompt).toContain("<<REDACTED:")
    expect(out.report.redactionsByType.aws_access_key).toBe(1)
  })

  test("Scrubber returns failure with original payload on throw", async () => {
    const regex = {
      [Symbol.replace]() {
        throw new Error("boom")
      },
    } as never
    const scrubber = new Scrubber({ patterns: [{ name: "boom", regex }] })
    const ev = { type: "x", text: "abc" }
    const out = await scrubber.scrubEvent(ev)
    expect(out.success).toBe(false)
    if (out.success) throw new Error("expected scrub failure")
    expect(out.data).toBe(ev)
    expect(out.report.failureReason).toBeTruthy()
  })

  test("Scrubber redacts basicauth and database connection URIs", async () => {
    const scrubber = new Scrubber()
    const basicauth = "https://alice:hunter2@private.example.com/path"
    const mongo = "mongodb://admin:s3cret@10.0.0.1:27017/admin"
    const out = await scrubber.scrubEvent({ type: "x", input: { text: `${basicauth}\n${mongo}` } })
    expect(out.success).toBe(true)
    expect(out.data.input.text).not.toContain(basicauth)
    expect(out.data.input.text).not.toContain(mongo)
    expect(out.data.input.text).not.toContain("hunter2")
    expect(out.data.input.text).not.toContain("s3cret")
  })

  test("secretlint extraction ignores generic id fields", () => {
    const out = secretlintSecrets([
      {
        ruleId: "rule",
        data: {
          ID: "session-id-1234",
          KEY: "real-secret",
        },
      },
    ])
    expect(out.has("session-id-1234")).toBe(false)
    expect(out.get("real-secret")).toBe("rule")
  })
})
