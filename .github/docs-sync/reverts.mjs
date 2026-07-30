// kilocode_change - new file

/**
 * Pure helpers for intercepting revert PRs during docs-sync collect.
 * No I/O, no imports — offline-testable title/body/annotation logic only.
 */

/** Detect revert PR titles. Returns "conventional" | "github-native" | null. */
export function revertTitleKind(title) {
  const t = String(title ?? "")
  if (/^revert(\(.+\))?!?:/i.test(t)) return "conventional"
  if (/^revert\s+["']/i.test(t)) return "github-native"
  return null
}

/**
 * Parse revert targets from a PR body. `defaultRepo` ("Kilo-Org/kilocode") resolves bare `#N`.
 * Returns [{ repo, number, url }] with url = `https://github.com/${repo}/pull/${number}`.
 * Handles the conventional trailer form: a line starting with `Reverts` (case-insensitive),
 * e.g. `Reverts #12249 and #12481.`, `Reverts Kilo-Org/cloud#42.`, comma-separated lists,
 * several such lines in one body, and bulleted/quoted single-line trailers
 * (`- Reverts #12249`, `> Reverts #12249`).
 * NOT handled (documented limitation): `This reverts commit <sha>.` (no PR number),
 * mid-sentence forms (`This reverts #5.`), narrative mentions (`Revert the fix in #99999`
 * is prose, not a trailer — must NOT produce a target), `Revertsomething #5` (prose glued
 * to the word — `\b` word boundary makes it inert), and multi-line lists
 * (`Reverts:\n- #1\n- #2`).
 */
export function parseRevertTargets(body, defaultRepo) {
  const text = String(body ?? "")
  const repoDefault = String(defaultRepo ?? "")
  const seen = new Set()
  const out = []
  const lineRe = /^[ \t>*-]*reverts\b[ \t:]*([^\n]*)/gim
  let lineMatch
  while ((lineMatch = lineRe.exec(text)) !== null) {
    const capture = lineMatch[1] ?? ""
    const refRe = /(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#(\d+)/g
    let refMatch
    while ((refMatch = refRe.exec(capture)) !== null) {
      const repo = refMatch[1] || repoDefault
      const number = Number(refMatch[2])
      if (!repo || !Number.isInteger(number)) continue
      const url = `https://github.com/${repo}/pull/${number}`
      if (seen.has(url)) continue
      seen.add(url)
      out.push({ repo, number, url })
    }
  }
  return out
}

/**
 * revertSignals: [{ url, merged_at, targets: [{ repo, number, url }] }]
 * Returns Map<targetUrl, { url, merged_at }> — the annotation for each reverted PR.
 * Map keys are lowercased target urls; values keep signal.url as authored.
 * Revert-of-revert: a signal whose own url is itself a target of another signal is
 * dropped entirely (a re-land: net effect zero — one set lookup, no chain walking).
 */
export function computeRevertAnnotations(revertSignals) {
  const signals = Array.isArray(revertSignals) ? revertSignals : []
  const revertedUrls = new Set()
  for (const signal of signals) {
    for (const t of signal?.targets ?? []) {
      if (t?.url) revertedUrls.add(t.url.toLowerCase())
    }
  }
  const annotations = new Map()
  for (const signal of signals) {
    if (!signal?.url || revertedUrls.has(signal.url.toLowerCase())) continue
    for (const t of signal.targets ?? []) {
      if (!t?.url) continue
      annotations.set(t.url.toLowerCase(), { url: signal.url, merged_at: signal.merged_at })
    }
  }
  return annotations
}

/**
 * Applies computeRevertAnnotations to digest entries in place: an entry whose url
 * was reverted gains `reverted_by: { url, merged_at }` (the reverter).
 * Lookup is case-insensitive; applied pairs still report entry.url (canonical).
 * Returns applied [targetUrl, reverterUrl] pairs (digest entries only) for reporting.
 */
export function applyRevertAnnotations(digest, revertSignals) {
  const annotations = computeRevertAnnotations(revertSignals)
  const applied = []
  for (const entry of digest ?? []) {
    if (!entry?.url) continue
    const ann = annotations.get(entry.url.toLowerCase())
    if (!ann) continue
    entry.reverted_by = { url: ann.url, merged_at: ann.merged_at }
    applied.push([entry.url, ann.url])
  }
  return applied
}

/**
 * Reports intercepted reverts whose targets received no digest annotation, for the
 * step summary. `signals` is the same shape as computeRevertAnnotations takes;
 * `appliedPairs` is applyRevertAnnotations' return ([targetUrl, reverterUrl]).
 * Returns { missed: [{ url, targets: [targetUrl, ...] }], unparsed: [url, ...] }:
 * - missed: one entry per signal with at least one unannotated target, listing exactly
 *   the targets that missed (a partially-covered revert still surfaces its uncovered
 *   targets).
 * - unparsed: urls of signals with zero targets (they already warn at intercept time).
 * Excluded by design: signals whose own url is a target of another signal
 * (revert-of-revert cancellation — annotating nothing is correct), and target urls
 * that are themselves intercepted reverts (re-land chain links — the target was never
 * digest-eligible). All url comparisons are case-insensitive.
 */
export function unannotatedRevertSignals(signals, appliedPairs) {
  const list = Array.isArray(signals) ? signals : []
  const annotated = new Set((appliedPairs ?? []).map(([target]) => String(target ?? "").toLowerCase()))
  const signalUrls = new Set(list.map((s) => String(s?.url ?? "").toLowerCase()))
  const cancelledUrls = new Set()
  for (const s of list) {
    for (const t of s?.targets ?? []) {
      if (t?.url) cancelledUrls.add(t.url.toLowerCase())
    }
  }
  const missed = []
  const unparsed = []
  for (const s of list) {
    const url = s?.url
    if (!url || cancelledUrls.has(url.toLowerCase())) continue
    const targets = s.targets ?? []
    if (targets.length === 0) {
      unparsed.push(url)
      continue
    }
    const missing = targets
      .map((t) => t?.url)
      .filter((u) => u && !annotated.has(u.toLowerCase()) && !signalUrls.has(u.toLowerCase()))
    if (missing.length > 0) missed.push({ url, targets: missing })
  }
  return { missed, unparsed }
}
