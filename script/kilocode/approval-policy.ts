export type Review = {
  user: string
  state: string
  commit: string
}

export type Result = {
  ok: boolean
  reason: string
}

export function approvers(reviews: Review[], head: string) {
  const states = new Map<string, string>()
  for (const review of reviews) {
    if (review.commit !== head) continue
    const user = review.user.toLowerCase()
    if (!user) continue
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED" || review.state === "DISMISSED") {
      states.set(user, review.state)
    }
  }
  return new Set([...states].filter(([, state]) => state === "APPROVED").map(([user]) => user))
}

export function evaluate(reviews: Review[], engineers: Set<string>, author: string, head: string): Result {
  const approved = approvers(reviews, head)
  approved.delete(author.toLowerCase())

  const engineer = [...approved].find((user) => engineers.has(user))
  if (engineer) return { ok: true, reason: `Approved by engineering team member @${engineer}` }
  return { ok: false, reason: "Waiting for approval from Kilo-Org/engineering" }
}
