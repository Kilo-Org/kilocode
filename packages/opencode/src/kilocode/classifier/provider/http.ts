import type { ClassifierProvider } from "../types"

// kilocode_change start — vendor-agnostic HTTP classifier backend (issue #9138)

const TIMEOUT_MS = 10_000

/**
 * `http` backend: POST the classifier contract to a user-configured HTTP
 * service and map its structured response. Vendor-agnostic — any service that
 * implements the documented contract works (a self-hosted model, a locally
 * served endpoint, or a hosted guardrails API); the URL and auth come entirely
 * from config.
 *
 * Request — `POST {endpoint}` with `content-type: application/json` and, when an
 * API key is configured, `Authorization: Bearer {apiKey}`:
 *
 *   { transcript: TranscriptEntry[], action: ClassifierAction, policy: ClassifierPolicy }
 *
 * Response — JSON:
 *
 *   { should_block: boolean, reason?: string, unavailable?: boolean, model?: string }
 *
 * Fails closed (`unavailable`) on any error, timeout, non-2xx, or malformed
 * body — the caller then escalates to a human (`ask`).
 */
export function httpProvider(opts: { endpoint: string; apiKey?: string; label?: string }): ClassifierProvider {
  const url = opts.endpoint.trim()
  const label = opts.label ?? "http"
  return {
    async classify(input, signal) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      if (signal.aborted) controller.abort()
      else signal.addEventListener("abort", abort, { once: true })
      const timer = setTimeout(abort, TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          body: JSON.stringify({
            transcript: input.transcript,
            action: input.action,
            policy: input.policy,
          }),
        })
        if (!res.ok) {
          return {
            shouldBlock: true,
            unavailable: true,
            reason: `classifier service returned ${res.status}`,
            model: label,
          }
        }
        const d = (await res.json()) as {
          should_block?: unknown
          reason?: unknown
          unavailable?: unknown
          model?: unknown
        }
        if (typeof d.should_block !== "boolean") {
          return {
            shouldBlock: true,
            unavailable: true,
            reason: "classifier service returned a malformed response",
            model: label,
          }
        }
        return {
          shouldBlock: d.should_block,
          reason: typeof d.reason === "string" ? d.reason : undefined,
          unavailable: d.unavailable === true,
          model: typeof d.model === "string" ? d.model : label,
        }
      } catch (e) {
        return {
          shouldBlock: true,
          unavailable: true,
          reason: e instanceof Error ? e.message : "classifier service unavailable",
          model: label,
        }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
      }
    },
  }
}

// kilocode_change end
