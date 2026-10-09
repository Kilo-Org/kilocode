import { describe, expect, test } from "bun:test"
import { parse } from "../../src/services/browser-automation/browser-policy"

describe("browser URL policy", () => {
  test.each([
    ["http://localhost:5173/path?q=1#section", "http://localhost:5173/path?q=1#section"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/"],
    ["https://www.google.com/search?q=browser", "https://www.google.com/search?q=browser"],
    ["https://STATIC.Example.COM.:8443/a", "https://static.example.com:8443/a"],
    ["https://bücher.example/", "https://xn--bcher-kva.example/"],
    ["https://8.8.8.8:8443/", "https://8.8.8.8:8443/"],
    ["https://[2606:4700:4700::1111]/", "https://[2606:4700:4700::1111]/"],
    ["https://unresolved.example/", "https://unresolved.example/"],
  ])("accepts %s", (value, expected) => {
    expect(parse(value).href).toBe(expected)
  })

  test.each([
    "http://example.com/",
    "http://[::1]:3000/",
    "http://localhost.:3000/",
    "http://app.localhost:3000/",
    "https://localhost/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://127.0.0.1/",
    "https://127.1/",
    "https://0x7f000001/",
    "https://2130706433/",
    "https://0.0.0.0/",
    "https://10.0.0.1/",
    "https://172.16.0.1/",
    "https://192.168.0.1/",
    "https://169.254.169.254/",
    "https://100.64.0.1/",
    "https://192.0.2.1/",
    "https://224.0.0.1/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://[fc00::1]/",
    "https://[::ffff:8.8.8.8]/",
    "https://[64:ff9b::808:808]/",
    "https://user:secret@example.com/",
    "http://user@localhost:3000/",
    "https://@example.com/",
    "https://example.com:65536/",
    "https://8.8.8.8:0/",
    "http://localhost:0/",
    "https://*.example.com/",
    "https://example..com/",
    "https:example.com",
    " https://example.com/",
    "https://example.com/\n",
    "https://exam\tple.com/",
    "https://example.com\\@localhost/",
    "ws://localhost:3000/",
    "wss://example.com/",
    "file:///tmp/example.html",
    "data:text/html,test",
  ])("rejects %s", (value) => {
    expect(() => parse(value)).toThrow()
  })
})
