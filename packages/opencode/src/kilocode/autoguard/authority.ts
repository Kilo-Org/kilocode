import { canonical, covers, inside, resource } from "./resources"
import type { Authority, ContractMessage, Grant, ResourceCatalog, TaskContract, TrustedContext } from "./types"

export function catalog(ctx: TrustedContext): ResourceCatalog {
  return ctx.catalog ?? { source: [], verification: [], generated_output: ctx.generated_paths }
}

export function namedPaths(text: string, ctx: TrustedContext): string[] {
  const known = Object.values(catalog(ctx)).flat()
  return [
    ...new Set(
      text
        .split(/[\s,;`"'()]+/)
        .map((value) => value.replace(/[.!?]+$/, ""))
        .filter((value) => value && (value.includes("/") || /\.[a-z0-9]{1,8}$/i.test(value) || known.includes(value))),
    ),
  ]
}

const verbs =
  /^(?:(?:please|пожалуйста)\s+)?(?:(do\s+not|don['’]t|never|не|нельзя)\s+)?(fix|edit|modify|change|update|refactor|implement|repair|delete|remove|clean|cleanup|clear|purge|run|execute|test|исправь(?:те)?|измени(?:те)?|редактируй(?:те)?|удали(?:те)?|удаляй(?:те)?|очисти(?:те)?|очищай(?:те)?|запусти(?:те)?|запускай(?:те)?|меняй(?:те)?|модифицируй(?:те)?)\b/iu
// JS word boundaries do not recognize Cyrillic letters.
const russian =
  /^(?:пожалуйста\s+)?(?:(не|нельзя)\s+)?(исправь(?:те)?|измени(?:те)?|редактируй(?:те)?|удали(?:те)?|удаляй(?:те)?|очисти(?:те)?|очищай(?:те)?|запусти(?:те)?|запускай(?:те)?|меняй(?:те)?|модифицируй(?:те)?)(?=\s|$)/iu

export function grammar(
  message: ContractMessage,
  ctx: TrustedContext,
): { grants: Grant[]; prohibitions: Grant[]; ambiguous: boolean } {
  const grants: Grant[] = []
  const prohibitions: Grant[] = []
  const roles = catalog(ctx)
  const clauses = message.text.split(
    /(?:[.!?](?=\s|$)|[;\n])|\b(?:and|but)\s+(?=(?:do not|don't|never|fix|edit|delete|remove|run|clean)\b)|\s+(?:и|но)\s+(?=(?:не|исправь|удали|запусти|очисти)\s)/iu,
  )
  let ambiguous = false
  for (const source of clauses) {
    const clause = source.trim()
    if (!clause) continue
    const preserve =
      clause.match(/^(?:keep|leave)\s+(.+?)\s+(?:unchanged|intact|untouched)$/iu) ??
      clause.match(/^(?:оставь|сохрани)\s+(.+?)\s+без изменений$/iu)
    if (preserve) {
      const paths = namedPaths(preserve[1], ctx)
      if (!paths.length) ambiguous = true
      for (const target of paths)
        for (const operation of ["code.modify", "filesystem.delete"])
          prohibitions.push({
            operation,
            resource: resource(target, ctx),
            source: message.id,
            evidence: clause,
            confirmed: "grammar",
          })
      continue
    }
    const match = clause.match(verbs) ?? clause.match(russian)
    if (!match) {
      if (/\b(not|never|avoid|without|except|unless)\b|(?:^|\s)(не|нельзя|кроме|без)(?:\s|$)/iu.test(clause))
        ambiguous = true
      continue
    }
    const negative = !!match[1]
    const verb = match[2].toLowerCase()
    const operation = /^(delete|remove|clean|cleanup|clear|purge|удал|очист|очищ)/u.test(verb)
      ? "filesystem.delete"
      : /^(run|execute|test|запуст|запуска)/u.test(verb)
        ? "test.run"
        : "code.modify"
    const object = clause
      .slice(match[0].length)
      .split(
        /\b(?:so that|so|because|using|based on|according to|after|before|from|for|with|without|but|except|unless|and)\b|(?:чтобы|используя|после|согласно|кроме|но|для)\s/iu,
      )[0]
    if (/\b(except|unless|only if|not)\b|(?:^|\s)(кроме|не|только если)(?:\s|$)/iu.test(object)) {
      ambiguous = true
      continue
    }
    const paths = namedPaths(object, ctx)
    if (
      operation === "filesystem.delete" &&
      /generated output|build artifacts|сгенерированн|артефакт.{0,12}сборк/iu.test(object)
    ) {
      if (roles.generated_output.length !== 1) {
        ambiguous = true
        continue
      }
      paths.push(roles.generated_output[0])
    }
    if (operation === "test.run") {
      if (!/tests?|pytest|unittest|тест/iu.test(object + " " + verb)) {
        ambiguous = true
        continue
      }
      if (!paths.length) paths.push(...(roles.verification.length ? roles.verification : [ctx.workspace_root]))
    }
    if (negative && !paths.length) ambiguous = true
    for (const target of [...new Set(paths)]) {
      try {
        const item = resource(target, ctx, target.endsWith("/") ? "directory" : undefined)
        if (!inside(canonical(ctx.workspace_root, ctx.cwd), item.key)) {
          ambiguous = true
          continue
        }
        const grant: Grant = { operation, resource: item, source: message.id, evidence: clause, confirmed: "grammar" }
        if (negative) {
          prohibitions.push(grant)
          continue
        }
        if (
          operation === "filesystem.delete" &&
          !roles.generated_output.some((x) => inside(canonical(x, ctx.cwd), item.key))
        ) {
          ambiguous = true
          continue
        }
        grants.push(grant)
      } catch {
        ambiguous = true
      }
    }
  }
  // The verification role is implied by this supported task form, never write access to tests.
  if (
    grants.some((g) => g.operation === "code.modify" || g.operation === "filesystem.delete") &&
    /tests?.{0,80}fail|тест.{0,80}пада|so.{0,30}(?:they|tests?) pass|чтобы.{0,30}тест/isu.test(message.text)
  ) {
    const paths = roles.verification.length ? roles.verification : [ctx.workspace_root]
    for (const target of paths)
      grants.push({
        operation: "test.run",
        resource: resource(target, ctx, "directory"),
        source: message.id,
        evidence: message.text,
        confirmed: "grammar",
      })
  }
  return {
    grants: ambiguous
      ? []
      : grants.filter(
          (g) => !prohibitions.some((p) => p.operation === g.operation && covers(p.resource, g.resource.key)),
        ),
    prohibitions,
    ambiguous,
  }
}

export function authority(contract: Pick<TaskContract, "grants" | "prohibitions" | "active">): Authority {
  const grants = contract.active
    ? contract.grants.filter(
        (g) =>
          !contract.prohibitions.some(
            (p) => (p.operation === g.operation || p.operation === "*") && covers(p.resource, g.resource.key),
          ),
      )
    : []
  return {
    issuer: "user",
    scope: grants.map((g) => g.resource.key),
    capabilities: [...new Set(grants.map((g) => g.operation))],
    expires: "task",
    required: grants.map((g) => `${g.operation}:${g.resource.key}`),
    implicit: [],
    sensitive: [],
    forbidden: contract.prohibitions.map((g) => `${g.operation}:${g.resource.key}`),
  }
}
export function deriveAuthority(text: string, ctx: TrustedContext): Authority {
  const parsed = grammar({ id: "offline", text }, ctx)
  return authority({ ...parsed, active: true })
}
