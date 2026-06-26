import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { dashboardIcon, icons } from "../../webview-ui/src/components/stack/technology-icons"

const root = path.resolve(import.meta.dir, "../..")
const assetDir = path.join(root, "assets", "icons", "dashboard")

describe("Stack technology icons", () => {
  it("maps every catalog technology id to a shipped asset", () => {
    expect(Object.keys(icons)).toHaveLength(100)
    const shipped = new Set(fs.readdirSync(assetDir))
    for (const file of Object.values(icons)) {
      expect(shipped.has(file), `missing asset ${file}`).toBe(true)
    }
  })

  it("resolves brand-family and exact mappings", () => {
    expect(dashboardIcon("apache-airflow")).toBe("apache-airflow.svg")
    expect(dashboardIcon("dbt")).toBe("dbt.png")
    expect(dashboardIcon("snowflake")).toBe("snowflake.png")
    expect(dashboardIcon("postgresql")).toBe("postgresql.svg")
    expect(dashboardIcon("spark-streaming")).toBe("apache.svg")
    expect(dashboardIcon("gcp-secret-manager")).toBe("google-cloud.svg")
    expect(dashboardIcon("snowflake-data-sharing")).toBe("snowflake.png")
  })

  it("falls back to the generic code icon for unknown ids", () => {
    expect(dashboardIcon("does-not-exist")).toBe("code.svg")
    expect(fs.existsSync(path.join(assetDir, "code.svg"))).toBe(true)
  })
})
