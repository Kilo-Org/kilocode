/**
 * Agent Manager tab ids that live only in the webview and are not part of the
 * durable host tab order: the Review tab and pending draft tabs. Kept in one
 * module so the app and the project store cannot drift apart.
 */

export const REVIEW_TAB_ID = "review"
export const PENDING_PREFIX = "pending:"
