// Second compile entrypoint, as upstream's packages/cli/src/photon-worker.ts: it lands next to index.js and the
// shared chunks in the executable, where Image.Photon resolves "./photon-worker.js".
import "@opencode/cli/photon-worker"
