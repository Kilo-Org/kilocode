import type { SecuritySessionState } from "./store"

/**
 * Secret classification of content the agent actually obtained.
 *
 * The egress layer decides what is sensitive from the *path*: `~/.ssh/id_rsa`, `.env`, a credential
 * store. That leaves the class the benchmark kept finding — a real API token living in `src/config.ts`,
 * a README or a project JSON file, whose path says nothing. This module closes it by classifying the
 * content instead, and it is deliberately not a DLP engine:
 *
 * - every detector is a named, explainable pattern, not a score;
 * - entropy alone is never proof. A random-looking string becomes a secret only when a *structural*
 *   signal agrees — a known credential prefix, a PEM header, or a credential-shaped assignment key —
 *   because the alternative poisons a session the moment the agent reads a lockfile;
 * - the benign shapes that look random (UUIDs, git SHAs, integrity hashes, checksums, public keys,
 *   placeholders, template variables, documentation examples, obvious fakes) are filtered explicitly,
 *   and the filter runs before the detectors, not after;
 * - nothing here stores or logs a value. `classify` returns the matched values so the *caller* can
 *   fingerprint them with the session salt and drop them; `Finding.evidence` is the key name or the
 *   pattern name, never the secret.
 */
export namespace SecretContent {
  export type Label = SecuritySessionState.Label

  export interface Finding {
    /** Stable detector id, e.g. `pem.private-key`, `prefix.github`, `assignment.credential`. */
    kind: string
    label: Label
    /** Non-sensitive explanation: a key name, a pattern name. Never the value. */
    evidence: string
    /** The matched material. In process only — callers digest it and must not persist or log it. */
    value: string
  }

  export interface Result {
    labels: Label[]
    findings: Finding[]
    /** Values to fingerprint, deduplicated. Same lifetime rule as {@link Finding.value}. */
    values: string[]
  }

  export const MAX_TEXT = 512 * 1024
  const MAX_FINDINGS = 64
  const EMPTY: Result = { labels: [], findings: [], values: [] }

  // ---------------------------------------------------------------------------------------------
  // Benign shapes. Checked first: a value that matches any of these is never a secret, whatever else
  // it looks like. This is the false-positive budget, and it is spent deliberately.
  // ---------------------------------------------------------------------------------------------

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  /** Git object ids, MD5/SHA digests, checksums: fixed-width hex with no other structure. */
  const HEX_DIGEST = /^(?:[0-9a-f]{7}|[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{56}|[0-9a-f]{64}|[0-9a-f]{128})$/i
  /** Subresource / lockfile integrity, e.g. `sha512-...`, `sha256:...`. */
  const INTEGRITY = /^(?:sha1|sha224|sha256|sha384|sha512|md5|crc32|blake[23])[-:=]/i
  /** Public key material is not a secret. */
  const PUBLIC_KEY = /^(?:ssh-(?:rsa|dss|ed25519)|ecdsa-sha2-|-----BEGIN (?:PUBLIC KEY|CERTIFICATE))/
  /** A templated or interpolated value carries no secret of its own. */
  const TEMPLATED = /\$\{|\{\{|<%|%\(|\$\(|%[sdv]\b/
  /** Explicit placeholder shapes. */
  const PLACEHOLDER_SHAPE = /^(?:<.*>|\[.*\]|x{3,}|\*{3,}|\.{3,}|-{3,}|_{3,}|0+|1+)$/i
  /**
   * Words a placeholder is made of. A value counts as a placeholder only when **every** one of its
   * tokens comes from this vocabulary. Matching these as substrings instead would discard real
   * credentials that happen to contain a common word, which is the opposite of the failure we can
   * afford: a missed secret is a security hole, a mislabelled lockfile is only friction.
   */
  const PLACEHOLDER_VOCABULARY = new Set([
    "your",
    "my",
    "our",
    "some",
    "the",
    "a",
    "an",
    "own",
    "api",
    "app",
    "client",
    "server",
    "user",
    "auth",
    "access",
    "secret",
    "private",
    "public",
    "key",
    "keys",
    "token",
    "tokens",
    "password",
    "passwd",
    "credential",
    "credentials",
    "id",
    "here",
    "goes",
    "value",
    "string",
    "example",
    "examples",
    "placeholder",
    "changeme",
    "change",
    "me",
    "dummy",
    "sample",
    "fake",
    "test",
    "testing",
    "demo",
    "redacted",
    "hidden",
    "todo",
    "tbd",
    "insert",
    "replace",
    "put",
    "add",
    "set",
    "none",
    "null",
    "nil",
    "undefined",
    "unset",
    "empty",
    "na",
    "real",
    "do",
    "not",
    "use",
    "abc",
    "xyz",
    "foo",
    "bar",
    "baz",
    "lorem",
    "ipsum",
  ])

  /** A dotted identifier or a call expression is code, not material: `process.env.API_KEY`, `getKey()`. */
  const CODE_REFERENCE = /^[A-Za-z_$][A-Za-z0-9_$]{0,24}(?:\.[A-Za-z_$][A-Za-z0-9_$]{0,24})+$/
  const CALL_EXPRESSION = /^[A-Za-z_$][\w$.]*\(.*\)$/

  /**
   * True when the value is built entirely out of placeholder words (`YOUR_API_KEY_HERE`,
   * `your-api-key`, `changeme`). A single opaque token is never a placeholder, however "fake" the
   * surrounding prose looks.
   */
  export function placeholder(value: string): boolean {
    const parts = value
      .toLowerCase()
      .split(/[-_. :/]+/)
      .filter((part) => part.length > 0)
    if (parts.length === 0) return true
    return parts.every((part) => PLACEHOLDER_VOCABULARY.has(part) || /^\d+$/.test(part))
  }
  /** Semantic versions, dates, numbers. */
  const VERSIONISH = /^v?\d+(?:\.\d+)+(?:[-+][A-Za-z0-9.]+)?$/
  const DATEISH = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/
  const PATHISH = /^(?:\/|\.{1,2}\/|~\/|[A-Za-z]:[\\/])/
  const URLISH = /^(?:https?|ftp|ws|wss|file|git\+ssh|ssh):\/\//i
  const WORDS = /^[A-Za-z][A-Za-z0-9]*(?:[-_ ][A-Za-z0-9]+){0,3}$/
  const MIMEISH = /^(?:data:|application\/|text\/|image\/)/i

  /**
   * True when a candidate value is one of the benign shapes above. Public because the false-positive
   * behaviour is part of the contract this layer is judged on.
   */
  export function benign(value: string): boolean {
    const text = value.trim()
    if (text.length === 0) return true
    if (UUID.test(text)) return true
    if (HEX_DIGEST.test(text)) return true
    if (INTEGRITY.test(text)) return true
    if (PUBLIC_KEY.test(text)) return true
    if (TEMPLATED.test(text)) return true
    if (PLACEHOLDER_SHAPE.test(text)) return true
    if (placeholder(text)) return true
    if (CODE_REFERENCE.test(text)) return true
    if (CALL_EXPRESSION.test(text)) return true
    if (VERSIONISH.test(text)) return true
    if (DATEISH.test(text)) return true
    if (PATHISH.test(text)) return true
    if (MIMEISH.test(text)) return true
    // A bare URL is not a credential; one carrying userinfo is handled by the assignment detector.
    if (URLISH.test(text) && !/:\/\/[^/@\s]+:[^/@\s]+@/.test(text)) return true
    // Ordinary prose / identifiers: a handful of words with no opaque run.
    if (WORDS.test(text) && !/[A-Za-z0-9]{25,}/.test(text)) return true
    // Repeated single character (`aaaaaaaa`, `00000000`).
    if (/^(.)\1+$/.test(text)) return true
    return false
  }

  // ---------------------------------------------------------------------------------------------
  // Detectors
  // ---------------------------------------------------------------------------------------------

  /** Vendor credential prefixes: the value's own structure identifies it, no context needed. */
  const PREFIXES: { name: string; pattern: RegExp; label: Label }[] = [
    { name: "openai", pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, label: "credential" },
    { name: "github", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, label: "credential" },
    { name: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}/g, label: "credential" },
    { name: "gitlab", pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g, label: "credential" },
    { name: "slack", pattern: /\bxox[baprs]-[A-Za-z0-9-]{12,}/g, label: "credential" },
    { name: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, label: "credential" },
    { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "credential" },
    { name: "google-oauth", pattern: /\bya29\.[0-9A-Za-z_-]{20,}/g, label: "credential" },
    { name: "sendgrid", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, label: "credential" },
    { name: "stripe", pattern: /\b[sprk]k_(?:live|test)_[A-Za-z0-9]{16,}/g, label: "credential" },
    { name: "npm", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, label: "credential" },
    { name: "huggingface", pattern: /\bhf_[A-Za-z0-9]{30,}/g, label: "credential" },
    { name: "digitalocean", pattern: /\bdop_v1_[a-f0-9]{60,}/g, label: "credential" },
    { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}/g, label: "token" },
  ]

  /** A password embedded in a connection URL: `postgres://user:secret@host/db`. */
  const URL_CREDENTIAL = /\b[a-z][a-z0-9+.\-]{1,20}:\/\/[^\s:@/]{1,64}:([^\s:@/]{6,})@/gi

  const PEM = /-----BEGIN (?:[A-Z0-9 ]*)?PRIVATE KEY-----[\s\S]{0,8192}?-----END (?:[A-Z0-9 ]*)?PRIVATE KEY-----/g

  /**
   * Assignment whose *key* names a credential. This is the structural signal that lets an opaque
   * value count without falling back to entropy.
   */
  const CREDENTIAL_KEY =
    /(?:^|[._\- ])(?:secret|secrets|token|tokens|password|passwd|pwd|passphrase|apikey|api_key|api-key|accesskey|access_key|access-key|secretkey|secret_key|secret-key|privatekey|private_key|private-key|credential|credentials|client_secret|clientsecret|auth|authorization|session_key|encryption_key|signing_key|refresh_token|access_token|id_token|bearer)$/i

  /** `KEY=value`, `key: value`, `"key": "value"`, `const key = "value"`, `key := value`. */
  const ASSIGNMENT =
    /^\s*(?:(?:export|const|let|var|final|val|public|private|static|readonly)\s+)*["'`]?([A-Za-z_$][A-Za-z0-9_$.\-]{1,64})["'`]?\s*(?::=|=|:)\s*(.+?)\s*[,;]?\s*$/

  /**
   * A credential keyword followed closely by an opaque value. This is the prose form of the same
   * structural idea as the assignment detector — "use the token X for staging" — and it is what makes
   * a secret pasted into a README or a runbook visible. It still needs *both* halves: the keyword
   * alone is prose, and the opaque value alone is a build id.
   */
  const KEYWORD_CONTEXT =
    /(?:api[ _-]?key|access[ _-]?key|secret[ _-]?key|private[ _-]?key|client[ _-]?secret|access[ _-]?token|auth[ _-]?token|bearer[ _-]?token|api[ _-]?token|\btoken\b|\bsecret\b|\bpassword\b|\bpassphrase\b|\bcredentials?\b)[^\n]{0,64}?([A-Za-z0-9][A-Za-z0-9_\-+/=.]{15,})/gi

  /**
   * Is this an opaque value rather than prose? Requires length and more than one character class, so
   * an English word or a hyphenated phrase of the same length does not qualify.
   */
  function opaque(value: string): boolean {
    if (value.length < 16) return false
    if (benign(value)) return false
    const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value), /[_\-+/=.]/.test(value)].filter(
      Boolean,
    ).length
    if (classes < 2) return false
    // A run of ordinary words joined by separators is prose or a path (`app/production/credentials`,
    // `etc/ssl/private/server.key`), not material.
    if (/^(?:[A-Za-z]{2,}[ _\-./]){2,}[A-Za-z]{2,}$/.test(value)) return false
    // Slash-separated words with no digits are a path, whatever their length.
    if (value.includes("/") && !/\d/.test(value)) return false
    return true
  }

  /** A JWT is only a credential when a credential-shaped key introduces it. */
  const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

  function unquote(value: string) {
    const text = value.trim()
    if (text.length >= 2) {
      const first = text[0]
      const last = text[text.length - 1]
      if ((first === '"' || first === "'" || first === "`") && first === last) return text.slice(1, -1)
    }
    // dotenv: an unquoted value ends at ` #`
    const comment = text.indexOf(" #")
    return comment > 0 ? text.slice(0, comment).trim() : text
  }

  /** Names whose content is structurally noisy and must not feed the assignment detector. */
  const NOISY_FILE =
    /(?:^|[\\/])(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|composer\.lock|gemfile\.lock|go\.sum|go\.mod|.*\.min\.js|.*\.map|.*\.snap)$/i

  export interface Options {
    /** Path or name of the resource the content came from, when known. Used only to skip noisy files. */
    file?: string
  }

  /**
   * Classify obtained content. Returns the labels it earns, the explainable findings behind them, and
   * the values to fingerprint. Never throws: an unparseable input is simply not a secret.
   */
  export function classify(text: string, opts: Options = {}): Result {
    if (typeof text !== "string" || text.length === 0) return EMPTY
    try {
      const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
      const findings: Finding[] = []
      const seen = new Set<string>()
      const push = (finding: Finding) => {
        if (findings.length >= MAX_FINDINGS) return
        if (seen.has(finding.value)) return
        seen.add(finding.value)
        findings.push(finding)
      }

      // 1. PEM private keys: unambiguous, context-free.
      for (const match of body.matchAll(PEM)) {
        push({ kind: "pem.private-key", label: "private-key", evidence: "PEM private key block", value: match[0] })
      }

      // 2. Vendor credential prefixes: the value identifies itself.
      for (const prefix of PREFIXES) {
        for (const match of body.matchAll(prefix.pattern)) {
          const value = match[0]
          // The vendor prefix *is* the structural proof, so the generic benign shapes (which would
          // read `AKIA…` as an ordinary identifier) do not apply — only an outright placeholder does.
          if (placeholder(value) || TEMPLATED.test(value)) continue
          push({
            kind: `prefix.${prefix.name}`,
            label: prefix.label,
            evidence: `${prefix.name} credential format`,
            value,
          })
        }
      }

      // 3. Credential-shaped assignments. Skipped for files whose content is structurally noisy.
      if (!(opts.file && NOISY_FILE.test(opts.file))) {
        for (const line of body.split(/\r?\n/)) {
          if (line.length > 4096) continue
          const match = line.match(ASSIGNMENT)
          if (!match) continue
          const key = match[1]!
          const value = unquote(match[2]!)
          if (!CREDENTIAL_KEY.test(key.replace(/[.\-]/g, "_"))) continue
          if (value.length < 8) continue
          // A JWT is a positive structural signal, so it is checked before the benign shapes (whose
          // dotted-identifier rule would otherwise swallow it).
          const jwt = JWT.test(value)
          if (!jwt && benign(value)) continue
          if (value.toLowerCase() === key.toLowerCase()) continue
          push({
            kind: jwt ? "assignment.jwt" : "assignment.credential",
            label: /private[_-]?key/i.test(key) ? "private-key" : jwt ? "token" : "credential",
            evidence: `credential-shaped assignment to \`${key}\``,
            value,
          })
        }
      }

      // 3b. A password embedded in a connection URL, whose key is usually not credential-shaped.
      for (const match of body.matchAll(URL_CREDENTIAL)) {
        const value = match[1]!
        // The URL position is the structural proof, so only an outright placeholder disqualifies it.
        if (placeholder(value) || TEMPLATED.test(value)) continue
        push({
          kind: "url.credential",
          label: "credential",
          evidence: "password embedded in a connection URL",
          value,
        })
      }

      // 4. Credential keyword next to an opaque value, for the prose form.
      if (!(opts.file && NOISY_FILE.test(opts.file))) {
        for (const match of body.matchAll(KEYWORD_CONTEXT)) {
          const value = match[1]!
          if (!opaque(value)) continue
          const keyword = match[0].slice(0, match[0].length - value.length).trim()
          push({
            kind: "context.credential-keyword",
            label: /private[ _-]?key/i.test(keyword) ? "private-key" : "credential",
            evidence: `opaque value next to \`${keyword.slice(0, 48)}\``,
            value,
          })
        }
      }

      const labels = [...new Set(findings.map((item) => item.label))]
      return { labels, findings, values: findings.map((item) => item.value) }
    } catch {
      // Classification failure is not evidence of safety, but it is also not evidence of a secret:
      // the caller keeps whatever sensitivity the session already had (see the gate's settle path).
      return EMPTY
    }
  }

  /** True when the content earns at least one label. */
  export function sensitive(text: string, opts: Options = {}): boolean {
    return classify(text, opts).labels.length > 0
  }

  /**
   * What this module makes of a piece of text, as three states rather than two.
   *
   * `classify` answers "is there a secret here" and conflates everything else: a file of placeholders
   * and a file holding an opaque token no detector recognises both come back with no findings, and
   * the caller cannot tell that the first was *examined and explained* while the second was merely
   * not matched. That difference is the entire content of this function, and it exists because
   * another layer needs it: the semantic layer is asked whether content is credential material —
   * the same question, on the same bytes — and its answer should carry different weight depending on
   * whether this module has an opinion or not.
   *
   * A text is `benign` only when it contains something worth suspecting *and* a named rule in
   * {@link benign} accounts for every one of them — `ssh-rsa …` is public key material,
   * `YOUR_API_KEY_HERE` is a placeholder. One unexplained opaque value makes the whole text
   * `unknown`, because from here a detector that missed a secret looks exactly like a detector that
   * had nothing to look at.
   */
  export type Adjudication = "credential" | "benign" | "unknown"

  /**
   * Material-looking runs: what someone scanning a file would stop on. `=` only as base64 padding,
   * so `API_KEY=YOUR_API_KEY_HERE` is read as an assignment rather than as one opaque blob.
   */
  const MATERIAL = /[A-Za-z0-9+/_-]{20,}={0,2}/g

  export function adjudicate(text: string, opts: Options = {}): Adjudication {
    if (typeof text !== "string" || text.length === 0) return "unknown"
    try {
      if (classify(text, opts).labels.length > 0) return "credential"
      let candidates = 0
      for (const line of text.length > MAX_TEXT ? text.slice(0, MAX_TEXT).split(/\r?\n/) : text.split(/\r?\n/)) {
        if (line.length > 4096) return "unknown"
        const trimmed = line.trim()
        // A credential-shaped key is itself the suspicion, whatever its value looks like. The value
        // got past `classify`, but only a named rule saying why counts as an explanation here.
        const match = line.match(ASSIGNMENT)
        if (match && CREDENTIAL_KEY.test(match[1]!.replace(/[.\-]/g, "_"))) {
          candidates += 1
          if (!benign(unquote(match[2]!))) return "unknown"
        }
        for (const found of trimmed.matchAll(MATERIAL)) {
          candidates += 1
          // The line is checked as well as the run, because some rules only recognise material in
          // context: the base64 body of a public key is opaque on its own and named by `ssh-rsa`.
          if (!benign(found[0]) && !benign(trimmed)) return "unknown"
        }
      }
      return candidates > 0 ? "benign" : "unknown"
    } catch {
      return "unknown"
    }
  }
}
