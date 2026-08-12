import { describe, expect, mock, test } from "bun:test"
import { decode } from "../src/kilocode/provider-usage/minimax/native"
import { direct, normalize, query, type Candidate } from "../src/kilocode/provider-usage/minimax/usage"
import type { ProviderUsage } from "@opencode-ai/schema/kilocode/provider-usage"

const native = (row: Record<string, unknown>) =>
  decode({
    base_resp: { status_code: 0, status_msg: "stripped" },
    model_remains: [{ model_name: "general", ...row }],
    unknown: "stripped",
  })

const options = {
  id: "usage",
  providerID: "minimax-coding-plan",
  sourceLabel: "Direct",
  managementUrl: "https://platform.minimax.io/subscribe/token-plan",
  fetchedAt: "2026-06-19T00:00:00.000Z",
}

const candidate = (providerID: Candidate["providerID"], key: string): Candidate => ({
  providerID,
  label: providerID === "minimax-cn-coding-plan" ? "MiniMax China" : "MiniMax Global",
  key,
})

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("MiniMax usage normalization", () => {
  test("normalizes direct native percentage payloads", () => {
    const payload = native({
      current_interval_total_count: 1500,
      current_interval_usage_count: 1,
      current_interval_remaining_percent: 80,
      current_interval_status: 1,
      start_time: 1_781_827_200_000,
      end_time: 1_781_845_200_000,
    })

    const direct = normalize(payload, options)
    expect(direct.windows[0]).toMatchObject({
      orientation: "remaining_percent",
      remaining: 80,
      used: 20,
      limit: 100,
      period: { unit: "hour", value: 5 },
      resetAt: "2026-06-19T05:00:00.000Z",
    })
    expect(direct.windows[0]?.remaining).not.toBe(1)
  })

  test("omits video quotas while preserving image quota state", () => {
    const value = decode({
      base_resp: { status_code: 0 },
      model_remains: [
        {
          model_name: "video",
          current_interval_remaining_percent: 100,
          current_interval_status: 1,
        },
        {
          model_name: "image",
          current_interval_remaining_percent: 70,
          current_interval_status: 1,
          current_weekly_status: 3,
        },
        {
          model_name: "general",
          current_interval_total_count: 0,
          current_interval_usage_count: 0,
          current_interval_status: 1,
        },
      ],
    })
    const direct = normalize(value, options)

    expect(direct.windows.some((window) => window.resource === "video")).toBe(false)
    expect(direct.windows.find((window) => window.id === "image-interval")).toMatchObject({
      resource: "image",
      remaining: 70,
      state: "active",
    })
    expect(direct.windows.find((window) => window.id === "image-weekly")?.state).toBe("not_in_plan")
    expect(direct.windows.find((window) => window.id === "general-interval")?.state).toBe("unknown")
  })

  test("uses positive count-only usage_count as remaining", () => {
    const item = normalize(
      native({
        current_interval_total_count: 1500,
        current_interval_usage_count: 1200,
        current_interval_status: 1,
      }),
      options,
    )

    expect(item.windows[0]).toMatchObject({ orientation: "count", remaining: 1200, used: 300, limit: 1500 })
  })

  test("applies weekly boosts as capacity without clamping to 100", () => {
    const item = normalize(
      native({
        current_weekly_remaining_percent: 100,
        current_weekly_status: 1,
        weekly_boost_permill: 1500,
      }),
      options,
    )

    expect(item.windows[0]).toMatchObject({
      unit: "standard_units",
      orientation: "amount",
      remaining: 150,
      limit: 150,
      period: { unit: "week", value: 1 },
    })
  })

  test("prefers absolute reset timestamps over remaining duration", () => {
    const item = normalize(
      native({
        current_interval_remaining_percent: 50,
        current_interval_status: 1,
        end_time: 1_781_845_200_000,
        remains_time: 60_000,
      }),
      options,
    )

    expect(item.windows[0]?.resetAt).toBe("2026-06-19T05:00:00.000Z")
  })
})

describe("MiniMax usage transport and detection", () => {
  test("uses fixed hosts and ignores configured base URLs", async () => {
    const fn = mock(() => Promise.resolve(response({ base_resp: { status_code: 0 }, model_remains: [] })))

    await query("minimax-coding-plan", "sk-cp-secret", fn as unknown as typeof fetch)

    expect(fn).toHaveBeenCalledTimes(1)
    const call = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe("https://api.minimax.io/v1/token_plan/remains")
    expect(call[1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" })
    expect(new Headers(call[1].headers).get("authorization")).toBe("Bearer sk-cp-secret")
  })

  test("does not query PAYG keys or provider IDs", async () => {
    const fn = mock(() => Promise.resolve(response({})))
    const items = await direct([candidate("minimax-coding-plan", "sk-api-payg")], fn as unknown as typeof fetch)

    expect(items).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  test("keeps same-key providers as independent regional plans", async () => {
    const fn = mock((url: string | URL | Request) =>
      Promise.resolve(
        String(url).includes("api.minimax.io")
          ? response({}, 401)
          : response({
              base_resp: { status_code: 0 },
              model_remains: [{ model_name: "general", current_interval_remaining_percent: 90 }],
            }),
      ),
    )
    const items = await direct(
      [candidate("minimax-coding-plan", "sk-cp-shared"), candidate("minimax-cn-coding-plan", "sk-cp-shared")],
      fn as unknown as typeof fetch,
    )

    expect(fn).toHaveBeenCalledTimes(2)
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.id === "minimax-direct-global")).toMatchObject({
      providerID: "minimax-coding-plan",
      sourceLabel: "MiniMax Global",
      fetchState: "unavailable",
    })
    expect(items.find((item) => item.id === "minimax-direct-china")).toMatchObject({
      providerID: "minimax-cn-coding-plan",
      sourceLabel: "MiniMax China",
      fetchState: "ready",
    })
    expect(JSON.stringify(items)).not.toContain("sk-cp-shared")
  })

  test("scopes the cache cell identity to the credential fingerprint", async () => {
    const fn = mock(() => Promise.resolve(response({ base_resp: { status_code: 0 }, model_remains: [] })))
    const seen: Array<{ id: string; identity?: string }> = []
    const cached = (id: string, load: () => Promise<ProviderUsage.UsageSnapshot>, identity?: string) => {
      seen.push({ id, identity })
      return load()
    }

    await direct([candidate("minimax-coding-plan", "sk-cp-key-a")], fn as unknown as typeof fetch, cached)
    await direct([candidate("minimax-coding-plan", "sk-cp-key-b")], fn as unknown as typeof fetch, cached)

    expect(seen.map((item) => item.id)).toEqual(["minimax-direct-global", "minimax-direct-global"])
    expect(seen[0].identity).toHaveLength(64)
    expect(seen[0].identity).not.toBe(seen[1].identity)
    expect(JSON.stringify(seen)).not.toContain("sk-cp")
  })

  test("returns per-provider unavailable items when every query fails", async () => {
    const fn = mock(() => Promise.resolve(response({ message: "raw failure" }, 500)))
    const items = await direct(
      [candidate("minimax-coding-plan", "sk-cp-shared"), candidate("minimax-cn-coding-plan", "sk-cp-shared")],
      fn as unknown as typeof fetch,
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.fetchState === "unavailable")).toBe(true)
    expect(JSON.stringify(items)).not.toContain("raw failure")
  })
})
