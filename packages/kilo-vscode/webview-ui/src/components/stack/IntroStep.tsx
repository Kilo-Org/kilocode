import { Button } from "@kilocode/kilo-ui/button"
import { Card, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { useLanguage } from "../../context/language"
import { useStack } from "../../context/stack"

export function IntroStep() {
  const stack = useStack()
  const language = useLanguage()

  return (
    <section class="stack-step" aria-labelledby="stack-intro-title">
      <div class="stack-step-heading">
        <span class="stack-kicker">{language.t("stack.intro.kicker")}</span>
        <h2 id="stack-intro-title" tabIndex={-1}>
          {language.t("stack.intro.title")}
        </h2>
        <p>{language.t("stack.intro.description")}</p>
      </div>
      <div class="stack-vertical-grid">
        <Button class="stack-vertical-card" disabled={!stack.editable()} onClick={() => stack.detect()}>
          <Card>
            <CardTitle icon="status">{language.t("stack.intro.autoDetect")}</CardTitle>
            <CardDescription>{language.t("stack.intro.autoDetectDescription")}</CardDescription>
          </Card>
        </Button>
        <Button class="stack-vertical-card" disabled={!stack.editable()} onClick={() => stack.goManual()}>
          <Card>
            <CardTitle icon="status">{language.t("stack.intro.manual")}</CardTitle>
            <CardDescription>{language.t("stack.intro.manualDescription")}</CardDescription>
          </Card>
        </Button>
      </div>
    </section>
  )
}
