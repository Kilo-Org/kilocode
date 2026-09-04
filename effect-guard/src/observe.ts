import { execFileSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import type { Effect } from "./effects.js";
import { toPosix, type PathContext } from "./paths.js";

/**
 * Наблюдение фактических эффектов в staged-среде (module D).
 *
 * Ключевая идея варианта 1b: после выполнения действия в снимке мы смотрим не
 * на текст команды, а на то, что РЕАЛЬНО изменилось. Результат — тот же тип
 * Effect, что у декларации, поэтому его судит тот же движок инвариантов.
 * Обфускация текста команды здесь не помогает: эффект виден в диффе.
 *
 * Реализация снимка (решения, найденные спайком 03.09):
 *
 *  1. Работаем через ВРЕМЕННЫЙ индекс (GIT_INDEX_FILE). `git stash create`
 *     мутирует состояние репозитория пользователя и падает на intent-to-add
 *     записях. Security-проверка не имеет права ломать staging area
 *     разработчика — это блокер для PR.
 *
 *  2. `git add -A` по умолчанию уважает .gitignore, а значит НЕ увидит
 *     подброшенный `.venv/bin/python` или `.env` — ровно те классы
 *     артефактов, ради которых всё строится. Поэтому `--force`.
 *
 *  3. `node_modules` и `.git` исключаются pathspec-ом: иначе снимок стоит
 *     секунды. Осознанный размен latency/покрытие — вынесен в limitations
 *     и замеряется бенчмарком.
 */

const EXCLUDES = [":(exclude)node_modules", ":(exclude).git"];

export interface SnapshotHandle {
  workspace: string;
  /** SHA дерева на момент снимка. */
  tree: string;
}

function git(cwd: string, args: string[], indexFile?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: indexFile ? { ...process.env, GIT_INDEX_FILE: indexFile } : process.env,
  });
}

/** Пишет дерево текущего состояния рабочей директории, не трогая индекс пользователя. */
function writeTree(workspace: string): string {
  const tmpIndex = path.join(
    os.tmpdir(),
    `eg-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    git(workspace, ["add", "-A", "--force", "--", ".", ...EXCLUDES], tmpIndex);
    return git(workspace, ["write-tree"], tmpIndex).trim();
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

export function snapshot(workspace: string): SnapshotHandle {
  return { workspace, tree: writeTree(workspace) };
}

/**
 * Файловые эффекты между снимком и текущим состоянием.
 * Статусы git: A/M/R → fs_write, D → fs_delete.
 */
export function observeFileEffects(snap: SnapshotHandle, _ctx: PathContext): Effect[] {
  const after = writeTree(snap.workspace);
  const out = git(snap.workspace, ["diff-tree", "-r", "--name-status", snap.tree, after]);
  const effects: Effect[] = [];

  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];
    const rel = parts[parts.length - 1];
    if (!rel) continue;
    const abs = toPosix(path.resolve(snap.workspace, rel));

    if (status.startsWith("D")) effects.push({ kind: "fs_delete", path: abs, recursive: false });
    else effects.push({ kind: "fs_write", path: abs });
  }
  return effects;
}

/**
 * Сетевые эффекты берутся из лога egress-прокси staged-среды.
 * Формат строки: `<timestamp>\t<host>`.
 */
export function observeEgress(logLines: string[]): Effect[] {
  const hosts = new Set<string>();
  for (const line of logLines) {
    const host = line.split("\t").pop()?.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return [...hosts].map((host) => ({ kind: "net_egress" as const, host }));
}
