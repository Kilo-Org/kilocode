import type { Effect, EffectSource } from "./effects.js";
import { describeEffect } from "./effects.js";
import { DEFAULT_POLICY, type Policy } from "./policy.js";
import { isInside, matchesPattern, type PathContext } from "./paths.js";

/**
 * Движок инвариантов — сердце «архитектурно неуязвимого к prompt injection»
 * контроля.
 *
 * Почему инъекция сюда не доходит: вход функции — массив Effect, то есть
 * структурированные данные (вид операции, канонизированный путь, хост, имя
 * пакета). Ни одна строка на этом уровне не интерпретируется как инструкция:
 * нет LLM, нет шаблонов, нет исполнения. Текст, пришедший от атакующего,
 * может стать *значением* поля path — но не может изменить *правило*.
 *
 * Единственный способ ослабить проверку — изменить Policy, а она грузится
 * только из доверенного источника вне workspace (см. policy.ts).
 */

export type Decision = "allow" | "ask" | "block";

export type RuleId =
  | "CREDENTIAL_READ"
  | "PROTECTED_WRITE"
  | "WRITE_OUTSIDE_WORKSPACE"
  | "VCS_CONFIG_WRITE"
  | "AUTOEXEC_ARTIFACT_WRITE"
  | "EGRESS_NOT_ALLOWED"
  | "DELETE_OUTSIDE_WORKSPACE"
  | "RECURSIVE_DELETE"
  | "PACKAGE_GATE_REQUIRED"
  | "OPAQUE_ACTION";

export interface Reason {
  rule: RuleId;
  decision: Decision;
  /** Машиночитаемое описание эффекта — санитизируется перед выдачей агенту. */
  effect: string;
}

export interface Verdict {
  decision: Decision;
  reasons: Reason[];
}

export interface EvaluateInput {
  effects: Effect[];
  ctx: PathContext;
  policy?: Policy;
  source?: EffectSource;
}

const SEVERITY: Record<Decision, number> = { allow: 0, ask: 1, block: 2 };

export function evaluate(input: EvaluateInput): Verdict {
  const policy = input.policy ?? DEFAULT_POLICY;
  const { ctx } = input;
  const reasons: Reason[] = [];

  for (const e of input.effects) {
    const desc = describeEffect(e);
    const add = (rule: RuleId, decision: Decision) => reasons.push({ rule, decision, effect: desc });

    switch (e.kind) {
      case "fs_read": {
        if (policy.protectedRead.some((p) => matchesPattern(e.path, p, ctx))) {
          add("CREDENTIAL_READ", "block");
        }
        break;
      }

      case "fs_write": {
        if (policy.askWrite.some((p) => matchesPattern(e.path, p, ctx))) {
          add("VCS_CONFIG_WRITE", "ask");
        } else if (policy.protectedWrite.some((p) => matchesPattern(e.path, p, ctx))) {
          add("PROTECTED_WRITE", "block");
        } else if (!isInside(e.path, ctx.workspace)) {
          add("WRITE_OUTSIDE_WORKSPACE", "block");
        }
        // Класс «отложенного исполнения»: артефакт, который позже запустит
        // доверенный инструмент вне песочницы. Даже внутри workspace — не auto.
        if (policy.autoExecArtifacts.some((p) => matchesPattern(e.path, p, ctx))) {
          add("AUTOEXEC_ARTIFACT_WRITE", "ask");
        }
        break;
      }

      case "fs_delete": {
        if (!isInside(e.path, ctx.workspace)) add("DELETE_OUTSIDE_WORKSPACE", "block");
        else if (
          e.recursive &&
          policy.askOnRecursiveDelete &&
          !policy.ephemeralDirs.some((p) => matchesPattern(e.path, p, ctx))
        ) {
          add("RECURSIVE_DELETE", "ask");
        }
        break;
      }

      case "net_egress": {
        if (!policy.egressAllowlist.some((h) => hostMatches(e.host, h))) {
          add("EGRESS_NOT_ALLOWED", "block");
        }
        break;
      }

      case "pkg_install": {
        // Сам факт установки не блокируется — решение принимает package gate,
        // который дальше по конвейеру проверяет пакет до его скачивания.
        add("PACKAGE_GATE_REQUIRED", "ask");
        break;
      }

      case "opaque": {
        // Непонятое никогда не становится allow.
        add("OPAQUE_ACTION", "ask");
        break;
      }

      case "proc_exec":
        break;
    }
  }

  return { decision: worst(reasons), reasons };
}

/**
 * Итоговый вердикт — самый строгий из сработавших.
 * Вынесено наружу, чтобы package gate мог пересобрать вердикт после того,
 * как заменит свой предварительный `ask` на реальное решение по пакету.
 */
export function worst(reasons: Reason[]): Decision {
  return reasons.reduce<Decision>(
    (acc, r) => (SEVERITY[r.decision] > SEVERITY[acc] ? r.decision : acc),
    "allow",
  );
}

function hostMatches(host: string, allowed: string): boolean {
  const h = host.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}
