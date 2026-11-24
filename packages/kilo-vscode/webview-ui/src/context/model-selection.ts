import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import type { ToastOptions } from "@kilocode/kilo-ui/toast"
import { KILO_PROVIDER_ID } from "../../../src/shared/provider-model"
import type { ModelSelection, Provider } from "../types/messages"
import { isModelValid } from "./provider-utils"

export function resolveModelSelection(input: {
  providers: Record<string, Provider>
  connected: string[]
  ready?: boolean
  organizationId?: string | null
  defaults?: Record<string, string>
  session?: ModelSelection | null
  mode?: ModelSelection | null
  global?: ModelSelection | null
  recent?: ModelSelection[]
  fallback?: ModelSelection | null
}): ModelSelection | null {
  const pending = input.ready === false || (input.ready !== undefined && input.organizationId === undefined)
  const validate = (selection: ModelSelection | null | undefined) => {
    if (!selection || (pending && selection.providerID === "kilo")) return null
    return isModelValid(input.providers, input.connected, selection) ? selection : null
  }
  const preference = validate(input.session) ?? validate(input.mode) ?? validate(input.global)
  if (preference) return preference
  if (pending) return null
  if (input.organizationId) {
    const recommendation = input.defaults?.kilo
    const selection = recommendation ? validate({ providerID: "kilo", modelID: recommendation }) : null
    if (selection) return selection
    const first = Object.keys(input.providers.kilo?.models ?? {}).at(0)
    return first ? validate({ providerID: "kilo", modelID: first }) : null
  }
  for (const selection of input.recent ?? []) {
    const model = validate(selection)
    if (model) return model
  }
  return validate(input.fallback)
}

export function unavailableModelToast(
  selection: ModelSelection | null,
  providers: Record<string, Provider>,
  unavailable: boolean,
  t: (key: string, params?: UiI18nParams) => string,
): ToastOptions {
  if (selection && selection.providerID !== KILO_PROVIDER_ID) {
    const provider = providers[selection.providerID]
    return {
      variant: "error",
      description: t("dialog.model.selectedUnavailable", {
        model: provider?.models[selection.modelID]?.name ?? selection.modelID,
        provider: provider?.name ?? selection.providerID,
      }),
    }
  }
  // Say why the picker is empty when an organization's Kilo catalog failed to load.
  return {
    variant: "error",
    title: unavailable ? t("dialog.model.unavailable") : t("dialog.model.select.title"),
    description: unavailable ? t("session.activity.retry") : undefined,
  }
}
