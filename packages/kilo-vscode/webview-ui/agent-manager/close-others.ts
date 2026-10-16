/**
 * The generic close helpers live in `src/utils/tab-close.ts` so the sidebar and
 * Agent Manager share one implementation. Re-exported here for existing callers.
 */
export { closeOthers, reveal, type CloseOthersDeps } from "../src/utils/tab-close"
