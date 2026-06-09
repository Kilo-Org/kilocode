import { describe, expect, it } from "bun:test"
import {
  mergeCloudSummaries,
  pickCloudSummary,
  replaceCloudSummary,
  toCloudSummary,
  type CloudSummaryVersion,
} from "../../src/shared/cloud-session-summary"

const value = (id: string, title: string, updatedAt: string) => ({
  id,
  title,
  createdAt: "2026-06-03T00:00:00.000Z",
  updatedAt,
})

const version = (
  id: string,
  title: string,
  updatedAt: string,
  source: CloudSummaryVersion["source"],
): CloudSummaryVersion => ({ value: value(id, title, updatedAt), source })

describe("Cloud Agent session summaries", () => {
  it("projects SDK and webview sessions into the Cloud list contract", () => {
    expect(
      toCloudSummary({
        id: "ses_sdk",
        title: "SDK title",
        time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
      }),
    ).toEqual({
      id: "ses_sdk",
      title: "SDK title",
      createdAt: "2023-11-14T22:13:20.000Z",
      updatedAt: "2023-11-14T22:15:00.000Z",
    })
    expect(
      toCloudSummary({
        id: "ses_webview",
        title: "Webview title",
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:01:00.000Z",
      }),
    ).toEqual(value("ses_webview", "Webview title", "2026-06-03T00:01:00.000Z"))
  })

  it("keeps the newest summary and gives live events equal-version precedence", () => {
    const current = version("ses_cloud", "Current", "2026-06-03T00:02:00.000Z", "event")

    expect(pickCloudSummary(current, version("ses_cloud", "Older", "2026-06-03T00:01:00.000Z", "event"))).toBe(current)
    expect(
      pickCloudSummary(
        version("ses_cloud", "Listed", "2026-06-03T00:02:00.000Z", "list"),
        version("ses_cloud", "Hydrated", "2026-06-03T00:02:00.000Z", "detail"),
      ).value.title,
    ).toBe("Hydrated")
    expect(pickCloudSummary(version("ses_cloud", "Hydrated", "2026-06-03T00:02:00.000Z", "detail"), current)).toBe(
      current,
    )
    expect(pickCloudSummary(current, version("ses_cloud", "List regression", "2026-06-03T00:02:00.000Z", "list"))).toBe(
      current,
    )
  })

  it("replaces only matching rows without changing list order", () => {
    const rows = [value("ses_a", "A", "2026-06-03T00:00:00.000Z"), value("ses_b", "B", "2026-06-03T00:00:00.000Z")]
    const next = value("ses_b", "Renamed", "2026-06-03T00:01:00.000Z")

    expect(replaceCloudSummary(rows, next)).toEqual([rows[0], next])
    expect(replaceCloudSummary(rows, value("ses_unknown", "Unknown", next.updatedAt))).toBe(rows)
    expect(replaceCloudSummary(rows, rows[1])).toBe(rows)
  })

  it("keeps incoming membership and ordering while preserving newer observed data", () => {
    const incoming = [
      value("ses_b", "Listed B", "2026-06-03T00:01:00.000Z"),
      value("ses_a", "Listed A", "2026-06-03T00:01:00.000Z"),
    ]
    const observed = new Map<string, CloudSummaryVersion>([
      ["ses_a", version("ses_a", "Live A", "2026-06-03T00:02:00.000Z", "event")],
      ["ses_b", version("ses_b", "Live B", "2026-06-03T00:01:00.000Z", "event")],
      ["ses_unknown", version("ses_unknown", "Unknown", "2026-06-03T00:03:00.000Z", "event")],
    ])

    expect(mergeCloudSummaries(incoming, observed).map((item) => item.value)).toEqual([
      value("ses_b", "Live B", "2026-06-03T00:01:00.000Z"),
      value("ses_a", "Live A", "2026-06-03T00:02:00.000Z"),
    ])
  })
})
