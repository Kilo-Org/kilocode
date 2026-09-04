import type { Ecosystem } from "./effects.js";
import type { Decision } from "./invariants.js";
import type { PackageEvidence, RegistryClient } from "./registry.js";
import { POPULAR } from "./popular.js";

/**
 * Package gate — проверка пакета ДО скачивания, внутри агента.
 *
 * Требование кейса: защищать не только от известного вредоноса, но и от
 * угроз нулевого дня. Значит блоклист не годится — нужны признаки, которые
 * работают для пакета, которого никто раньше не видел.
 *
 * Опорная идея против slopsquatting: модель выдумывает имя, которого нет.
 * Дальше возможны два исхода, и оба ловятся без знания о конкретной атаке:
 *   1) имени в реестре нет  → это галлюцинация, ставить нечего;
 *   2) имя есть, но пакету несколько дней → его зарегистрировали ПОСЛЕ того,
 *      как модель начала его выдумывать. Модель физически не могла знать
 *      свежий пакет — а значит рекомендация взялась не из знания, и это
 *      главный сигнал подставы.
 */

export type PackageSignal =
  | "NOT_IN_REGISTRY"
  | "NEWBORN_PACKAGE"
  | "TYPOSQUAT_SUSPECT"
  | "LOW_ADOPTION"
  | "INSTALL_SCRIPTS"
  | "REGISTRY_UNAVAILABLE";

export interface PackageGateResult {
  decision: Decision;
  signals: PackageSignal[];
  /** Ближайшее популярное имя — только из локального списка, не из сети. */
  nearest: string | null;
}

export interface GateThresholds {
  /** Пакет моложе этого возраста считается новорождённым. */
  newbornDays: number;
  /** Ниже этого недельного порога — низкое усвоение сообществом. */
  lowDownloads: number;
  /** Максимальная правочная дистанция, при которой имя считается опечаткой. */
  typoDistance: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  newbornDays: 90,
  lowDownloads: 1000,
  typoDistance: 2,
};

export async function checkPackage(
  ecosystem: Ecosystem,
  rawName: string,
  registry: RegistryClient,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): Promise<PackageGateResult> {
  const name = normalizePackageName(rawName);
  const signals: PackageSignal[] = [];

  const popular = POPULAR[ecosystem] ?? new Set<string>();
  const isPopularItself = popular.has(name);

  const evidence = await registry.lookup(ecosystem, name);

  // Реестр недоступен — данных нет. Это `ask`, а не `allow`:
  // отсутствие информации не является свидетельством безопасности.
  if (evidence === null) {
    return { decision: isPopularItself ? "allow" : "ask", signals: ["REGISTRY_UNAVAILABLE"], nearest: null };
  }

  if (!evidence.exists) {
    // Галлюцинация: агенту нечего ставить, повтор той же команды бессмыслен.
    return { decision: "block", signals: ["NOT_IN_REGISTRY"], nearest: nearestPopular(name, popular, thresholds) };
  }

  const lowAdoption =
    evidence.weeklyDownloads !== null && evidence.weeklyDownloads < thresholds.lowDownloads;
  const newborn = evidence.ageDays !== null && evidence.ageDays < thresholds.newbornDays;

  if (newborn) signals.push("NEWBORN_PACKAGE");
  if (lowAdoption) signals.push("LOW_ADOPTION");
  if (evidence.hasInstallScripts) signals.push("INSTALL_SCRIPTS");

  // Typosquatting: имя почти совпадает с популярным, но само популярным не
  // является. Проверка популярности самого пакета обязательна — иначе
  // legitimate `preact` (расстояние 1 до `react`) улетал бы в блок.
  const nearest = isPopularItself ? null : nearestPopular(name, popular, thresholds);
  const typoSuspect = nearest !== null && (lowAdoption || newborn || evidence.weeklyDownloads === null);
  if (typoSuspect) signals.push("TYPOSQUAT_SUSPECT");

  let decision: Decision = "allow";
  if (typoSuspect) decision = "block";
  else if (newborn) decision = "ask";
  else if (lowAdoption || evidence.hasInstallScripts) decision = "ask";

  return { decision, signals, nearest };
}

/**
 * Приведение имени к каноническому виду.
 * Убираем спецификатор версии, сохраняя scope у npm (`@types/node`).
 */
export function normalizePackageName(raw: string): string {
  let s = raw.trim();
  const scoped = s.startsWith("@");
  const body = scoped ? s.slice(1) : s;
  // версия в npm отделяется последним '@', в pypi — первым из =<>!~
  const at = body.lastIndexOf("@");
  const trimmed = at > 0 ? body.slice(0, at) : body;
  const noVersion = trimmed.split(/[=<>!~[\s]/)[0];
  return (scoped ? "@" + noVersion : noVersion).toLowerCase();
}

function nearestPopular(name: string, popular: Set<string>, t: GateThresholds): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of popular) {
    // Быстрый отсев: имена, отличающиеся по длине сильнее порога, не проверяем.
    if (Math.abs(candidate.length - name.length) > t.typoDistance) continue;
    const d = damerauLevenshtein(name, candidate, t.typoDistance);
    if (d > 0 && d <= t.typoDistance && d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

/**
 * Дистанция Дамерау—Левенштейна с ранним выходом.
 * Транспозиция учитывается отдельно от вставки/удаления, потому что типичная
 * опечатка — перестановка соседних букв: `reqeusts` ← `requests`.
 */
export function damerauLevenshtein(a: string, b: string, max = Infinity): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > max) return max + 1;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let cur: number[] = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // ранний выход: дальше только хуже
    prev2 = prev;
    prev = cur;
    cur = new Array(n + 1);
  }
  return prev[n];
}
