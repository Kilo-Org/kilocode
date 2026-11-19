import { expect, test } from "bun:test"
import { check, code } from "./bun-probe"

const revoked = { fetch: "CERT_REVOKED", tls: "CERT_REVOKED" }

test("recognizes direct and nested certificate revocation codes", () => {
  expect(code({ code: "CERT_REVOKED" })).toBe("CERT_REVOKED")
  expect(code(new Error("fetch failed", { cause: { code: "CERT_REVOKED" } }))).toBe("CERT_REVOKED")
  expect(code({ code: "ERR_FETCH_FAILED", cause: { code: "CERT_REVOKED" } })).toBe("CERT_REVOKED")
  expect(code({ code: "ENOTFOUND" })).toBe("ENOTFOUND")
  expect(code(new Error("fetch failed"))).not.toBe("CERT_REVOKED")
})

test("requires explicit revocation from both APIs and successful normal HTTPS", () => {
  expect(check([revoked], true)).toBe(true)
  expect(check([revoked], true, true)).toBe(true)
  expect(() => check([revoked], false)).toThrow("inconclusive")
  expect(() => check([], true)).toThrow("inconclusive")
})

test.each([
  { fetch: "TRUSTED_HTTP_200", tls: "CERT_REVOKED" },
  { fetch: "TRUSTED_HTTP_500", tls: "ENOTFOUND" },
  { fetch: "ENOTFOUND", tls: "TRUSTED" },
])("blocks trusted compromised chains even if endpoints may be unavailable: %j", (result) => {
  expect(() => check([revoked, result], true, true)).toThrow("trusted a compromised")
  expect(() => check([result], false, true)).toThrow("trusted a compromised")
})

test.each([
  { fetch: "ENOTFOUND", tls: "CERT_REVOKED" },
  { fetch: "CERT_REVOKED", tls: "TLS_TIMEOUT" },
  { fetch: "fetch failed", tls: "ECONNRESET" },
])("reports transport failures as inconclusive, not passed: %j", (result) => {
  expect(() => check([result], true)).toThrow("inconclusive")
  expect(check([result], true, true)).toBe(false)
})

test("allows an unavailable control only when explicitly requested", () => {
  expect(check([revoked], false, true)).toBe(false)
  expect(check([], true, true)).toBe(false)
})
