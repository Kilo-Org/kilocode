import type { TrackerIssue } from "./types"

export interface Tracker {
  fetchCandidates(activeStates: string[], projectSlug: string): Promise<TrackerIssue[]>
  fetchIssueStates(issueIds: string[]): Promise<Map<string, string>>
  fetchTerminalIssues(terminalStates: string[], projectSlug: string): Promise<TrackerIssue[]>
}
