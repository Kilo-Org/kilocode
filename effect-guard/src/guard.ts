import type { Effect } from "./effects.js";
import { describeEffect } from "./effects.js";
import { normalizeCommand } from "./normalize.js";
import { evaluate, worst, type Verdict, type RuleId, type Reason } from "./invariants.js";
import type { Policy } from "./policy.js";
import type { PathContext } from "./paths.js";
import { checkPackage, type GateThresholds } from "./packages.js";
import type { RegistryClient } from "./registry.js";

/**
 * Публичный вход: команда агента → вердикт + сообщение для Recovery.
 */

export interface GuardInput {
  command: string;
  ctx: PathContext;
  policy?: Policy;
  /**
   * Эффекты, которые агент ЗАДЕКЛАРИРОВАЛ (module D). Опционально: без
   * декларации работает только pre-check по инвариантам.
   */
  declared?: Effect[];
}

export interface GuardResult extends Verdict {
  effects: Effect[];
  /** Эффекты, наблюдаемые сверх декларации (только если declared передан). */
  undeclared: string[];
  recovery: RecoveryMessage;
}

/**
 * Сообщение агенту после блокировки.
 *
 * Правило: наружу уходят только коды правил и санитизированные значения.
 * Сырой текст из репозитория/веба/вывода инструмента сюда не попадает —
 * иначе блокировка сама становится каналом повторной инъекции
 * (агент прочитает «инструкцию» атакующего в объяснении отказа).
 */
export interface RecoveryMessage {
  blocked: boolean;
  rules: RuleId[];
  details: string[];
  retry_allowed: boolean;
  hint_code: string;
}

const MAX_DETAIL_LEN = 120;

export function guard(input: GuardInput): GuardResult {
  const effects = normalizeCommand({ command: input.command, ctx: input.ctx });
  const verdict = evaluate({ effects, ctx: input.ctx, policy: input.policy, source: "declared" });

  const undeclared = input.declared ? diffAgainstDeclaration(effects, input.declared) : [];

  return {
    ...verdict,
    effects,
    undeclared,
    recovery: buildRecovery(verdict),
  };
}

function buildRecovery(v: Verdict): RecoveryMessage {
  const blocking = v.reasons.filter((r) => r.decision !== "allow");
  return {
    blocked: v.decision === "block",
    rules: [...new Set(blocking.map((r) => r.rule))],
    details: blocking.map((r) => sanitize(r.effect)),
    // После блока повторять ту же команду бессмысленно — нужен другой план.
    retry_allowed: v.decision === "ask",
    hint_code: v.decision === "block" ? "REPLAN_WITHOUT_BLOCKED_EFFECT" : "AWAIT_HUMAN_DECISION",
  };
}

/**
 * Санитизация значения перед возвратом в контекст агента:
 * убираем перевод строки и управляющие символы (ими маскируют инъекцию),
 * режем длину.
 */
export function sanitize(s: string): string {
  const flat = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL_LEN ? `${flat.slice(0, MAX_DETAIL_LEN)}…` : flat;
}

/** Эффекты, которых нет в декларации агента. */
function diffAgainstDeclaration(actual: Effect[], declared: Effect[]): string[] {
  const key = (e: Effect) => JSON.stringify(e);
  const declaredKeys = new Set(declared.map(key));
  return actual.filter((e) => !declaredKeys.has(key(e))).map((e) => sanitize(key(e)));
}


/**
 * guard() + package gate одной операцией.
 *
 * Зачем: сам по себе `guard()` про гейт ничего не знает и выдаёт
 * `PACKAGE_GATE_REQUIRED → ask` на ЛЮБУЮ установку, включая `npm install
 * express`. Если оставить так, разработчик получает вопрос на каждой рутинной
 * установке — то самое трение, против которого построен проект (цель
 * продуктовых материалов: вопросы человеку не чаще 10% действий).
 *
 * Здесь предварительный `ask` заменяется на РЕАЛЬНОЕ решение гейта: зрелый
 * популярный пакет проходит молча, выдуманный/свежий/похожий на популярный —
 * останавливается.
 *
 * Слой инвариантов при этом не ослабляется: гейт умеет только ужесточать или
 * снимать СВОЙ собственный предварительный `ask`; чужие правила он не трогает.
 * Отдельно: наружу из гейта идут только имена сигналов (наш enum) и ближайшее
 * имя из ЛОКАЛЬНОГО списка популярных — текст из сети сюда не попадает.
 */
export async function guardWithPackageGate(
  input: GuardInput,
  registry: RegistryClient,
  thresholds?: GateThresholds,
): Promise<GuardResult> {
  const base = guard(input);

  const installs = base.effects.filter(
    (e): e is Extract<Effect, { kind: "pkg_install" }> => e.kind === "pkg_install",
  );
  if (!installs.length) return base;

  // Снимаем предварительный ask и заменяем его вердиктом гейта по каждому пакету.
  const reasons: Reason[] = base.reasons.filter((r) => r.rule !== "PACKAGE_GATE_REQUIRED");

  for (const e of installs) {
    const g = await checkPackage(e.ecosystem, e.name, registry, thresholds);
    if (g.decision === "allow") continue;
    const signals = g.signals.join(",");
    reasons.push({
      rule: "PACKAGE_GATE_REQUIRED",
      decision: g.decision,
      effect: `${describeEffect(e)} [${signals}]${g.nearest ? ` nearest=${g.nearest}` : ""}`,
    });
  }

  const verdict: Verdict = { decision: worst(reasons), reasons };
  return { ...base, ...verdict, recovery: buildRecovery(verdict) };
}
