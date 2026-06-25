import { For, Show, createMemo } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { Tag } from "@kilocode/kilo-ui/tag"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"

export function DetectedStep() {
  const stack = useStack()
  const language = useLanguage()

  const names = createMemo(() => {
    const map = new Map<string, string>()
    for (const vertical of stack.data()?.catalog.catalog.verticals ?? []) {
      for (const technology of vertical.technologies) map.set(technology.id, technology.name)
    }
    return map
  })

  const groups = createMemo(() => {
    const byVertical = new Map<string, { technology: string; evidence: string }[]>()
    for (const detection of stack.detections()) {
      const list = byVertical.get(detection.vertical) ?? []
      list.push({ technology: detection.technology, evidence: detection.evidence })
      byVertical.set(detection.vertical, list)
    }
    const verticalName = new Map(
      (stack.data()?.catalog.catalog.verticals ?? []).map((vertical) => [vertical.id, vertical.name]),
    )
    return [...byVertical.entries()].map(([vertical, items]) => ({
      vertical,
      name: verticalName.get(vertical) ?? vertical,
      items: [...items].sort((a, b) => a.technology.localeCompare(b.technology)),
    }))
  })

  const selected = () => new Set(stack.selected())
  const count = () => stack.detections().filter((detection) => selected().has(detection.technology)).length

  return (
    <section class="stack-step" aria-labelledby="stack-detected-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.detected.kicker")}</span>
        <h2 id="stack-detected-title" tabIndex={-1}>
          {language.t("stack.detected.title")}
        </h2>
        <p>{language.t("stack.detected.description")}</p>
      </div>
      <div class="stack-filter-row">
        <Tag>{language.t("stack.detected.selected", { count: count() })}</Tag>
      </div>
      <Show
        when={stack.detections().length > 0}
        fallback={<Card class="stack-inline-empty">{language.t("stack.detected.empty")}</Card>}
      >
        <For each={groups()}>
          {(group) => (
            <div class="stack-detected-vertical">
              <h3 class="stack-subcategory-title">{group.name}</h3>
              <div class="stack-technology-grid" role="group" aria-label={group.name}>
                <For each={group.items}>
                  {(item) => (
                    <Card
                      class="stack-technology-card"
                      data-active={selected().has(item.technology) || undefined}
                    >
                      <Checkbox
                        checked={selected().has(item.technology)}
                        onChange={(checked) => stack.toggleDetection(group.vertical, item.technology, checked)}
                        description={item.evidence}
                        disabled={!stack.editable()}
                      >
                        {names().get(item.technology) ?? item.technology}
                      </Checkbox>
                    </Card>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  )
}
