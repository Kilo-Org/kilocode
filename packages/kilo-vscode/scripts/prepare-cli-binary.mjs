import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

/**
 * Ensures the VS Code extension has a CLI binary at `packages/kilo-vscode/bin/kilo`.
 *
 * Strategy:
 * 1) If `bin/kilo` already exists -> ok.
 * 2) Else try to locate a prebuilt binary produced by `packages/opencode` build.
 * 3) Else try to build it via `bun run build --single` in `packages/opencode`.
 * 4) Copy the resulting binary into `packages/kilo-vscode/bin/kilo` and chmod +x.
 *
 * This script is intended to be run from `packages/kilo-vscode` as part of build/package.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const kiloVscodeDir = path.resolve(__dirname, "..");
const repoRootDir = path.resolve(kiloVscodeDir, "..");
const opencodeDir = path.resolve(repoRootDir, "opencode");

const targetBinDir = path.resolve(kiloVscodeDir, "bin");
const targetBinPath = path.resolve(targetBinDir, "kilo");

function log(msg) {
  // Keep logs machine-grep friendly in CI
  console.log(`[prepare-cli-binary] ${msg}`);
}

function findKiloBinaryInOpencodeDist() {
  const distDir = path.resolve(opencodeDir, "dist");
  if (!existsSync(distDir)) return null;

  // Expected: packages/opencode/dist/@kilocode/cli-<platform>/bin/kilo
  // But keep it flexible: find any dist/**/bin/kilo
  /** @type {string[]} */
  const queue = [distDir];
  while (queue.length) {
    const dir = queue.pop();
    if (!dir) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        queue.push(p);
        continue;
      }
      if (e.isFile() && e.name === "kilo" && path.basename(path.dirname(p)) === "bin") {
        return p;
      }
    }
  }
  return null;
}

function ensureBuiltBinary() {
  const found = findKiloBinaryInOpencodeDist();
  if (found) return found;

  log(`No prebuilt binary found under ${path.relative(kiloVscodeDir, path.resolve(opencodeDir, "dist"))} - attempting build via bun.`);

  try {
    execSync("bun --version", { stdio: "ignore" });
  } catch {
    throw new Error(
      `Bun is required to build the CLI binary, but was not found on PATH. ` +
        `Install bun, or build the CLI separately in ${opencodeDir} and re-run.`
    );
  }

  // Build using the opencode package script.
  execSync("bun run build --single", {
    cwd: opencodeDir,
    stdio: "inherit",
    env: process.env,
  });

  const built = findKiloBinaryInOpencodeDist();
  if (!built) {
    throw new Error(
      `CLI build completed but no binary was found in ${path.resolve(opencodeDir, "dist")} (expected dist/**/bin/kilo).`
    );
  }
  return built;
}

function main() {
  if (existsSync(targetBinPath)) {
    const st = statSync(targetBinPath);
    log(`CLI binary already present at ${path.relative(kiloVscodeDir, targetBinPath)} (${Math.round(st.size / 1024 / 1024)}MB).`);
    return;
  }

  if (!existsSync(opencodeDir)) {
    throw new Error(`Expected opencode package at ${opencodeDir}, but it does not exist.`);
  }

  const sourceBinPath = ensureBuiltBinary();
  mkdirSync(targetBinDir, { recursive: true });
  copyFileSync(sourceBinPath, targetBinPath);
  chmodSync(targetBinPath, 0o755);

  log(`Copied CLI binary from ${path.relative(repoRootDir, sourceBinPath)} -> ${path.relative(kiloVscodeDir, targetBinPath)}`);
}

try {
  main();
} catch (err) {
  console.error(`[prepare-cli-binary] ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

