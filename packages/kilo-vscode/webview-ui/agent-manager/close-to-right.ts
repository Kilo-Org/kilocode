/**
 * The generic close-to-right helpers live in `src/utils/tab-close.ts` so the
 * sidebar and Agent Manager share one implementation. Re-exported here for
 * existing callers.
 */
export { closableRightOf, closeToRight, type CloseToRightDeps } from "../src/utils/tab-close"
