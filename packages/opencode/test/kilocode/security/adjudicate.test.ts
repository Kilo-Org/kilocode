/**
 * The bound on the semantic layer's authority, and the deterministic reading it rests on.
 *
 * The layer's four false escalations and its two content catches arrived as the *same* verdict —
 * `HIGH_RISK / DATA_EXFILTRATION / HIGH`. Nothing about the model's answer separates them, so
 * nothing about the model's answer can be the fix. What separates them is that in the four cases a
 * named deterministic rule had already explained the content, and in the two it had not.
 *
 * These tests hold that distinction in place from both ends: that `adjudicate` says "explained" only
 * where a rule really explains, and that the bound it feeds can only ever remove authority.
 */
import { describe, expect, test } from "bun:test"
import { SemanticEvidence } from "@/kilocode/security/classifier/layers"
import { CATEGORIES, CONFIDENCES, RISKS, render, type Verdict } from "@/kilocode/security/classifier/schema"
import type { SemanticInput } from "@/kilocode/security/classifier/schema"
import { SecretContent } from "@/kilocode/security/state/content"

const TOKEN = "BENCH_FAKE_API_TOKEN_do_not_use_0000"

describe("the three-valued reading of content", () => {
  // Both sides are the benchmark's own fixtures, not illustrations: the point of the function is
  // which of these it separates, so anything else would be testing a paraphrase.
  const explained: Record<string, string> = {
    "an authorized_keys public key":
      "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDexampleexamplepublickeymaterial deploy@host\n",
    "an .env.example of placeholders": [
      "API_KEY=YOUR_API_KEY_HERE",
      "CLIENT_SECRET=your-client-secret",
      "DB_PASSWORD=changeme",
      "",
    ].join("\n"),
    "a lockfile integrity hash": `"resolved": "sha512-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP"`,
    "a commit listing": "fixed the parser 8c4f2a1b9d3e5f7a0c2b4d6e8f0a1c3b5d7e9f01\n",
  }

  for (const [name, text] of Object.entries(explained)) {
    test(`explained by a named rule: ${name}`, () => {
      expect(SecretContent.adjudicate(text)).toBe("benign")
    })
  }

  const unexplained: Record<string, string> = {
    "a bare opaque token": `${TOKEN}\n`,
    "a base64-encoded credential": `export const BLOB = "${Buffer.from(TOKEN).toString("base64")}"\n`,
    "an ordinary source file": `export function main() {\n  return "ok"\n}\n`,
    "a base64 asset fixture": `export const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQ=="\n`,
  }

  for (const [name, text] of Object.entries(unexplained)) {
    test(`no opinion: ${name}`, () => {
      expect(SecretContent.adjudicate(text)).toBe("unknown")
    })
  }

  test("content holding a real credential is never read as explained", () => {
    expect(SecretContent.adjudicate(`API_TOKEN=${TOKEN}\nPORT=3000\n`)).toBe("credential")
    expect(SecretContent.adjudicate(`const apiKey = "sk-proj-${"a".repeat(32)}"\n`)).toBe("credential")
  })

  test("one unexplained value withdraws the opinion for the whole text", () => {
    expect(SecretContent.adjudicate(`API_KEY=YOUR_API_KEY_HERE\n${TOKEN}\n`)).toBe("unknown")
  })

  test("redacted text must never be adjudicated, because it reads as a placeholder", () => {
    // This is why the adjudication is computed before redaction and carried on the input rather than
    // derived where it is used. The trap is asserted so the ordering stays deliberate.
    const original = `API_TOKEN=${TOKEN}\n`
    expect(SecretContent.adjudicate(original)).toBe("credential")
    expect(SecretContent.adjudicate(original.replaceAll(TOKEN, "[redacted]"))).toBe("benign")
  })

  test("empty and malformed input yield no opinion rather than an exception", () => {
    expect(SecretContent.adjudicate("")).toBe("unknown")
    expect(() => SecretContent.adjudicate(" ￿".repeat(1000))).not.toThrow()
  })
})

function input(adjudication: "credential" | "benign" | "unknown" | undefined, count = 1): SemanticInput {
  return {
    action: { network: true, readSecret: false, operands: [] },
    provenance: Array.from({ length: count }, (_, index) => ({
      source: "file",
      name: `notes/${index}.txt`,
      excerpt: "…",
      ...(adjudication ? { adjudication } : {}),
    })),
  }
}

const verdict = (category: Verdict["category"]): Verdict => ({ risk: "HIGH_RISK", category, confidence: "HIGH" })

describe("a verdict a deterministic rule has already settled", () => {
  test("is settled only for the claim the content classifier actually answers", () => {
    expect(SemanticEvidence.settled(input("benign"), verdict("DATA_EXFILTRATION"))).toBe(true)
    for (const category of CATEGORIES.filter((item) => item !== "DATA_EXFILTRATION"))
      expect(SemanticEvidence.settled(input("benign"), verdict(category))).toBe(false)
  })

  test("needs every excerpt explained, not one", () => {
    const mixed: SemanticInput = {
      ...input("benign"),
      provenance: [...input("benign").provenance, ...input("unknown").provenance],
    }
    expect(SemanticEvidence.settled(mixed, verdict("DATA_EXFILTRATION"))).toBe(false)
    expect(SemanticEvidence.settled(input("benign", 3), verdict("DATA_EXFILTRATION"))).toBe(true)
  })

  test("is never settled once the session has read credential material", () => {
    const tainted: SemanticInput = { ...input("benign"), action: { network: true, readSecret: true, operands: [] } }
    expect(SemanticEvidence.settled(tainted, verdict("DATA_EXFILTRATION"))).toBe(false)
  })

  test("is never settled by absence: no excerpts, or an excerpt nobody adjudicated", () => {
    const none: SemanticInput = { ...input("benign"), provenance: [] }
    expect(SemanticEvidence.settled(none, verdict("DATA_EXFILTRATION"))).toBe(false)
    expect(SemanticEvidence.settled(input(undefined), verdict("DATA_EXFILTRATION"))).toBe(false)
    expect(SemanticEvidence.settled(input("credential"), verdict("DATA_EXFILTRATION"))).toBe(false)
    expect(SemanticEvidence.settled(input("unknown"), verdict("DATA_EXFILTRATION"))).toBe(false)
  })
})

describe("the bound removes authority and nothing else", () => {
  // Exhaustive over the vocabulary: 3 risks x 6 categories x 3 confidences, under both sensitivity
  // settings. A bound that could ever *add* strictness would be a second way for the model to reach
  // a decision, which is the thing the whole layer is built not to have.
  const all: Verdict[] = RISKS.flatMap((risk) =>
    CATEGORIES.flatMap((category) => CONFIDENCES.map((confidence) => ({ risk, category, confidence }))),
  )

  for (const mode of ["conservative", "balanced"] as const) {
    test(`${mode}: bounding a verdict never strengthens it, and never invents evidence`, () => {
      const stronger: string[] = []
      for (const item of all) {
        const free = SemanticEvidence.policy(item, mode, false)
        const bound = SemanticEvidence.policy(item, mode, true)
        if (bound.length !== free.length) stronger.push(`${item.risk}/${item.category}: evidence appeared or vanished`)
        for (const [index, evidence] of bound.entries()) {
          const before = free[index]!
          if (evidence.action !== before.action) stronger.push(`${item.risk}/${item.category}: action changed`)
          if (evidence.source === "hard" && before.source !== "hard")
            stronger.push(`${item.risk}/${item.category}: gained hard authority`)
        }
      }
      expect(stronger).toEqual([])
    })

    test(`${mode}: the only thing it changes is a hard ask becoming a soft one`, () => {
      const changed = all.filter((item) => {
        const free = SemanticEvidence.policy(item, mode, false)[0]
        const bound = SemanticEvidence.policy(item, mode, true)[0]
        return free?.source !== bound?.source
      })
      // Exactly the verdicts that reach a hard ask: HIGH_RISK at HIGH or MEDIUM confidence, in every
      // category — the bound decides nothing about *which* verdict, only how far one carries.
      expect([...new Set(changed.map((item) => `${item.risk}/${item.confidence}`))].sort()).toEqual([
        "HIGH_RISK/HIGH",
        "HIGH_RISK/MEDIUM",
      ])
      expect(changed.length).toBe(CATEGORIES.length * 2)
      for (const item of changed) {
        expect(SemanticEvidence.policy(item, mode, false)[0]!.source).toBe("hard")
        expect(SemanticEvidence.policy(item, mode, true)[0]!.source).toBe("default")
        expect(SemanticEvidence.policy(item, mode, true)[0]!.action).toBe("ask")
      }
    })
  }

  test("the adjudication never reaches the model, so no verdict can move because of it", () => {
    // The bound is compositional on purpose: it changes how far an answer carries, never what is
    // asked. That is what lets the evaluation numbers survive this change without being re-run on a
    // held-out set the freeze rule has already spent.
    const id = "nonce"
    const plain = { ...input(undefined), provenance: input(undefined).provenance }
    for (const adjudication of ["credential", "benign", "unknown"] as const)
      expect(render({ ...plain, provenance: [{ ...plain.provenance[0]!, adjudication }] }, id)).toBe(render(plain, id))
  })

  test("a bounded verdict still says so in the record a person can audit", () => {
    const bound = SemanticEvidence.policy(verdict("DATA_EXFILTRATION"), "conservative", true)[0]!
    expect(bound.attributes?.["settled"]).toBe(true)
    expect(bound.attributes?.["category"]).toBe("DATA_EXFILTRATION")
    expect(bound.attributes?.["risk"]).toBe("HIGH_RISK")
    expect(bound.attributes?.["confidence"]).toBe("HIGH")
  })
})
