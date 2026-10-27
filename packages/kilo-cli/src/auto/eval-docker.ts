// Port of v1 packages/opencode/src/kilocode/auto-routing/eval-docker.ts (#15183). The container config for the
// entry model comes from the `routers.evalConfig` RPC (packages/kilo-plugin/src/gateway/routers.ts).
// ADR 0005 client eval protocol: every case runs in a local container built from
// the same base as the platform benchmark container
// (services/auto-routing-benchmark/container/Dockerfile), with the host CLI
// version installed. Local endpoints are reached through host.docker.internal.
export const EVAL_IMAGE_PREFIX = "kilo-auto-eval"
export const EVAL_ENTRYPOINT_FILE = "eval-run.mjs"
const HOST_ALIAS = "host.docker.internal"

// Runs one `kilo run --format json` case inside the container and reports the
// same measurements the platform container reports: exit code, wall-clock
// duration around the CLI process, timeout state, raw stdout lines, stderr tail.
// The case prompt arrives on the container's stdin and passes straight to the CLI,
// as the platform container sends it: a long-context prompt exceeds Linux's 128 KiB
// limit on one argument, and `kilo run` re-quotes argument messages with spaces.
// With no positional message the CLI reads stdin to EOF and uses it verbatim.
export const EVAL_ENTRYPOINT = `import { spawn } from 'node:child_process';

const STDOUT_CAP_BYTES = 2 * 1024 * 1024;
const STDERR_CAP_BYTES = 4 * 1024;
const timeoutMs = Number(process.env.EVAL_TIMEOUT_MS || 180000);
const cliArgs = ['run', '--format', 'json', '--auto', ...process.argv.slice(2)];
const startedAt = Date.now();

const { promise, resolve } = Promise.withResolvers();
let stdout = '';
let stdoutTruncated = false;
let stderrTail = '';
let timedOut = false;
let finished = false;
let finishTimer;

const finish = exitCode => {
  if (finished) return;
  finished = true;
  clearTimeout(killTimer);
  clearTimeout(finishTimer);
  resolve({
    exitCode,
    durationMs: Date.now() - startedAt,
    timedOut,
    stdoutTruncated,
    stdoutLines: stdout.split('\\n').filter(line => line.length > 0),
    stderrTail,
  });
};

const finishAfterExit = exitCode => {
  if (finished || finishTimer) return;
  finishTimer = setTimeout(() => finish(exitCode), 5000);
  finishTimer.unref();
};

const child = spawn('kilo', cliArgs, { stdio: ['inherit', 'pipe', 'pipe'], detached: true });
const killTimer = setTimeout(() => {
  timedOut = true;
  finishAfterExit(-1);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}, timeoutMs);

child.stdout.on('data', chunk => {
  if (stdoutTruncated) return;
  const text = chunk.toString('utf8');
  if (stdout.length + text.length > STDOUT_CAP_BYTES) {
    stdout += text.slice(0, STDOUT_CAP_BYTES - stdout.length);
    stdoutTruncated = true;
  } else {
    stdout += text;
  }
});
child.stderr.on('data', chunk => {
  stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_CAP_BYTES);
});
child.on('error', () => finish(-1));
child.on('close', code => finish(code ?? -1));
child.on('exit', code => finishAfterExit(code ?? -1));

process.stdout.write(JSON.stringify(await promise));
`

export type EvalContainerResult = {
  exitCode: number
  durationMs: number
  timedOut: boolean
  // The stdout cap cut the event stream; the retained prefix is not the full answer.
  stdoutTruncated: boolean
  stdoutLines: string[]
  stderrTail: string
}

// A source build reports "local" and a branch build "0.0.0-<branch>-<stamp>";
// neither exists on npm. Results must come from a known published CLI, so the
// eval never falls back to a dist-tag such as `latest`.
const PUBLISHED_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export type EvalCliVersion = { ok: true; version: string } | { ok: false; message: string }

export function evalCliVersion(input: { flag?: string; installed: string }): EvalCliVersion {
  const flag = input.flag?.trim()
  if (flag !== undefined && flag !== "") {
    if (published(flag)) return { ok: true, version: flag }
    return {
      ok: false,
      message: `--cli-version must be a published @kilocode/cli version such as 7.8.12, got "${flag}".`,
    }
  }
  if (published(input.installed)) return { ok: true, version: input.installed }
  return {
    ok: false,
    message: `This CLI reports version "${input.installed}", which is not published on npm, so the eval image cannot install it. Pass --cli-version <version> with a published @kilocode/cli version.`,
  }
}

function published(version: string): boolean {
  return PUBLISHED_VERSION.test(version) && !version.startsWith("0.0.0-")
}

export function evalDockerfile(version: string): string {
  return `# Client eval runner for a custom auto router entry.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 g++ make \\
  && rm -rf /var/lib/apt/lists/* \\
  && npm install -g @kilocode/cli@${version}
WORKDIR /app
COPY ${EVAL_ENTRYPOINT_FILE} ./
ENTRYPOINT ["node", "/app/${EVAL_ENTRYPOINT_FILE}"]
`
}

export function evalImageTag(version: string): string {
  const hasher = new Bun.CryptoHasher("sha256")
  hasher.update(EVAL_ENTRYPOINT)
  hasher.update(version)
  // A changed Dockerfile needs a new image, not the cached one.
  hasher.update(evalDockerfile(version))
  return `${EVAL_IMAGE_PREFIX}:${hasher.digest("hex").slice(0, 12)}`
}

export function evalCliArgs(input: { provider: string; model: string; variant: string | null }): string[] {
  const args = ["-m", `${input.provider}/${input.model}`]
  if (input.variant) args.push("--variant", input.variant)
  return args
}

// `-i` keeps the container's stdin open so the caller can stream the case prompt.
export function evalDockerRunArgs(input: { image: string; envFile: string; args: string[] }): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--add-host",
    `${HOST_ALIAS}:host-gateway`,
    "--env-file",
    input.envFile,
    input.image,
    ...input.args,
  ]
}
