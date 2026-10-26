/**
 * Providers for the semantic layer.
 *
 * The layer never talks to a model directly. Three implementations sit behind one interface:
 *
 *  - `MockProvider` — scripted verdicts, for tests that need to control what the model says.
 *  - `HeuristicProvider` — dependency-free, offline. Used by the benchmark so a run needs no key and
 *    no network. It is a **stand-in, not a model**: it reads the untrusted excerpt for an imperative
 *    addressed to the agent. Where it agrees with a real model is where the task is easy.
 *  - `ModelProvider` — a small remote or local model, behind config. Off unless configured.
 *
 * Every call is bounded by an `AbortSignal` the caller owns: a provider that hangs is worse than one
 * that is wrong, because a security decision that never returns stalls the agent.
 */
import { NO_SIGNAL, SYSTEM_PROMPT, nonce, parse, render, type SemanticInput, type Verdict } from "./schema"

/**
 * One circuit breaker for everything that calls the provider.
 *
 * A misconfigured provider fails the same way every time, and paying the deadline for it on every
 * decision is a latency bug wearing a safety hat. It lives here rather than in the semantic layer
 * because the explanation path calls the same provider for the same reasons and would otherwise keep
 * paying after the classifier had given up — which is how a session with no model configured ends up
 * waiting on every single denial.
 *
 * Tripping it lands the layer in exactly the state it is designed to be safe in: contributing
 * nothing.
 */
export namespace ClassifierBreaker {
  const LIMIT = 3
  let failures = 0
  export function tripped() {
    return failures >= LIMIT
  }
  export function record(ok: boolean) {
    failures = ok ? 0 : failures + 1
  }
  export function reset() {
    failures = 0
  }
}

export interface ClassifierProvider {
  readonly name: string
  classify(input: SemanticInput, signal: AbortSignal): Promise<Verdict>
  /**
   * Optional: rewrite a security notice into one plain sentence for a person to read.
   *
   * Optional because the deterministic template is already the product. A provider that does not
   * implement this simply leaves the template in place — which is what the offline stand-in does,
   * since a regex has nothing to add to a sentence.
   */
  rewrite?(system: string, text: string, signal: AbortSignal): Promise<string>
}

/** Scripted provider for tests: answers from a queue, or the same verdict every time. */
export class MockProvider implements ClassifierProvider {
  readonly name = "mock"
  readonly seen: SemanticInput[] = []
  constructor(private readonly script: Verdict | Verdict[]) {}
  async classify(input: SemanticInput): Promise<Verdict> {
    this.seen.push(input)
    if (Array.isArray(this.script)) return this.script[this.seen.length - 1] ?? NO_SIGNAL
    return this.script
  }
}

/**
 * Offline stand-in. It looks for the shape of an indirect injection: an imperative addressed to the
 * agent in text the user did not write, naming an action that matches the one being judged.
 *
 * It is not the thing being proposed — it is what lets the composition be measured without a key.
 */
export class HeuristicProvider implements ClassifierProvider {
  readonly name = "heuristic-offline"

  /**
   * Signal (a): does the untrusted text read like an instruction aimed at the agent?
   *
   * Pattern matching, and it shows: it catches the phrasings it was written against and misses the
   * same attacks written politely. That is the point of keeping it clearly separate from the model
   * path rather than presenting it as a cheaper equivalent.
   */
  private injection(text: string, network: boolean): Verdict | undefined {
    if (!text.trim()) return undefined
    const addressed =
      /\b(agent|assistant|ai|llm|copilot)\b\s*[:,-]|ignore (the )?(previous|above|prior)\b|you must\b|do the following\b/i
    const imperative =
      /\b(read|cat|collect|stage|copy|rename|append|encode|base64|pipe|send|post|upload|transmit|exfiltrat\w*|curl|wget)\b/i
    const outbound = /\b(post|send|upload|transmit|curl|wget|endpoint|collector|webhook|http)\b/i

    const looksAddressed = addressed.test(text)
    const looksActionable = imperative.test(text) && outbound.test(text)
    if (!looksAddressed && !looksActionable) return undefined
    if (!network) return { risk: "SUSPICIOUS", category: "PROMPT_INJECTION", confidence: "LOW" }
    if (looksAddressed && looksActionable)
      return { risk: "HIGH_RISK", category: "PROMPT_INJECTION", confidence: "HIGH" }
    return { risk: "SUSPICIOUS", category: "PROMPT_INJECTION", confidence: "MEDIUM" }
  }

  /**
   * Signal (b): does the action send data outward while the request never mentioned sending anything?
   *
   * Structural rather than lexical on the action side: its own classification says it leaves the
   * machine and what it carries. The request is checked only for whether the person asked for
   * anything outbound at all. A request that does mention it drops the signal to nothing — which is
   * as far as a matching goal is ever allowed to go, because this function returns an opinion that
   * something is off and has no way to express the opposite.
   */
  private mismatch(input: SemanticInput): Verdict | undefined {
    const goal = input.goal?.toLowerCase()
    if (!goal || !input.action.network) return undefined

    // Does the request name the subject of the action — the store, the labels, or a word from the
    // file's own name? "Set up the AWS deployment" and a read of the AWS config share a subject;
    // "fix the typo in the README" and a read of `~/.aws/credentials` share nothing. This is the
    // comparison the signal is actually about, and it only ever quiets the signal.
    const subjects = new Set<string>()
    for (const operand of input.action.operands) {
      if (operand.store) subjects.add(operand.store)
      for (const label of operand.labels) subjects.add(label.replace(/-/g, " "))
      for (const word of operand.basename.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 2) subjects.add(word)
    }
    if ([...subjects].some((subject) => goal.includes(subject))) return undefined

    // Nothing in the request refers to what is being touched. Did it ask for anything outbound at all?
    const outbound =
      /\b(send|post|upload|publish|deploy\w*|push|share|report|notify|sync|mirror|export|submit|webhook|curl|http)\b/
    if (outbound.test(goal)) return undefined

    const carriesSecret = input.action.operands.some(
      (operand) =>
        operand.effect === "read" &&
        (operand.labels.length > 0 ||
          operand.relation === "home-sensitive" ||
          /token|secret|credential|password|\bkey\b|\.env|auth/i.test(operand.basename)),
    )
    if (carriesSecret || input.action.readSecret)
      return { risk: "HIGH_RISK", category: "USER_GOAL_MISMATCH", confidence: "MEDIUM" }
    return { risk: "SUSPICIOUS", category: "USER_GOAL_MISMATCH", confidence: "MEDIUM" }
  }

  async classify(input: SemanticInput): Promise<Verdict> {
    const text = input.provenance.map((item) => item.excerpt).join("\n")
    const found = [this.injection(text, input.action.network), this.mismatch(input)].filter(
      (item): item is Verdict => item !== undefined,
    )
    if (found.length === 0)
      return text.trim() ? { risk: "ORDINARY", category: "BENIGN_CONTEXT", confidence: "LOW" } : NO_SIGNAL
    // Report the more serious of the two, which is what the model is asked to do.
    const order = { ORDINARY: 0, SUSPICIOUS: 1, HIGH_RISK: 2 }
    return found.reduce((worst, item) => (order[item.risk] > order[worst.risk] ? item : worst))
  }
}

export interface ModelBackend {
  readonly name: string
  complete(system: string, user: string, maxTokens: number, signal: AbortSignal): Promise<string>
}

/**
 * The model Kilo is already configured with, through Kilo's own provider service.
 *
 * This is the backend a deployment should use. It hardcodes no vendor, needs no second key, and
 * follows whatever the user already set up — including a local OpenAI-compatible server declared as a
 * `provider` block in the Kilo config. It asks for the *small* model, the same one prompt enhancement
 * and title generation use, because this is the same shape of job.
 *
 * Everything is behind `await import()`. The classifier subtree is otherwise a leaf — `schema.ts`
 * imports `node:crypto` and nothing else — and a static import here would pull the provider service,
 * the Effect layer graph and the AI SDK into every module that touches security, including its unit
 * tests. It would also add an edge into a strongly-connected component whose members read
 * `Plugin.node` and `Provider.node` at module-body time; that component has already produced a
 * `Cannot access 'node' before initialization` in this project once. The deferral is the same pattern
 * `kilocode/cli/cmd/roll-call.ts` uses, for the same reason.
 */
let kiloDeps: Promise<KiloDeps> | undefined
let kiloReady: KiloDeps | undefined

interface KiloDeps {
  generateText: typeof import("ai").generateText
  Provider: typeof import("@/provider/provider").Provider
  ProviderTransform: typeof import("@/provider/transform").ProviderTransform
  AppRuntime: typeof import("@/effect/app-runtime").AppRuntime
  Effect: typeof import("effect").Effect
}

/**
 * Load the provider graph once, in the background, and never inside a decision.
 *
 * Measured: the first call cost 1.08 s — the AI SDK and the provider layer being imported — and that
 * second landed inside a live security decision, which was enough to push one benchmark scenario past
 * its own timeout and change its outcome. A layer that cannot relax a decision was still able to
 * change one, through latency. So the first call now starts the import and returns nothing, and only
 * calls made after it finishes reach a model. "Nothing" is the layer's safe direction anyway.
 */
function kiloModules(): KiloDeps | undefined {
  kiloDeps ??= Promise.all([
    import("ai"),
    import("@/provider/provider"),
    import("@/provider/transform"),
    import("@/effect/app-runtime"),
    import("effect"),
  ]).then(([ai, provider, transform, runtime, effect]) => {
    kiloReady = {
      generateText: ai.generateText,
      Provider: provider.Provider,
      ProviderTransform: transform.ProviderTransform,
      AppRuntime: runtime.AppRuntime,
      Effect: effect.Effect,
    }
    return kiloReady
  })
  return kiloReady
}

/** Test seam: forget the cached module graph. */
export function resetKiloModules() {
  kiloDeps = undefined
  kiloReady = undefined
}

/**
 * What each model call cost, recorded as it happens.
 *
 * A security feature that calls a model has a price, and "we did not measure it" is not an acceptable
 * answer to a question about it. Tokens come from the provider's own report; the rate comes from the
 * model catalogue Kilo already carries, so the cost is computed the same way the session cost is.
 */
export interface ClassifierCall {
  model: string
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  latencyMs: number
}

export namespace ClassifierUsage {
  const calls: ClassifierCall[] = []
  export function record(call: ClassifierCall) {
    calls.push(call)
  }
  export function snapshot(): ClassifierCall[] {
    return [...calls]
  }
  export function reset() {
    calls.length = 0
  }
  export function total() {
    return calls.reduce(
      (acc, call) => ({
        calls: acc.calls + 1,
        inputTokens: acc.inputTokens + call.inputTokens,
        outputTokens: acc.outputTokens + call.outputTokens,
        reasoningTokens: acc.reasoningTokens + call.reasoningTokens,
        costUsd: acc.costUsd + call.costUsd,
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
    )
  }
}

/**
 * A model reached through Kilo's own provider service.
 *
 * This is the backend a deployment should use: no vendor is named here, no second key is introduced,
 * and whatever the user already configured — a cloud provider, a gateway, a local OpenAI-compatible
 * server declared in the Kilo config — is what answers. With no model pinned it asks for the *small*
 * model, the same one prompt enhancement and title generation use, because this is the same shape of
 * job. `model` (or `KILO_SECURITY_AUTO_CLASSIFIER_MODEL`) pins a specific `provider/model` when a
 * deployment wants the security classifier decoupled from the coding model, which is also how the
 * evaluation pins one model across a whole run.
 */
export function kiloBackend(opts: { model?: string } = {}): ModelBackend {
  const pinned = opts.model ?? process.env["KILO_SECURITY_AUTO_CLASSIFIER_MODEL"]
  // Start the import here, when the backend is built, rather than on the first call that needs an
  // answer. Building it is what a session does when the layer is switched on, which is typically many
  // decisions before the first outbound action — so by the time a verdict is wanted, the graph is
  // loaded. Measured: without this, the first eligible decision in a process always got no answer,
  // and in a benchmark that lands on whichever scenario happens to go first.
  //
  // Off the current tick, though. A caller may build this at module-evaluation time (the evaluation
  // script does), and starting the import there re-enters a strongly connected component whose
  // members read module-level constants — which is exactly the `Cannot access 'Path' before
  // initialization` this deferral exists to avoid.
  setTimeout(() => kiloModules(), 0)
  return {
    name: pinned ? `kilo:${pinned}` : "kilo:small-model",
    async complete(system, user, maxTokens, signal) {
      const deps = kiloModules()
      // Still loading. Say nothing rather than make a decision wait on an import.
      if (!deps) return ""
      const { generateText, Provider, ProviderTransform, AppRuntime, Effect } = deps
      const resolved = await AppRuntime.runPromise(
        Provider.Service.use((service) =>
          Effect.gen(function* () {
            const ref = pinned ? Provider.parseModel(pinned) : yield* service.defaultModel()
            const model = pinned
              ? yield* service.getModel(ref.providerID, ref.modelID)
              : ((yield* service.getSmallModel(ref.providerID)) ??
                (yield* service.getModel(ref.providerID, ref.modelID)))
            return { model, language: yield* service.getLanguage(model) }
          }),
        ),
      )
      const started = performance.now()
      const result = await generateText({
        model: resolved.language,
        // Deterministic where the provider allows it: a security notice should not vary run to run.
        temperature: resolved.model.capabilities.temperature ? 0 : undefined,
        providerOptions: ProviderTransform.providerOptions(resolved.model, resolved.model.options),
        maxRetries: 0,
        abortSignal: signal,
        maxOutputTokens: maxTokens,
        system,
        messages: [{ role: "user" as const, content: user }],
      })
      const inputTokens = result.usage?.inputTokens ?? 0
      const outputTokens = result.usage?.outputTokens ?? 0
      const reasoningTokens = result.usage?.reasoningTokens ?? 0
      ClassifierUsage.record({
        model: `${resolved.model.providerID}/${resolved.model.id}`,
        inputTokens,
        outputTokens,
        reasoningTokens,
        // The catalogue quotes dollars per million tokens.
        costUsd:
          (inputTokens * (resolved.model.cost?.input ?? 0) + outputTokens * (resolved.model.cost?.output ?? 0)) / 1e6,
        latencyMs: performance.now() - started,
      })
      return result.text.trim()
    },
  }
}

export class ModelProvider implements ClassifierProvider {
  readonly name: string
  constructor(private readonly backend: ModelBackend) {
    this.name = backend.name
  }
  async classify(input: SemanticInput, signal: AbortSignal): Promise<Verdict> {
    const id = nonce()
    // 24 tokens: enough for the one line, far too few for the model to argue with itself.
    return parse(await this.backend.complete(SYSTEM_PROMPT, render(input, id), 24, signal))
  }

  /** The input here is a sentence this codebase wrote, not anything a repository controls. */
  async rewrite(system: string, text: string, signal: AbortSignal): Promise<string> {
    return this.backend.complete(system, text, 64, signal)
  }
}

/**
 * Build a provider from the environment. Returns `undefined` — never throws — when unconfigured.
 *
 * There are two kinds and deliberately no third. `kilo` is the model the user already configured,
 * reached through Kilo's own provider service, so no vendor is named here and no second key exists to
 * manage; a local OpenAI-compatible server is reached the same way, by declaring it as a `provider`
 * block in the Kilo config. `heuristic` is the offline stand-in for runs that must not touch a
 * network. Anything else returns nothing, which is the layer's safe state.
 */
export function providerFromEnv(): ClassifierProvider | undefined {
  const kind = (process.env["KILO_SECURITY_AUTO_CLASSIFIER_PROVIDER"] ?? "kilo").toLowerCase()
  if (kind === "heuristic") return new HeuristicProvider()
  if (kind === "kilo") return new ModelProvider(kiloBackend())
  return undefined
}

let cached: { provider: ClassifierProvider | undefined } | undefined

/** The process-wide provider, built once. Rebuilt only by {@link resetProvider} (tests, benchmark). */
export function defaultProvider(): ClassifierProvider | undefined {
  cached ??= { provider: providerFromEnv() }
  return cached.provider
}

export function resetProvider() {
  cached = undefined
}

/**
 * Test seam: pin the process-wide provider.
 *
 * Only tests and the evaluation scripts use it. It exists because the properties worth asserting
 * about this layer are about *failing* providers — one that throws where nothing catches, one that
 * never answers, one that answers with a 401 — and those have to be reachable from the gate, not
 * only from the layer they live behind.
 */
export function setProvider(provider: ClassifierProvider | undefined) {
  cached = { provider }
}
