#!/usr/bin/env bun

import { evaluate, type Review } from "./approval-policy"

const api = process.env.GITHUB_API_URL ?? "https://api.github.com"
const repo = process.env.GITHUB_REPOSITORY
const number = process.env.PR_NUMBER
const statusToken = process.env.STATUS_TOKEN
const teamToken = process.env.TEAM_TOKEN
const target = process.env.GITHUB_RUN_URL

if (!repo || !number || !statusToken || !teamToken) throw new Error("Missing required approval gate environment")
if (!/^\d+$/.test(number)) throw new Error("Invalid PR number")

type Pull = {
  state: string
  draft: boolean
  head: { sha: string }
  user: { login: string }
}

type ApiReview = {
  state: string
  submitted_at: string | null
  commit_id: string
  user: { login: string } | null
}

type Member = { login: string }

async function request<T>(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`)
  return { data: (await response.json()) as T, link: response.headers.get("link") }
}

async function pages<T>(path: string, token: string) {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const separator = path.includes("?") ? "&" : "?"
    const response = await request<T[]>(`${path}${separator}per_page=100&page=${page}`, token)
    items.push(...response.data)
    if (!response.link?.includes('rel="next"')) return items
  }
}

async function status(sha: string, state: "pending" | "success" | "failure" | "error", description: string) {
  await request(`/repos/${repo}/statuses/${sha}`, statusToken, {
    method: "POST",
    body: JSON.stringify({
      context: "Engineering approval",
      state,
      description: description.slice(0, 140),
      target_url: target,
    }),
  })
}

const pull = (await request<Pull>(`/repos/${repo}/pulls/${number}`, statusToken)).data
if (pull.state !== "open") throw new Error(`PR #${number} is not open`)

await status(pull.head.sha, "pending", "Checking current approvals")

try {
  const [raw, members] = await Promise.all([
    pages<ApiReview>(`/repos/${repo}/pulls/${number}/reviews`, statusToken),
    pages<Member>("/orgs/Kilo-Org/teams/engineering/members", teamToken),
  ])
  const reviews: Review[] = raw
    .filter((review) => review.user)
    .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
    .map((review) => ({ user: review.user!.login, state: review.state, commit: review.commit_id }))
  const engineers = new Set(members.map((member) => member.login.toLowerCase()))
  const current = (await request<Pull>(`/repos/${repo}/pulls/${number}`, statusToken)).data
  if (current.head.sha !== pull.head.sha) throw new Error("PR head changed during approval evaluation")

  if (pull.draft) {
    await status(pull.head.sha, "failure", "Approval gate waits until the PR is ready")
    process.exit(1)
  }

  const result = evaluate(reviews, engineers, pull.user.login, pull.head.sha)
  await status(pull.head.sha, result.ok ? "success" : "failure", result.reason)
  if (!result.ok) process.exit(1)
  console.log(result.reason)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  await status(pull.head.sha, "error", "Unable to verify engineering approval")
  throw new Error(message)
}
