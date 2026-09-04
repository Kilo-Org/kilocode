/**
 * Единая модель эффектов.
 *
 * Ключевое архитектурное решение: и *декларированные* эффекты (что агент
 * собирается сделать, до выполнения), и *наблюдаемые* эффекты (что реально
 * произошло в staged-среде) описываются ОДНИМ типом. Благодаря этому один и
 * тот же движок инвариантов судит оба входа — pre-check и post-check.
 *
 * В этот модуль намеренно не попадает ни одной строки, которую кто-либо
 * интерпретирует как инструкцию. Эффект — это данные: вид операции, путь,
 * хост, имя пакета. Никакого natural language.
 */

export type Ecosystem = "npm" | "pypi" | "cargo" | "gem" | "go" | "unknown";

/** Почему нормализатор не смог однозначно разобрать действие. */
export type OpaqueReason =
  | "unparseable"          // не разобрали синтаксис
  | "unknown_binary"       // неизвестная команда
  | "command_substitution" // $(...) / `...` — содержимое неизвестно до выполнения
  | "eval_like"            // eval / sh -c / exec с динамической строкой
  | "encoded_payload"      // base64 -d | sh и подобное
  | "dynamic_target";      // цель операции вычисляется в рантайме

export type Effect =
  | { kind: "fs_read"; path: string }
  | { kind: "fs_write"; path: string }
  | { kind: "fs_delete"; path: string; recursive: boolean }
  | { kind: "net_egress"; host: string }
  | { kind: "pkg_install"; ecosystem: Ecosystem; name: string }
  | { kind: "proc_exec"; binary: string }
  | { kind: "opaque"; reason: OpaqueReason };

export type EffectKind = Effect["kind"];

/** Откуда пришёл набор эффектов — влияет на трактовку, но не на инварианты. */
export type EffectSource = "declared" | "observed";

export interface EffectSet {
  source: EffectSource;
  effects: Effect[];
}

/** Короткое машиночитаемое описание эффекта для аудита и Recovery. */
export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case "fs_read":
      return `fs_read:${e.path}`;
    case "fs_write":
      return `fs_write:${e.path}`;
    case "fs_delete":
      return `fs_delete${e.recursive ? "(-r)" : ""}:${e.path}`;
    case "net_egress":
      return `net_egress:${e.host}`;
    case "pkg_install":
      return `pkg_install:${e.ecosystem}/${e.name}`;
    case "proc_exec":
      return `proc_exec:${e.binary}`;
    case "opaque":
      return `opaque:${e.reason}`;
  }
}
