import type { Ecosystem, Effect, OpaqueReason } from "./effects.js";
import { canonicalize, type PathContext } from "./paths.js";
import { normalizePackageName } from "./packages.js";

/**
 * Нормализатор: shell-команда → типизированные эффекты.
 *
 * Позиция безопасности — FAIL CLOSED. Если разобрать команду однозначно
 * нельзя, возвращается effect `opaque`, который движок инвариантов трактует
 * как минимум `ask`. Мы никогда не выдаём `allow` из-за того, что не поняли
 * команду: непонятое — не безопасное.
 *
 * Это осознанно НЕ полноценный парсер bash. Полный парсер (tree-sitter-bash)
 * — кандидат на замену этого модуля; интерфейс от этого не меняется.
 */

/**
 * Разделители команд.
 *
 * ОСОЗНАННОЕ РАСХОЖДЕНИЕ С ОБОЛОЧКОЙ: перевод строки считается разделителем
 * даже внутри кавычек, хотя настоящий bash трактовал бы его как обычный символ
 * в имени файла. Расхождение направлено в безопасную сторону — мы видим
 * БОЛЬШЕ команд, чем оболочка, а не меньше, поэтому спрятать действие за
 * переводом строки нельзя: куски становятся `unknown_binary`, то есть
 * `opaque` и минимум `ask`.
 *
 * Цена: имя файла с переводом строки обрезается по первому переносу, и правило
 * по пути может не сработать — вердикт остаётся `ask`, но причина показывается
 * менее точная. Зафиксировано тестом в test/robustness.test.ts.
 */
const OPERATORS = /(\|\||&&|[;|&\n])/;

/** Конструкции, содержимое которых неизвестно до выполнения. */
const OBFUSCATION_PATTERNS: Array<[RegExp, OpaqueReason]> = [
  [/\$\(|`/, "command_substitution"],
  [/\b(eval|source)\b/, "eval_like"],
  [/\b(sh|bash|zsh)\s+-c\b/, "eval_like"],
  [/\bbase64\b[^|]*\|\s*(sh|bash|zsh|python\d?)\b/, "encoded_payload"],
  [/\|\s*(sh|bash|zsh)\b/, "encoded_payload"], // curl ... | sh
  [/\bxxd\s+-r\b/, "encoded_payload"],
];

const READ_BINARIES = new Set(["cat", "less", "more", "head", "tail", "grep", "rg", "strings", "od", "xxd"]);
const WRITE_BINARIES = new Set(["touch", "tee", "install"]);
const DELETE_BINARIES = new Set(["rm", "unlink", "shred"]);
const NET_BINARIES = new Set(["curl", "wget", "nc", "ncat", "ssh", "scp", "rsync", "ftp"]);

/**
 * Раннеры пакетов: `npx`, `bunx`, `pnpm dlx` и родня.
 *
 * Ключевое свойство: если бинаря нет локально, раннер СКАЧАЕТ пакет и тут же
 * его выполнит. То есть `npx <имя>` — это потенциальная установка с
 * исполнением, и слепой `allow` здесь был бы дырой (slopsquatting через npx —
 * известный вектор).
 *
 * Раньше раннеры попадали в «неизвестный бинарь» → `opaque` → `ask`, и
 * повседневный `npx tsc --noEmit` дёргал человека. Теперь мы выдаём
 * `pkg_install` и передаём решение package gate: зрелый популярный пакет он
 * пропускает молча, выдуманный или свежий — останавливает.
 *
 * Проверять node_modules/.bin мы СОЗНАТЕЛЬНО не идём: обращение к ФС сделало
 * бы вердикт зависимым от состояния машины и сломало свойство
 * «одинаковое действие — одинаковый вердикт».
 */
const RUNNERS: Record<string, Ecosystem> = {
  npx: "npm",
  pnpx: "npm",
  bunx: "npm",
  "npm exec": "npm",
  "pnpm dlx": "npm",
  "yarn dlx": "npm",
  "bun x": "npm",
  uvx: "pypi",
  pipx: "pypi",
};

/** Флаги раннеров, после которых идёт ПАКЕТ, а не бинарь. */
const RUNNER_PACKAGE_FLAGS = new Set(["-p", "--package"]);
/** Флаги, превращающие раннер в исполнение произвольной строки оболочки. */
const RUNNER_EVAL_FLAGS = new Set(["-c", "--call", "--shell"]);

/**
 * PowerShell-командлеты.
 *
 * На Windows Kilo Code выполняет команды через терминал VS Code, а он по
 * умолчанию PowerShell — то есть агент выдаёт `Get-Content`, а не `cat`.
 * Без этой таблицы каждая команда становится `opaque` → `ask`: формально
 * безопасно, но Friction взлетает, и разработчик начинает подтверждать
 * всё подряд. Именно та approval fatigue, от которой мы защищаем.
 */
const PS_READ = new Set(["get-content", "gc", "type", "select-string", "sls", "get-item"]);
const PS_WRITE = new Set(["set-content", "add-content", "out-file", "new-item", "ni", "sc", "ac"]);
const PS_DELETE = new Set(["remove-item", "ri", "del", "erase", "rd", "rmdir"]);
const PS_COPY = new Set(["copy-item", "cpi"]);
const PS_MOVE = new Set(["move-item", "mi"]);
const PS_NET = new Set(["invoke-webrequest", "iwr", "invoke-restmethod", "irm", "start-bitstransfer"]);
/** `iex (New-Object Net.WebClient).DownloadString(...)` — классика PowerShell-атак. */
const PS_EVAL = new Set(["invoke-expression", "iex"]);

/** Безопасные по построению команды: не трогают ФС на запись и не ходят в сеть. */
const INERT_BINARIES = new Set([
  "echo", "pwd", "ls", "date", "whoami", "which", "env", "printenv",
  "wc", "sort", "uniq", "diff", "basename", "dirname", "true", "false",
]);

export interface NormalizeInput {
  command: string;
  ctx: PathContext;
}

export function normalizeCommand(input: NormalizeInput): Effect[] {
  const { command, ctx } = input;

  for (const [rx, reason] of OBFUSCATION_PATTERNS) {
    if (rx.test(command)) return [{ kind: "opaque", reason }];
  }

  const segments = command.split(OPERATORS).filter((s) => s.trim() && !OPERATORS.test(s.trim()));
  const effects: Effect[] = [];
  for (const seg of segments) {
    effects.push(...normalizeSimple(seg, ctx));
  }
  return effects.length ? effects : [{ kind: "opaque", reason: "unparseable" }];
}

function normalizeSimple(segment: string, ctx: PathContext): Effect[] {
  const argv = tokenize(segment);
  if (!argv.length) return [{ kind: "opaque", reason: "unparseable" }];

  const effects: Effect[] = [];

  // Редиректы `> file` / `>> file` — это запись, независимо от бинаря.
  const redirects = [...segment.matchAll(/>>?\s*([^\s;|&]+)/g)];
  for (const m of redirects) {
    effects.push({ kind: "fs_write", path: canonicalize(m[1], ctx) });
  }

  const bin = basename(argv[0]);
  const args = argv.slice(1).filter((a) => !a.startsWith("-"));
  const flags = argv.slice(1).filter((a) => a.startsWith("-"));

  const ps = powershellEffects(bin, argv, args, flags, segment, ctx);
  if (ps) return effects.concat(ps);

  const runner = matchRunner(bin, argv);
  if (runner) return effects.concat(runnerEffects(runner));

  if (bin === "npm" || bin === "yarn" || bin === "pnpm") {
    return effects.concat(packageEffects(argv, "npm"));
  }
  if (bin === "pip" || bin === "pip3" || bin === "uv") {
    return effects.concat(packageEffects(argv, "pypi"));
  }
  if (bin === "cargo") return effects.concat(packageEffects(argv, "cargo"));
  if (bin === "gem") return effects.concat(packageEffects(argv, "gem"));

  if (READ_BINARIES.has(bin)) {
    for (const a of args) effects.push({ kind: "fs_read", path: canonicalize(a, ctx) });
    return effects.length ? effects : [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (WRITE_BINARIES.has(bin)) {
    for (const a of args) effects.push({ kind: "fs_write", path: canonicalize(a, ctx) });
    return effects;
  }

  if (DELETE_BINARIES.has(bin)) {
    const recursive = flags.some((f) => /^-[a-zA-Z]*r/.test(f) || f === "--recursive");
    for (const a of args) effects.push({ kind: "fs_delete", path: canonicalize(a, ctx), recursive });
    return effects.length ? effects : [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (bin === "cp" || bin === "mv") {
    if (args.length >= 2) {
      for (const a of args.slice(0, -1)) effects.push({ kind: "fs_read", path: canonicalize(a, ctx) });
      effects.push({ kind: "fs_write", path: canonicalize(args[args.length - 1], ctx) });
      if (bin === "mv") {
        for (const a of args.slice(0, -1))
          effects.push({ kind: "fs_delete", path: canonicalize(a, ctx), recursive: false });
      }
      return effects;
    }
    return [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (NET_BINARIES.has(bin)) {
    const hosts = args.map(extractHost).filter((h): h is string => !!h);
    if (!hosts.length) return effects.concat([{ kind: "opaque", reason: "dynamic_target" }]);
    for (const h of hosts) effects.push({ kind: "net_egress", host: h });
    // `curl -d @.env` и `curl -T file` читают локальный файл и отправляют его.
    for (const m of segment.matchAll(/(?:-d|--data|-T|--upload-file|-F)\s+@?([^\s;|&]+)/g)) {
      const v = m[1];
      if (!/^https?:/.test(v)) effects.push({ kind: "fs_read", path: canonicalize(v, ctx) });
    }
    return effects;
  }

  if (bin === "git") {
    const sub = argv[1];
    if (sub === "push" || sub === "clone" || sub === "fetch" || sub === "pull") {
      const host = args.map(extractHost).find((h): h is string => !!h);
      if (host) effects.push({ kind: "net_egress", host });
      else effects.push({ kind: "opaque", reason: "dynamic_target" });
    }
    if (sub === "config") effects.push({ kind: "fs_write", path: canonicalize(".git/config", ctx) });
    return effects.length ? effects : [{ kind: "proc_exec", binary: "git" }];
  }

  if (INERT_BINARIES.has(bin)) {
    return effects.length ? effects : [{ kind: "proc_exec", binary: bin }];
  }

  // Неизвестный бинарь — не угадываем. Fail closed.
  return effects.concat([{ kind: "opaque", reason: "unknown_binary" }]);
}

interface RunnerMatch {
  binary: string;
  ecosystem: Ecosystem;
  rest: string[];
}

/** Узнаёт раннер в одно- и двусловной форме (`npx`, `pnpm dlx`). */
function matchRunner(bin: string, argv: string[]): RunnerMatch | null {
  const two = `${bin} ${argv[1] ?? ""}`.trim();
  const twoEco = RUNNERS[two];
  if (twoEco) return { binary: bin, ecosystem: twoEco, rest: argv.slice(2) };
  const oneEco = RUNNERS[bin];
  if (oneEco) return { binary: bin, ecosystem: oneEco, rest: argv.slice(1) };
  return null;
}

function runnerEffects(r: RunnerMatch): Effect[] {
  // `npx -c "..."` исполняет произвольную строку оболочки — содержимое
  // неизвестно до выполнения, разбирать нечего.
  if (r.rest.some((a) => RUNNER_EVAL_FLAGS.has(a))) {
    return [{ kind: "opaque", reason: "eval_like" }];
  }

  const out: Effect[] = [{ kind: "proc_exec", binary: r.binary }];

  // `-p <пакет>` называет пакет явно; иначе пакетом считается первый
  // неопционный токен — именно его раннер и скачает при отсутствии.
  let target: string | undefined;
  for (let i = 0; i < r.rest.length; i++) {
    const a = r.rest[i];
    if (RUNNER_PACKAGE_FLAGS.has(a)) {
      target = r.rest[i + 1];
      break;
    }
    if (!a.startsWith("-") && target === undefined) target = a;
  }

  if (!target) return out.concat([{ kind: "opaque", reason: "dynamic_target" }]);
  out.push({ kind: "pkg_install", ecosystem: r.ecosystem, name: normalizePackageName(target) });
  return out;
}

function packageEffects(argv: string[], ecosystem: Ecosystem): Effect[] {
  const installVerbs = new Set(["install", "i", "add", "ci"]);
  const idx = argv.findIndex((a) => installVerbs.has(a));
  if (idx === -1) return [{ kind: "proc_exec", binary: argv[0] }];

  const names = argv.slice(idx + 1).filter((a) => !a.startsWith("-"));
  if (!names.length) {
    // `npm install` без аргументов — ставит по lock-файлу; цель динамическая.
    return [{ kind: "opaque", reason: "dynamic_target" }];
  }
  return names.map((n) => ({
    kind: "pkg_install" as const,
    ecosystem,
    // Раньше здесь была регулярка, которая на `@types/node` возвращала пустую
    // строку (первый `@` съедал всё имя). Каноникализация вынесена в packages.ts.
    name: normalizePackageName(n),
  }));
}

/** Простой токенайзер с уважением к кавычкам. */
function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    if (c === ">" || c === "<") { // редиректы разбираются отдельно
      if (cur) { out.push(cur); cur = ""; }
      while (i < s.length && !/\s/.test(s[i])) i++;
      while (i < s.length && /\s/.test(s[i])) i++;
      while (i < s.length && !/\s/.test(s[i])) i++;
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

function extractHost(arg: string): string | null {
  const m = arg.match(/^(?:https?|ftp|ssh|git):\/\/(?:[^@/]*@)?([^/:\s]+)/);
  if (m) return m[1].toLowerCase();
  const scp = arg.match(/^(?:[^@\s]+@)?([a-z0-9.-]+\.[a-z]{2,}):/i);
  if (scp) return scp[1].toLowerCase();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(arg)) return arg.toLowerCase();
  return null;
}

/**
 * Разбор PowerShell-командлета. Возвращает null, если команда не PowerShell —
 * тогда работают обычные bash-ветки.
 *
 * Именованные параметры (`-Path X`, `-InFile Y`) разбираются отдельно, потому
 * что позиционная эвристика «всё без дефиса — аргумент» на них не работает.
 */
function powershellEffects(
  bin: string,
  argv: string[],
  args: string[],
  flags: string[],
  segment: string,
  ctx: PathContext,
): Effect[] | null {
  const cmd = bin.toLowerCase();

  if (PS_EVAL.has(cmd)) return [{ kind: "opaque", reason: "eval_like" }];
  if (flags.some((f) => /^-e(nc|ncoded)/i.test(f))) return [{ kind: "opaque", reason: "encoded_payload" }];

  /** Значения именованных параметров, указывающих на файл. */
  const named = (names: string[]): string[] => {
    const out: string[] = [];
    for (const n of names) {
      const rx = new RegExp(`-${n}\\s+([^\\s;|&]+)`, "ig");
      for (const m of segment.matchAll(rx)) out.push(m[1]);
    }
    return out;
  };

  const paths = (extra: string[] = []) =>
    [...args, ...named(["Path", "LiteralPath", "FilePath"]), ...extra].map((a) => canonicalize(a, ctx));

  if (PS_READ.has(cmd)) {
    const p = paths();
    return p.length ? p.map((path) => ({ kind: "fs_read", path })) : [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (PS_WRITE.has(cmd)) {
    const p = paths();
    return p.length ? p.map((path) => ({ kind: "fs_write", path })) : [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (PS_DELETE.has(cmd)) {
    const recursive = flags.some((f) => /^-r(ecurse)?$/i.test(f));
    const p = paths();
    return p.length
      ? p.map((path) => ({ kind: "fs_delete", path, recursive }))
      : [{ kind: "opaque", reason: "dynamic_target" }];
  }

  if (PS_COPY.has(cmd) || PS_MOVE.has(cmd)) {
    const dest = named(["Destination"]).map((a) => canonicalize(a, ctx));
    const positional = args.map((a) => canonicalize(a, ctx));
    const sources = dest.length ? positional : positional.slice(0, -1);
    const targets = dest.length ? dest : positional.slice(-1);
    if (!sources.length || !targets.length) return [{ kind: "opaque", reason: "dynamic_target" }];

    const out: Effect[] = [
      ...sources.map((path) => ({ kind: "fs_read" as const, path })),
      ...targets.map((path) => ({ kind: "fs_write" as const, path })),
    ];
    if (PS_MOVE.has(cmd)) {
      out.push(...sources.map((path) => ({ kind: "fs_delete" as const, path, recursive: false })));
    }
    return out;
  }

  if (PS_NET.has(cmd)) {
    const out: Effect[] = [];
    const urls = [...args, ...named(["Uri", "Url"])];
    const hosts = urls.map(extractHost).filter((h): h is string => !!h);
    if (!hosts.length) return [{ kind: "opaque", reason: "dynamic_target" }];
    for (const host of hosts) out.push({ kind: "net_egress", host });
    // -InFile отправляет локальный файл наружу; -OutFile пишет ответ на диск.
    for (const f of named(["InFile", "Body"])) out.push({ kind: "fs_read", path: canonicalize(f, ctx) });
    for (const f of named(["OutFile"])) out.push({ kind: "fs_write", path: canonicalize(f, ctx) });
    return out;
  }

  return null;
}
