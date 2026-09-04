import * as path from "node:path";
import * as os from "node:os";

/**
 * Канонизация пути ДО сопоставления с правилами.
 *
 * Без неё любое правило обходится тривиально: `foo/../../../.ssh/id_rsa`
 * не начинается с `~/.ssh`, но указывает именно туда.
 *
 * ОГРАНИЧЕНИЕ (осознанное): симлинки здесь не резолвятся — на этапе
 * декларации целевого файла может ещё не существовать, а обращение к ФС
 * по пути из недоверенной команды само по себе является side effect.
 * Симлинк-эскейп ловится на этапе наблюдения эффектов в staged-среде
 * (module D), где путь уже существует. Это записано в limitations.
 */
export interface PathContext {
  workspace: string;
  home: string;
  cwd: string;
}

export function defaultContext(workspace: string): PathContext {
  const ws = toPosix(path.resolve(workspace));
  return { workspace: ws, home: toPosix(os.homedir()), cwd: ws };
}

/** Убирает кавычки, экранирование и служебные символы вокруг пути. */
function stripQuoting(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\(.)/g, "$1");
}

/**
 * Приводит путь к posix-разделителям.
 *
 * КРИТИЧНО для Windows: path.normalize там возвращает `C:\\Users\\dev\\.ssh`,
 * а все паттерны политики написаны через `/`. Без этой нормализации правила
 * молча перестают срабатывать — то есть `cat ~/.ssh/id_rsa` под Windows
 * прошёл бы как разрешённый. Внутри guard путь всегда posix-образный.
 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export function canonicalize(raw: string, ctx: PathContext): string {
  let s = stripQuoting(raw);

  // Windows-разделители приводим к posix, чтобы правила были одни на все ОС.
  s = s.replace(/\\/g, "/");

  if (s === "~") s = ctx.home;
  else if (s.startsWith("~/")) s = path.join(ctx.home, s.slice(2));

  const abs = path.isAbsolute(s) ? s : path.join(ctx.cwd, s);
  return toPosix(path.normalize(abs));
}

/** true, если path лежит внутри dir (или равен ему). */
export function isInside(p: string, dir: string): boolean {
  const rel = toPosix(path.relative(path.resolve(dir), path.resolve(p)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Сопоставление с glob-подобным паттерном правила.
 * Поддерживаем только то, что реально нужно политике: `**`, `*` и `~`.
 * Никаких regex из конфигурации — это была бы поверхность для ReDoS.
 */
export function matchesPattern(p: string, pattern: string, ctx: PathContext): boolean {
  const expanded = toPosix(pattern.startsWith("~/") ? path.join(ctx.home, pattern.slice(2)) : pattern);
  const rx = globToRegExp(expanded);
  return rx.test(toPosix(p));
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // `**/` покрывает и пустой префикс
      } else {
        out += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}
