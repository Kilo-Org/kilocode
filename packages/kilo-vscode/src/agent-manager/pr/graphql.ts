/**
 * GitHub GraphQL queries and mutations for PR-related operations.
 *
 * All GraphQL in one place for easy maintenance and validation.
 */

// Query to fetch PR reviewers
export const PR_REVIEWERS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login avatarUrl } } }
      }
      reviews(last: 20, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
        nodes { author { login avatarUrl } state }
      }
    }
  }
}`

// Query to fetch PR review threads and comments
export const PR_COMMENTS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              id
              author { login avatarUrl }
              body
              path
              line
              url
              createdAt
              diffHunk
            }
          }
        }
      }
    }
  }
}`

// Mutation to resolve a review thread
export const RESOLVE_THREAD_MUTATION = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) {
    thread { isResolved }
  }
}`

// Mutation to unresolve a review thread
export const UNRESOLVE_THREAD_MUTATION = `mutation($id: ID!) {
  unresolveReviewThread(input: { threadId: $id }) {
    thread { isResolved }
  }
}`

// Fields are automatically extracted from queries by script/validate-github-graphql.ts
