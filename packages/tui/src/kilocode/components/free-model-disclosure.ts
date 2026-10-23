// Picker and info panel labels from Kilo Gateway metadata, as in v1. Only explicit metadata counts: a model
// without `mayTrainOnYourPrompts` or `hasUserByokAvailable` gets no label.
export const FreeModelDisclosure = {
  label: "May train",
  panel: "Data may be used for training",
  byok: "BYOK",
  collectsData(model: { mayTrainOnYourPrompts?: boolean } | undefined): boolean {
    return model?.mayTrainOnYourPrompts === true
  },
  hasByok(model: { hasUserByokAvailable?: boolean } | undefined): boolean {
    return model?.hasUserByokAvailable === true
  },
} as const
