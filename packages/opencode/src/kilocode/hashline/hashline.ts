/**
 * Core Hashline logic — content-addressable line hashing for precise AI code editing.
 *
 * Each line gets a hex hash tag derived from its index and trimmed content.
 * Hash length adapts to file size: 3 chars (≤4096 lines), 4 chars (>4096).
 * Minimum hash length is 3 to reduce collision risk.
 * Format: `#HL <lineNumber>:<hash>|<originalLine>`
 *
 * Example:
 *   #HL 1:a3f|function hello() {
 *   #HL 2:f1c|  return "world";
 *   #HL 3:0e7|}
 */

import { matchesGlob as pathMatchesGlob } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration object for Hashline.
 */
export interface HashlineConfig {
  /** Glob patterns to exclude from processing */
  exclude?: string[];
  /** Maximum file size in bytes to process (default: 1MB) */
  maxFileSize?: number;
  /** Override hash length (3–4). If not set, adaptive length is used. */
  hashLength?: number;
  /** LRU cache size — number of files to cache (default: 100) */
  cacheSize?: number;
  /**
   * Magic prefix for hashline annotations.
   * Default: "#HL " — lines are formatted as `#HL 1:a3f|code here`.
   * Set to `false` to disable prefix (legacy format: `1:a3f|code here`).
   */
  prefix?: string | false;
  /** Enable debug logging to ~/.config/opencode/hashline-debug.log (default: false) */
  debug?: boolean;
  /** Include file revision hash in annotations (default: true) */
  fileRev?: boolean;
}

/** Default exclude patterns */
export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  "**/node_modules/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/*.map",
];

/** Default prefix for hashline annotations */
export const DEFAULT_PREFIX = "#HL ";

/** Default configuration values */
export const DEFAULT_CONFIG: Required<HashlineConfig> = {
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  maxFileSize: 1_048_576, // 1 MB
  hashLength: 0, // 0 = adaptive
  cacheSize: 100,
  prefix: DEFAULT_PREFIX,
  debug: false,
  fileRev: true,
};

/**
 * Merge user config with defaults.
 *
 * @param config - optional partial user config
 * @param pluginConfig - optional config from plugin context (e.g. opencode.json)
 */
export function resolveConfig(
  config?: HashlineConfig,
  pluginConfig?: HashlineConfig,
): Required<HashlineConfig> {
  // Merge: pluginConfig (from opencode.json) is overridden by explicit config
  const merged: HashlineConfig = {
    ...pluginConfig,
    ...config,
  };

  if (!merged || Object.keys(merged).length === 0) {
    return { ...DEFAULT_CONFIG, exclude: [...DEFAULT_CONFIG.exclude] } as Required<HashlineConfig>;
  }

  return {
    exclude: merged.exclude ?? [...DEFAULT_CONFIG.exclude],
    maxFileSize: merged.maxFileSize ?? DEFAULT_CONFIG.maxFileSize,
    hashLength: merged.hashLength ?? DEFAULT_CONFIG.hashLength,
    cacheSize: merged.cacheSize ?? DEFAULT_CONFIG.cacheSize,
    prefix: merged.prefix !== undefined ? merged.prefix : DEFAULT_CONFIG.prefix,
    debug: merged.debug ?? DEFAULT_CONFIG.debug,
    fileRev: merged.fileRev ?? DEFAULT_CONFIG.fileRev,
  };
}

// ---------------------------------------------------------------------------
// Structured Error Diagnostics
// ---------------------------------------------------------------------------

export type HashlineErrorCode =
  | "HASH_MISMATCH"
  | "FILE_REV_MISMATCH"
  | "TARGET_OUT_OF_RANGE"
  | "INVALID_REF"
  | "INVALID_RANGE"
  | "MISSING_REPLACEMENT";

export interface CandidateLine {
  lineNumber: number; // 1-based
  content: string;
}

export class HashlineError extends Error {
  readonly code: HashlineErrorCode;
  readonly expected?: string;
  readonly actual?: string;
  readonly candidates?: CandidateLine[];
  readonly hint?: string;
  readonly lineNumber?: number;
  readonly filePath?: string;

  constructor(opts: {
    code: HashlineErrorCode;
    message: string;
    expected?: string;
    actual?: string;
    candidates?: CandidateLine[];
    hint?: string;
    lineNumber?: number;
    filePath?: string;
  }) {
    super(opts.message);
    this.name = "HashlineError";
    this.code = opts.code;
    this.expected = opts.expected;
    this.actual = opts.actual;
    this.candidates = opts.candidates;
    this.hint = opts.hint;
    this.lineNumber = opts.lineNumber;
    this.filePath = opts.filePath;
  }

  toDiagnostic(): string {
    const parts: string[] = [`[${this.code}] ${this.message}`];
    if (this.filePath) {
      parts.push(`  File: ${this.filePath}`);
    }
    if (this.lineNumber !== undefined) {
      parts.push(`  Line: ${this.lineNumber}`);
    }
    if (this.expected !== undefined && this.actual !== undefined) {
      parts.push(`  Expected hash: ${this.expected}`);
      parts.push(`  Actual hash:   ${this.actual}`);
    }
    if (this.candidates && this.candidates.length > 0) {
      parts.push(`  Candidates (${this.candidates.length}):`);
      for (const c of this.candidates) {
        const preview = c.content.length > 60 ? `${c.content.slice(0, 60)}...` : c.content;
        parts.push(`    - line ${c.lineNumber}: ${preview}`);
      }
    }
    if (this.hint) {
      parts.push(`  Hint: ${this.hint}`);
    }
    return parts.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Simple fast hash function (FNV-1a inspired).
 * Returns a 32-bit unsigned integer.
 */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0; // FNV prime, keep as uint32
  }
  return hash;
}

/** Precomputed 16^hashLen for hashLen 0–8 */
const MODULI = [1, 16, 256, 4096, 65536, 1048576, 16777216, 268435456, 4294967296];

function getModulus(hashLen: number): number {
  return MODULI[hashLen] ?? 16 ** hashLen;
}

/**
 * Determine the appropriate hash length based on the number of lines.
 *
 * Minimum hash length is 3 to reduce collision risk.
 * - ≤4096 lines → 3 hex chars (4096 values)
 * - >4096 lines → 4 hex chars (65536 values)
 */
export function getAdaptiveHashLength(lineCount: number): number {
  if (lineCount <= 4096) return 3;
  return 4;
}

/**
 * Compute a hex hash for a given line.
 *
 * Uses trimEnd() so that leading whitespace (indentation) IS significant,
 * but trailing whitespace is ignored.
 *
 * @param idx - 0-based line index
 * @param line - the raw line content
 * @param hashLen - number of hex characters (3–4, default 3)
 * @returns lowercase hex string of the specified length
 */
export function computeLineHash(idx: number, line: string, hashLen: number = 3): string {
  const trimmed = line.trimEnd();
  const input = `${idx}:${trimmed}`;
  const raw = fnv1aHash(input);
  const modulus = getModulus(hashLen);
  const hash = raw % modulus;
  return hash.toString(16).padStart(hashLen, "0");
}

/**
 * Compute a file-level revision hash from the entire content.
 * Uses FNV-1a on CRLF-normalized content, returns 8-char hex (full 32 bits).
 */
export function computeFileRev(content: string): string {
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
  const hash = fnv1aHash(normalized);
  return hash.toString(16).padStart(8, "0");
}

/**
 * Extract the file revision from annotated content.
 * Looks for a line matching `<prefix>REV:<8-hex>` at the start of the content.
 *
 * @param annotatedContent - content with hashline annotations
 * @param prefix - prefix string (default "#HL "), or false for legacy format
 * @returns the revision hash string, or null if not found
 */
export function extractFileRev(annotatedContent: string, prefix?: string | false): string | null {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedPrefix}REV:([0-9a-f]{8})$`);
  const firstLine = annotatedContent.split("\n")[0];
  const match = firstLine.match(pattern);
  return match ? match[1] : null;
}

/**
 * Verify that the file revision matches the current content.
 * Throws HashlineError with code FILE_REV_MISMATCH if it doesn't match.
 */
export function verifyFileRev(expectedRev: string, currentContent: string): void {
  const actualRev = computeFileRev(currentContent);
  if (actualRev !== expectedRev) {
    throw new HashlineError({
      code: "FILE_REV_MISMATCH",
      message: `File revision mismatch: expected "${expectedRev}", got "${actualRev}". The file has changed since it was last read.`,
      expected: expectedRev,
      actual: actualRev,
      hint: "Re-read the file to get fresh hash references and a new file revision.",
    });
  }
}

/**
 * Find candidate lines that match the expected hash for a given original line index.
 * Used for safe reapply: if a line moved, find where it went.
 *
 * Since computeLineHash uses `${idx}:${trimmed}`, we check each line in the file
 * computing its hash as if it were at the original index — a match means the content
 * is the same as what was originally at that position.
 */
export function findCandidateLines(
  originalLineNumber: number,
  expectedHash: string,
  lines: string[],
  hashLen?: number,
): CandidateLine[] {
  const effectiveLen = hashLen && hashLen >= 2 ? hashLen : expectedHash.length;
  const originalIdx = originalLineNumber - 1; // convert to 0-based
  const candidates: CandidateLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Skip the original position — that was already checked
    if (i === originalIdx) continue;
    const candidateHash = computeLineHash(originalIdx, lines[i], effectiveLen);
    if (candidateHash === expectedHash) {
      candidates.push({
        lineNumber: i + 1, // 1-based
        content: lines[i],
      });
    }
  }

  return candidates;
}

/**
 * Format file content with hashline annotations.
 *
 * Each line becomes: `<prefix><1-based lineNumber>:<hash>|<originalLine>`
 * Hash length adapts to file size unless overridden.
 * Includes collision detection: if two lines produce the same hash,
 * the colliding line gets a longer hash.
 *
 * @param content - raw file content
 * @param hashLen - override hash length (0 or undefined = adaptive)
 * @param prefix - prefix string (default "#HL "), or false to disable
 * @returns annotated content with hash prefixes
 */
export function formatFileWithHashes(
  content: string,
  hashLen?: number,
  prefix?: string | false,
  includeFileRev?: boolean,
): string {
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
  const lines = normalized.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;

  // Collision detection: compute all hashes, detect and resolve collisions by
  // increasing hash length. Repeat until every hash is unique (up to 8 chars max).
  const hashLens: number[] = new Array(lines.length).fill(effectiveLen);
  const hashes: string[] = new Array(lines.length);

  for (let idx = 0; idx < lines.length; idx++) {
    hashes[idx] = computeLineHash(idx, lines[idx], effectiveLen);
  }

  // Iteratively resolve collisions — only rescan indices that were upgraded
  let dirtyIndices: Set<number> | null = null; // null = scan all on first pass
  let hasCollisions = true;
  while (hasCollisions) {
    hasCollisions = false;
    const seen = new Map<string, number[]>(); // hash -> list of line indices

    // Always build full hash map (needed to detect collisions between dirty and clean entries)
    for (let idx = 0; idx < lines.length; idx++) {
      const h = hashes[idx];
      const group = seen.get(h);
      if (group) {
        group.push(idx);
      } else {
        seen.set(h, [idx]);
      }
    }

    const nextDirty = new Set<number>();
    for (const [, group] of seen) {
      if (group.length < 2) continue;
      // Only upgrade if at least one member is dirty (or first pass)
      if (dirtyIndices !== null && !group.some((idx) => dirtyIndices?.has(idx))) continue;
      for (const idx of group) {
        const newLen = Math.min(hashLens[idx] + 1, 8);
        if (newLen === hashLens[idx]) continue; // already at max length
        hashLens[idx] = newLen;
        hashes[idx] = computeLineHash(idx, lines[idx], newLen);
        nextDirty.add(idx);
        hasCollisions = true;
      }
    }
    dirtyIndices = nextDirty;
  }

  // Post-loop safety: if any hashes still collide at max length (extremely unlikely
  // with FNV-1a at 32 bits), disambiguate by appending line index as hex suffix.
  const finalSeen = new Map<string, number>(); // hash -> first index
  for (let idx = 0; idx < lines.length; idx++) {
    const existing = finalSeen.get(hashes[idx]);
    if (existing !== undefined) {
      // Collision at max hash length — append line index as suffix to disambiguate
      hashes[idx] = `${hashes[idx]}${idx.toString(16)}`;
    } else {
      finalSeen.set(hashes[idx], idx);
    }
  }

  const annotatedLines = lines.map((line, idx) => {
    return `${effectivePrefix}${idx + 1}:${hashes[idx]}|${line}`;
  });

  if (includeFileRev) {
    const rev = computeFileRev(content);
    annotatedLines.unshift(`${effectivePrefix}REV:${rev}`);
  }

  return annotatedLines.join("\n");
}

/**
 * Cache for compiled strip-hash regex patterns.
 * Key: escaped prefix string, Value: compiled RegExp pair
 */
const stripRegexCache = new Map<string, { hashLine: RegExp; rev: RegExp }>();

/**
 * Strip hashline prefixes to recover original file content.
 *
 * Recognizes the pattern `<prefix><number>:<2-8 hex>|` at the start of each line.
 * By default looks for the `#HL ` prefix to avoid false positives.
 *
 * @param content - hashline-annotated content
 * @param prefix - prefix string (default "#HL "), or false for legacy format
 * @returns original content without hash prefixes
 */
export function stripHashes(content: string, prefix?: string | false): string {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Use cached regex pair (hashLine + rev)
  let cached = stripRegexCache.get(escapedPrefix);
  if (!cached) {
    cached = {
      hashLine: new RegExp(`^([+ \\-])?${escapedPrefix}\\d+:[0-9a-f]{2,8}\\|`),
      rev: new RegExp(`^${escapedPrefix}REV:[0-9a-f]{8}$`),
    };
    stripRegexCache.set(escapedPrefix, cached);
  }
  const hashLinePattern = cached.hashLine;
  const revPattern = cached.rev;

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const result = normalized
    .split("\n")
    .filter((line) => !revPattern.test(line))
    .map((line) => {
      const match = line.match(hashLinePattern);
      if (match) {
        // Preserve the patch marker (+/-/space) if present
        const patchMarker = match[1] || "";
        return patchMarker + line.slice(match[0].length);
      }
      return line;
    })
    .join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

/**
 * Parse a hash reference like "2:f1a" or "2:f1a3" into its components.
 *
 * @param ref - reference string in the format "<lineNumber>:<hash>"
 * @returns parsed line number (1-based) and hash string
 */
export function parseHashRef(ref: string): { line: number; hash: string } {
  const match = ref.match(/^(\d+):([0-9a-f]{2,8})$/);
  if (!match) {
    const display = ref.length > 100 ? `${ref.slice(0, 100)}…` : ref;
    throw new HashlineError({
      code: "INVALID_REF",
      message: `Invalid hash reference: "${display}". Expected format: "<line>:<2-8 char hex>"`,
    });
  }
  return {
    line: parseInt(match[1], 10),
    hash: match[2],
  };
}

/**
 * Normalize a hash reference.
 *
 * Accepts:
 * - plain refs: `2:f1c`
 * - annotated refs: `#HL 2:f1c|line content` or `2:f1c|line content`
 *
 * Returns canonical lowercased format: `<line>:<hash>`
 */
export function normalizeHashRef(ref: string): string {
  const trimmed = ref.trim();

  const plain = trimmed.match(/^(\d+):([0-9a-f]{2,8})$/i);
  if (plain) {
    return `${parseInt(plain[1], 10)}:${plain[2].toLowerCase()}`;
  }

  const annotated = trimmed.match(/^(?:[#\w]*\s+)?(\d+):([0-9a-f]{2,8})\|.*$/i);
  if (annotated) {
    return `${parseInt(annotated[1], 10)}:${annotated[2].toLowerCase()}`;
  }

  const display = ref.length > 100 ? `${ref.slice(0, 100)}…` : ref;
  throw new HashlineError({
    code: "INVALID_REF",
    message: `Invalid hash reference: "${display}". Expected "<line>:<hash>" or an annotated line like "#HL <line>:<hash>|..."`,
  });
}

/**
 * Supported hash-aware edit operations.
 */
export type HashEditOperation = "replace" | "delete" | "insert_before" | "insert_after";

/**
 * Input for hash-aware edit application.
 */
export interface HashEditInput {
  operation: HashEditOperation;
  startRef: string;
  endRef?: string;
  replacement?: string;
  fileRev?: string;
}

/**
 * Result of applying a hash-aware edit.
 */
export interface HashEditResult {
  operation: HashEditOperation;
  startLine: number;
  endLine: number;
  content: string;
}

/**
 * Build a mapping from hash tags to 1-based line numbers.
 *
 * Note: If multiple lines produce the same hash, the last one wins.
 * In practice, collisions are rare since the hash incorporates the line index.
 *
 * @param content - raw file content (without hash prefixes)
 * @param hashLen - override hash length (0 or undefined = adaptive)
 * @returns Map from "<lineNumber>:<hash>" to 1-based line number
 */
export function buildHashMap(content: string, hashLen?: number): Map<string, number> {
  const lines = content.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const map = new Map<string, number>();
  for (let idx = 0; idx < lines.length; idx++) {
    const hash = computeLineHash(idx, lines[idx], effectiveLen);
    const lineNum = idx + 1;
    map.set(`${lineNum}:${hash}`, lineNum);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Hash verification
// ---------------------------------------------------------------------------

/**
 * Result of hash verification.
 */
export interface VerifyHashResult {
  valid: boolean;
  expected?: string;
  actual?: string;
  message?: string;
  code?: HashlineErrorCode;
  candidates?: CandidateLine[];
}

/**
 * Verify that a line's hash matches the current content.
 *
 * This protects against race conditions — if the file changed between
 * read and edit, the hash won't match.
 *
 * The hash length is determined from the provided hash string itself
 * (hash.length), not from the current file size. This ensures that
 * a reference like "2:f1a" remains valid even if the file has grown.
 *
 * @param lineNumber - 1-based line number
 * @param hash - expected hash from the hash reference
 * @param currentContent - current raw file content (string or pre-split lines)
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @param lines - optional pre-split lines array to avoid re-splitting
 * @returns verification result
 */
export function verifyHash(
  lineNumber: number,
  hash: string,
  currentContent: string,
  hashLen?: number,
  lines?: string[],
): VerifyHashResult {
  const contentLines = lines ?? currentContent.split("\n");
  const effectiveLen = hashLen && hashLen >= 2 ? hashLen : hash.length;

  if (lineNumber < 1 || lineNumber > contentLines.length) {
    return {
      valid: false,
      code: "TARGET_OUT_OF_RANGE",
      message: `Line ${lineNumber} is out of range (file has ${contentLines.length} lines)`,
    };
  }

  const idx = lineNumber - 1;
  const actualHash = computeLineHash(idx, contentLines[idx], effectiveLen);

  if (actualHash !== hash) {
    const candidates = findCandidateLines(lineNumber, hash, contentLines, effectiveLen);
    return {
      valid: false,
      code: "HASH_MISMATCH",
      expected: hash,
      actual: actualHash,
      candidates,
      message: `Hash mismatch at line ${lineNumber}: expected "${hash}", got "${actualHash}". The file may have changed since it was read.`,
    };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Range operations
// ---------------------------------------------------------------------------

/**
 * Result of a range resolution.
 */
export interface ResolvedRange {
  startLine: number;
  endLine: number;
  lines: string[];
  content: string;
}

/**
 * Resolve a range of lines by hash references.
 * Splits content once and passes lines array to verifyHash to avoid redundant splits.
 *
 * @param startRef - start hash reference (e.g. "1:a3f")
 * @param endRef - end hash reference (e.g. "3:0e7")
 * @param content - raw file content
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @returns resolved range with line numbers and content
 */
export function resolveRange(
  startRef: string,
  endRef: string,
  content: string,
  hashLen?: number,
): ResolvedRange {
  const start = parseHashRef(startRef);
  const end = parseHashRef(endRef);

  if (start.line > end.line) {
    throw new HashlineError({
      code: "INVALID_RANGE",
      message: `Invalid range: start line ${start.line} is after end line ${end.line}`,
    });
  }

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const lines = normalized.split("\n");

  const startVerify = verifyHash(start.line, start.hash, normalized, hashLen, lines);
  if (!startVerify.valid) {
    throw new HashlineError({
      code: startVerify.code ?? "HASH_MISMATCH",
      message: `Start reference invalid: ${startVerify.message}`,
      expected: startVerify.expected,
      actual: startVerify.actual,
      candidates: startVerify.candidates,
      lineNumber: start.line,
      hint:
        startVerify.candidates && startVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${startVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const endVerify = verifyHash(end.line, end.hash, normalized, hashLen, lines);
  if (!endVerify.valid) {
    throw new HashlineError({
      code: endVerify.code ?? "HASH_MISMATCH",
      message: `End reference invalid: ${endVerify.message}`,
      expected: endVerify.expected,
      actual: endVerify.actual,
      candidates: endVerify.candidates,
      lineNumber: end.line,
      hint:
        endVerify.candidates && endVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${endVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const rangeLines = lines.slice(start.line - 1, end.line);
  return {
    startLine: start.line,
    endLine: end.line,
    lines: rangeLines,
    content: rangeLines.join(lineEnding),
  };
}

/**
 * Replace a range of lines identified by hash references with new content.
 * Splits content once and reuses the lines array.
 *
 * @param startRef - start hash reference
 * @param endRef - end hash reference
 * @param content - current raw file content
 * @param replacement - new content to replace the range with
 * @param hashLen - override hash length (0 or undefined = use hash.length from ref)
 * @returns new file content with the range replaced
 */
export function replaceRange(
  startRef: string,
  endRef: string,
  content: string,
  replacement: string,
  hashLen?: number,
): string {
  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const range = resolveRange(startRef, endRef, normalized, hashLen);
  const lines = normalized.split("\n");
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const replacementLines = replacement.split("\n");
  const result = [...before, ...replacementLines, ...after].join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

/**
 * Apply a hash-aware edit operation directly against file content.
 *
 * Unlike search/replace tools, this resolves references by line+hash and
 * verifies them before editing, so exact old-string matching is not required.
 */
export function applyHashEdit(
  input: HashEditInput,
  content: string,
  hashLen?: number,
): HashEditResult {
  const lineEnding = detectLineEnding(content);
  const workContent = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;

  if (input.fileRev) {
    verifyFileRev(input.fileRev, workContent);
  }

  const normalizedStart = normalizeHashRef(input.startRef);
  const start = parseHashRef(normalizedStart);
  const lines = workContent.split("\n");

  const startVerify = verifyHash(start.line, start.hash, workContent, hashLen, lines);
  if (!startVerify.valid) {
    throw new HashlineError({
      code: startVerify.code ?? "HASH_MISMATCH",
      message: `Start reference invalid: ${startVerify.message}`,
      expected: startVerify.expected,
      actual: startVerify.actual,
      candidates: startVerify.candidates,
      lineNumber: start.line,
      hint:
        startVerify.candidates && startVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${startVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  if (input.operation === "insert_before" || input.operation === "insert_after") {
    if (input.replacement === undefined) {
      throw new HashlineError({
        code: "MISSING_REPLACEMENT",
        message: `Operation "${input.operation}" requires "replacement" content`,
      });
    }

    const insertionLines = input.replacement.split("\n");
    const insertIndex = input.operation === "insert_before" ? start.line - 1 : start.line;
    const next = [
      ...lines.slice(0, insertIndex),
      ...insertionLines,
      ...lines.slice(insertIndex),
    ].join("\n");

    return {
      operation: input.operation,
      startLine: start.line,
      endLine: start.line,
      content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
    };
  }

  const normalizedEnd = normalizeHashRef(input.endRef ?? input.startRef);
  const end = parseHashRef(normalizedEnd);
  if (start.line > end.line) {
    throw new HashlineError({
      code: "INVALID_RANGE",
      message: `Invalid range: start line ${start.line} is after end line ${end.line}`,
    });
  }

  const endVerify = verifyHash(end.line, end.hash, workContent, hashLen, lines);
  if (!endVerify.valid) {
    throw new HashlineError({
      code: endVerify.code ?? "HASH_MISMATCH",
      message: `End reference invalid: ${endVerify.message}`,
      expected: endVerify.expected,
      actual: endVerify.actual,
      candidates: endVerify.candidates,
      lineNumber: end.line,
      hint:
        endVerify.candidates && endVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${endVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const replacement = input.operation === "delete" ? "" : input.replacement;
  if (replacement === undefined) {
    throw new HashlineError({
      code: "MISSING_REPLACEMENT",
      message: `Operation "${input.operation}" requires "replacement" content`,
    });
  }

  const before = lines.slice(0, start.line - 1);
  const after = lines.slice(end.line);
  const replacementLines = input.operation === "delete" ? [] : replacement.split("\n");
  const next = [...before, ...replacementLines, ...after].join("\n");

  return {
    operation: input.operation,
    startLine: start.line,
    endLine: end.line,
    content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
  };
}

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  contentHash: number;
  annotated: string;
}

/**
 * Simple LRU cache for annotated file content.
 */
export class HashlineCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get cached annotated content for a file, or null if not cached / stale.
   */
  get(filePath: string, content: string): string | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    const currentHash = fnv1aHash(content);
    if (entry.contentHash !== currentHash) {
      this.cache.delete(filePath);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    return entry.annotated;
  }

  /**
   * Store annotated content in the cache.
   */
  set(filePath: string, content: string, annotated: string): void {
    // If already exists, delete first to update position
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(filePath, {
      contentHash: fnv1aHash(content),
      annotated,
    });
  }

  /**
   * Invalidate a specific file from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// Glob matching (using Node stdlib path.matchesGlob)
// ---------------------------------------------------------------------------

/**
 * Glob matcher using path.matchesGlob (Node 22+).
 * Windows paths are normalized to forward slashes.
 */
export function matchesGlob(filePath: string, pattern: string): boolean {
  // Normalize Windows backslashes — path.matchesGlob uses the OS-native separator
  return pathMatchesGlob(filePath.replace(/\\/g, "/"), pattern.replace(/\\/g, "/"));
}

/**
 * Check if a file path should be excluded based on config patterns.
 */
export function shouldExclude(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

// ---------------------------------------------------------------------------
// Byte length utility
// ---------------------------------------------------------------------------

/**
 * Get the UTF-8 byte length of a string.
 * Uses TextEncoder for accurate UTF-8 byte counting.
 * This correctly handles multi-byte characters (Cyrillic, CJK, emoji, etc.).
 */
export function getByteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

/**
 * Detect the line ending style used in a string.
 * Returns "\r\n" if any CRLF sequence is present, otherwise "\n".
 */
export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
