import { expect, test } from "bun:test"
import { Installer } from "../src/marketplace/installer"
import { KiloMarketplaceRegistry } from "../src/marketplace/kilo"

for (const content of [
  {
    command: "npx",
    args: ["-y", "demo", "--token", "{{TOKEN}}", "--region", "${REGION}"],
    env: { TOKEN: "{{TOKEN}}" },
  },
  { url: "https://demo.example.com/{{REGION}}?token={{TOKEN}}", headers: { Authorization: "Bearer {{TOKEN}}" } },
]) {
  test(`previews ${"command" in content ? "local commands" : "remote URLs"} with secret values redacted before interpolation`, () => {
    const [entry] = KiloMarketplaceRegistry.parse(
      "mcp",
      Bun.YAML.stringify({
        items: [
          {
            id: "demo",
            parameters: [
              { key: "TOKEN", name: "API token", secret: true },
              { key: "REGION", name: "Region", secret: false },
              { key: "OPTIONAL", name: "Optional token", secret: true, optional: true },
            ],
            content: JSON.stringify(content),
          },
        ],
      }),
    )
    const result = Installer.preview({ entry, params: { TOKEN: 'private"\\value', REGION: "us-east", OPTIONAL: "" } })
    expect(result.parameters).toEqual(["API token (TOKEN)", "Region (REGION)", "Optional token (OPTIONAL)"])
    expect(result.secrets).toEqual(["API token"])
    expect(result.server).not.toContain("private")
    expect(result.server).toContain("[redacted]")
    expect(result.server).toContain("us-east")
    const server = JSON.parse(result.server)
    if ("command" in content)
      expect(server.command).toEqual(["npx", "-y", "demo", "--token", "[redacted]", "--region", "us-east"])
    if ("url" in content) expect(server.url).toBe("https://demo.example.com/us-east?token=[redacted]")
    expect(() => Installer.preview({ entry, params: { REGION: "us-east" } })).toThrow("Missing required parameters")
    expect(() =>
      Installer.preview({ entry, option: "unknown", params: { TOKEN: "private", REGION: "us-east" } }),
    ).toThrow("no install option unknown")
  })
}
