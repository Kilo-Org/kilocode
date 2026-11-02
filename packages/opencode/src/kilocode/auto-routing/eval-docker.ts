import type { Provider } from "@/provider/provider"

// ADR 0005 client eval protocol: every case runs in a local container built from
// the same base as the platform benchmark container
// (services/auto-routing-benchmark/container/Dockerfile), with the host CLI
// version installed. Local endpoints are reached through host.docker.internal.
export const EVAL_IMAGE_PREFIX = "kilo-auto-eval"
export const EVAL_ENTRYPOINT_FILE = "eval-run.mjs"
export const HOST_ALIAS = "host.docker.internal"

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
  return `${EVAL_IMAGE_PREFIX}:${hasher.digest("hex").slice(0, 12)}`
}

export function evalCliArgs(input: { provider: string; model: string; variant: string | null }): string[] {
  const args = ["-m", `${input.provider}/${input.model}`]
  if (input.variant) args.push("--variant", input.variant)
  return args
}

// Local model servers listen on the host loopback; the container reaches them
// through the Docker host gateway. WHATWG URL keeps IPv6 hosts bracketed, so
// the loopback list carries both spellings.
export function hostUrl(url: string): string {
  const parsed = URL.parse(url)
  if (!parsed) return url
  if (!["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(parsed.hostname)) return url
  parsed.hostname = HOST_ALIAS
  return parsed.toString()
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

export type EvalProviderConfigInput = {
  model: Provider.Model
  provider: Provider.Info
}

export type EvalModelConfig = {
  id: string
  name: string
  reasoning: boolean
  tool_call: boolean
  attachment: boolean
  temperature: boolean
  modalities: { input: string[]; output: string[] }
  cost: { input: number; output: number; cache_read: number; cache_write: number }
  limit: { context: number; output: number }
  variants?: Record<string, Record<string, unknown>>
  headers?: Record<string, string>
}

export type EvalProviderConfig = {
  provider: Record<
    string,
    { name: string; npm: string; options: Record<string, unknown>; models: Record<string, EvalModelConfig> }
  >
  enabled_providers: string[]
}

// The container only needs the provider that serves the entry model. Credentials
// travel separately in KILO_AUTH_CONTENT, so the generated config never carries
// a key.
export function evalProviderConfig(input: EvalProviderConfigInput): EvalProviderConfig {
  const options = { ...(input.provider.options ?? {}) } as Record<string, unknown>
  for (const key of ["apiKey", "kilocodeToken", "kilocodeOrganizationId", "headers"]) delete options[key]
  const base = options.baseURL ?? options.endpoint
  if (typeof base === "string") {
    const url = hostUrl(base)
    if (typeof options.baseURL === "string") options.baseURL = url
    if (typeof options.endpoint === "string") options.endpoint = url
  }
  return {
    provider: {
      [input.provider.id]: {
        name: input.provider.name,
        npm: input.model.api.npm,
        options,
        models: {
          [input.model.id]: {
            id: input.model.api.id,
            name: input.model.name,
            reasoning: input.model.capabilities.reasoning,
            tool_call: input.model.capabilities.toolcall,
            attachment: input.model.capabilities.attachment,
            temperature: input.model.capabilities.temperature,
            modalities: {
              input: modalities(input.model.capabilities.input),
              output: modalities(input.model.capabilities.output),
            },
            cost: {
              input: input.model.cost.input,
              output: input.model.cost.output,
              cache_read: input.model.cost.cache.read,
              cache_write: input.model.cost.cache.write,
            },
            limit: {
              context: input.model.limit.context,
              output: input.model.limit.output,
            },
            ...(input.model.variants ? { variants: input.model.variants } : {}),
            ...modelHeaders(input.model.headers),
          },
        },
      },
    },
    enabled_providers: [input.provider.id],
  }
}

// Model headers are part of the request the model normally receives; credential
// headers stay out because the key travels in KILO_AUTH_CONTENT.
function modelHeaders(headers: Record<string, string>): { headers?: Record<string, string> } {
  const kept = Object.fromEntries(Object.entries(headers).filter(([key]) => !isSecretKey(key)))
  return Object.keys(kept).length > 0 ? { headers: kept } : {}
}

function modalities(input: Record<string, boolean>): string[] {
  return Object.entries(input)
    .filter(([, supported]) => supported)
    .map(([name]) => name)
}

// The smoke path prints the generated config; any credential-shaped value is
// replaced before it reaches a terminal.
export function redactedConfig(config: unknown): string {
  return JSON.stringify(config, (key, value) => (isSecretKey(key) ? "[redacted]" : value), 2)
}

function isSecretKey(key: string): boolean {
  return /(api[-_]?key|token|secret|password|authorization|cookie)/i.test(key)
}
