/// <reference path="../env.d.ts" />
import { tool } from "@kilocode/plugin"
const TEAM = {
  desktop: ["adamdotdevin", "iamdavidhill", "Brendonovich", "nexxeln"],
  zen: ["fwang", "MrMushrooooom"],
  tui: ["thdxr", "kommander", "rekram1-node"],
  core: ["thdxr", "rekram1-node", "jlongster"],
  docs: ["R44VC0RP"],
  windows: ["Hona"],
} as const

const ASSIGNEES = [...new Set(Object.values(TEAM).flat())]

function pick<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!
}

function getIssueNumber(): number {
  const issue = parseInt(process.env.ISSUE_NUMBER ?? "", 10)
  if (!issue) throw new Error("ISSUE_NUMBER env var not set")
  return issue
}

async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : options.headers),
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export default tool({
  description: `Use this tool to assign and/or label a GitHub issue.

Choose labels and assignee using the current triage policy and ownership rules.
Pick the most fitting labels for the issue and assign one owner.

If unsure, choose the team/section with the most overlap with the issue and assign a member from that team at random.`,
  args: {
    assignee: tool.schema
      .enum(["thdxr", "adamdotdevin", "rekram1-node", "fwang", "jayair", "kommander"])
      .describe("The username of the assignee")
      .default("rekram1-node"),
    labels: tool.schema
      .array(tool.schema.enum(["nix", "opentui", "perf", "desktop", "zen", "docs", "windows"]))
      .describe("The labels(s) to add to the issue")
      .default([]),
  },
  async execute(args) {
    const issue = getIssueNumber()
    // const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
    const owner = "anomalyco"
    const repo = "opencode"

    const results: string[] = []

    if (args.assignee === "adamdotdevin" && !args.labels.includes("desktop")) {
      throw new Error("Only desktop issues should be assigned to adamdotdevin")
    }

    if (args.assignee === "fwang" && !args.labels.includes("zen")) {
      throw new Error("Only zen issues should be assigned to fwang")
    }

    if (args.assignee === "kommander" && !args.labels.includes("opentui")) {
      throw new Error("Only opentui issues should be assigned to kommander")
    }

    // await octokit.rest.issues.addAssignees({
    //   owner,
    //   repo,
    //   issue_number: issue,
    //   assignees: [args.assignee],
    // })
    await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignees: [args.assignee] }),
    })
    results.push(`Assigned @${args.assignee} to issue #${issue}`)

    const labels: string[] = args.labels.map((label) => (label === "desktop" ? "web" : label))

    if (labels.length > 0) {
      // await octokit.rest.issues.addLabels({
      //   owner,
      //   repo,
      //   issue_number: issue,
      //   labels,
      // })
      await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels }),
      })
      results.push(`Added labels: ${args.labels.join(", ")}`)
    }

    return results.join("\n")
  },
})
