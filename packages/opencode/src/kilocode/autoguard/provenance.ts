/**
 * Intent provenance: did the developer ask for this, or did the agent invent it?
 *
 * The same command deserves a different verdict depending on the answer, which
 * makes this one of the cheapest useful signals available. It is also the one
 * most easily overclaimed, so the implementation stays deliberately literal:
 * it matches what the developer actually wrote, and defaults to
 * `agent_invented` when it cannot tell.
 *
 * Defaulting to `agent_invented` is the conservative direction -- Level 0's
 * fast-allow path refuses agent-invented actions, so an under-confident
 * classification costs a review, never an unchecked execution.
 *
 * This is a heuristic, not a proof. `classification-design.md` §13 lists
 * deciding `user_implied` vs `agent_invented` reliably as an open question.
 */

import type { IntentProvenance, NormalizedAction } from "./types"

/** Verbs a developer uses to ask for each effect class. */
const INTENT_VERBS: Record<string, RegExp> = {
  "filesystem.delete": /\b(delete|remove|clean|clear|wipe|purge|rm)\b/i,
  "filesystem.chmod": /\b(chmod|permission|executable|mode)\b/i,
  "filesystem.chown": /\b(chown|owner|ownership)\b/i,
  "git.push": /\b(push|publish|upload the branch)\b/i,
  "git.reset": /\b(reset|discard|roll ?back)\b/i,
  "git.clean": /\b(clean|untracked)\b/i,
  "code.modify": /\b(fix|change|edit|update|refactor|add|implement|rewrite)\b/i,
  "config.modify": /\b(config|configure|setting|bump|adjust)\b/i,
  "dependency.install": /\b(install|add .*(dep|package|library)|dependency)\b/i,
  "network.http_post": /\b(upload|post|send|report|publish)\b/i,
  "script.execute": /\b(run|execute|invoke)\b/i,
}

/** Tokens too generic to count as the developer naming a target. */
const WEAK_TARGETS = new Set([".", "..", "/", "*", "-", "HEAD", "origin"])

function namesTarget(text: string, target: string): boolean {
  if (!target || WEAK_TARGETS.has(target)) return false
  const lower = text.toLowerCase()
  const candidate = target.toLowerCase()
  if (lower.includes(candidate)) return true
  // `dist/assets/app.js` counts as named if the developer said `dist`.
  const head = candidate.split("/")[0]!
  if (head.length >= 3 && lower.includes(head)) return true
  // A URL counts as named if its host was mentioned.
  try {
    const host = new URL(target).hostname.toLowerCase()
    if (host && lower.includes(host)) return true
  } catch {
    /* not a URL */
  }
  return false
}

/**
 * Classify how this action relates to what the developer asked for.
 *
 * `userIntent` must be the developer's own message. Never pass assistant prose
 * or tool output: an agent that can write its own justification into this input
 * can promote any action to `user_explicit`.
 */
export function deriveProvenance(action: NormalizedAction, userIntent: string): IntentProvenance {
  if (!userIntent.trim()) return "agent_invented"

  const everyTargetNamed = action.targets.length > 0 && action.targets.every((t) => namesTarget(userIntent, t))
  const verb = INTENT_VERBS[action.operation]
  const verbMatches = verb ? verb.test(userIntent) : false

  // The developer named both what to do and what to do it to.
  if (everyTargetNamed && verbMatches) return "user_explicit"

  // They asked for this kind of change, but not this specific target.
  if (verbMatches) return "user_implied"

  // A target was named without a matching verb: still their idea, less clearly.
  if (everyTargetNamed) return "user_implied"

  return "agent_invented"
}
