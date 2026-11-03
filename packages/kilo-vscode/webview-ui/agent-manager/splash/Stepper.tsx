import { For, type Accessor } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../src/context/language"
import { wrap } from "./carousel-logic"
import { examples } from "./examples"

/** Thin-layout feature walkthrough: one feature at a time, paired with its badge in the preview. */
export function Stepper(props: {
  selected: Accessor<number>
  step: Accessor<number>
  onStep: (index: number) => void
}) {
  const { t } = useLanguage()
  const features = () => examples.at(props.selected())!.features
  const feature = () => features().at(props.step())!
  const target = (delta: number) => wrap(props.step(), delta, features().length)
  const name = (index: number) =>
    t("agentManager.splash.marker", { number: index + 1, name: t(features().at(index)!.name) })
  return (
    <div class="am-splash-stepper" data-tone={examples.at(props.selected())!.id}>
      <span class="am-splash-feature-marker" aria-hidden="true">
        {props.step() + 1}
      </span>
      {/* Every feature's copy shares one grid cell, so the height never changes. */}
      <div class="am-splash-stepper-text">
        <For each={examples.flatMap((example) => example.features)}>
          {(item) => (
            <span class="am-splash-stepper-size">
              <strong>{t(item.name)}</strong>
              <span>{t(item.text)}</span>
            </span>
          )}
        </For>
        <p aria-live="polite">
          <strong>{t(feature().name)}</strong>
          <span>{t(feature().text)}</span>
        </p>
      </div>
      <div class="am-splash-stepper-nav">
        <span>
          {props.step() + 1}/{features().length}
        </span>
        <IconButton
          icon="chevron-left"
          variant="ghost"
          size="small"
          label={name(target(-1))}
          onClick={() => props.onStep(target(-1))}
        />
        <IconButton
          icon="chevron-right"
          variant="ghost"
          size="small"
          label={name(target(1))}
          onClick={() => props.onStep(target(1))}
        />
      </div>
    </div>
  )
}
