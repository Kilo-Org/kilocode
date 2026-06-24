import { describe, expect, test } from "bun:test"
import { dashboardIcon, icons } from "./technology-icons"

describe("technology icon mapping", () => {
  test("uses exact product assets when the collection provides them", () => {
    expect(dashboardIcon("apache-airflow")).toBe("apache-airflow")
    expect(dashboardIcon("azure-data-factory")).toBe("azure-data-factory")
    expect(dashboardIcon("power-bi")).toBe("powerbi")
  })

  test("uses Dashboard Icons brand assets for product families", () => {
    expect(dashboardIcon("spark-streaming")).toBe("apache")
    expect(dashboardIcon("snowflake-data-sharing")).toBe("snowflake")
    expect(dashboardIcon("gcp-secret-manager")).toBe("google-cloud")
  })

  test("maps the full catalog to vendored Dashboard Icons assets", async () => {
    expect(Object.keys(icons)).toHaveLength(100)
    for (const icon of new Set(Object.values(icons))) {
      const png = Bun.file(new URL(`../../../assets/dashboard-icons/${icon}.png`, import.meta.url))
      const svg = Bun.file(new URL(`../../../assets/dashboard-icons/${icon}.svg`, import.meta.url))
      expect((await png.exists()) || (await svg.exists())).toBe(true)
    }
  })

  test("uses a vendored Dashboard Icons fallback for future catalog entries", () => {
    expect(dashboardIcon("future-technology")).toBe("code")
  })
})
