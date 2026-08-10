// Timeouts for gh CLI and GraphQL calls in PR actions
export const GH_READ_TIMEOUT = 15_000 // 15 seconds — gh pr view, checks, reviewers, comments
export const GH_MUTATION_TIMEOUT = 15_000 // 15 seconds — gh api graphql mutations
export const GH_REPO_TIMEOUT = 10_000 // 10 seconds — gh repo view
export const GH_PROBE_TIMEOUT = 5_000 // 5 seconds — gh --version probe
