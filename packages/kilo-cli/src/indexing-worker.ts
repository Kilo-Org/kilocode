// Third compile entrypoint, as `photon-worker.ts`: the codebase indexing worker lands next to index.js and the shared
// chunks in the executable, where the indexing plugin resolves "./indexing-worker.js".
import "../../kilo-plugin/src/indexing/indexing-worker"
