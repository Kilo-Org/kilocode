import type { Tracker } from "./tracker"
import type { TrackerIssue } from "./types"
import { SymphonyTrackerError } from "../errors"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.tracker.linear" })

const DEFAULT_PAGE_SIZE = 50
const NETWORK_TIMEOUT_MS = 30000

interface LinearIssueNode {
  id: string
  identifier: string
  title: string
  description: string | null
  priority: number | null
  state: { name: string }
  branchName: string | null
  url: string
  labels: { nodes: Array<{ name: string }> }
  relations: {
    nodes: Array<{
      type: string
      relatedIssue: {
        id: string
        identifier: string
        state: { name: string }
      }
    }>
  }
  createdAt: string
  updatedAt: string
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  state { name }
  branchName
  url
  labels { nodes { name } }
  relations(filter: { type: { eq: "blocks" } }) {
    nodes {
      type
      relatedIssue {
        id
        identifier
        state { name }
      }
    }
  }
  createdAt
  updatedAt
`

function normalizeIssue(node: LinearIssueNode): TrackerIssue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    description: node.description,
    priority: node.priority,
    state: node.state.name,
    branchName: node.branchName,
    url: node.url,
    labels: node.labels.nodes.map((l) => l.name.toLowerCase()),
    blockedBy: node.relations.nodes.map((r) => ({
      id: r.relatedIssue.id,
      identifier: r.relatedIssue.identifier,
      state: r.relatedIssue.state.name,
    })),
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  }
}

export class LinearTracker implements Tracker {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  private async query(document: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new SymphonyTrackerError({
          message: `Linear API returned ${response.status}: ${response.statusText}`,
          statusCode: response.status,
        })
      }

      const json = (await response.json()) as { data?: unknown; errors?: unknown[] }
      if (json.errors && json.errors.length > 0) {
        throw new SymphonyTrackerError({
          message: `Linear GraphQL errors: ${JSON.stringify(json.errors)}`,
          graphqlErrors: json.errors,
        })
      }

      return json.data
    } catch (e) {
      if (e instanceof SymphonyTrackerError) throw e
      if (e instanceof Error && e.name === "AbortError") {
        throw new SymphonyTrackerError({ message: "Linear API request timed out" })
      }
      throw new SymphonyTrackerError({
        message: `Linear API request failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  async fetchCandidates(activeStates: string[], projectSlug: string): Promise<TrackerIssue[]> {
    const issues: TrackerIssue[] = []
    let cursor: string | undefined

    while (true) {
      const data = (await this.query(
        `query($projectSlug: String!, $states: [String!]!, $first: Int!, $after: String) {
          issues(
            filter: {
              project: { slugId: { eq: $projectSlug } }
              state: { name: { in: $states } }
            }
            first: $first
            after: $after
            orderBy: createdAt
          ) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        {
          projectSlug,
          states: activeStates,
          first: DEFAULT_PAGE_SIZE,
          after: cursor,
        },
      )) as { issues: { nodes: LinearIssueNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

      for (const node of data.issues.nodes) {
        issues.push(normalizeIssue(node))
      }

      if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) break
      cursor = data.issues.pageInfo.endCursor
    }

    log.info(`Fetched ${issues.length} candidate issues from Linear`)
    return issues
  }

  async fetchIssueStates(issueIds: string[]): Promise<Map<string, string>> {
    if (issueIds.length === 0) return new Map()

    const data = (await this.query(
      `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Issue {
            id
            state { name }
          }
        }
      }`,
      { ids: issueIds },
    )) as { nodes: Array<{ id: string; state: { name: string } } | null> }

    const states = new Map<string, string>()
    for (const node of data.nodes) {
      if (node) states.set(node.id, node.state.name)
    }
    return states
  }

  async fetchTerminalIssues(terminalStates: string[], projectSlug: string): Promise<TrackerIssue[]> {
    const issues: TrackerIssue[] = []
    let cursor: string | undefined

    while (true) {
      const data = (await this.query(
        `query($projectSlug: String!, $states: [String!]!, $first: Int!, $after: String) {
          issues(
            filter: {
              project: { slugId: { eq: $projectSlug } }
              state: { name: { in: $states } }
            }
            first: $first
            after: $after
          ) {
            nodes { ${ISSUE_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        {
          projectSlug,
          states: terminalStates,
          first: DEFAULT_PAGE_SIZE,
          after: cursor,
        },
      )) as { issues: { nodes: LinearIssueNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }

      for (const node of data.issues.nodes) {
        issues.push(normalizeIssue(node))
      }

      if (!data.issues.pageInfo.hasNextPage || !data.issues.pageInfo.endCursor) break
      cursor = data.issues.pageInfo.endCursor
    }

    return issues
  }
}
