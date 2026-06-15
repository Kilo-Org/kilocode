export const FreeModelDisclosure = {
  label: "May train",
  panel: "Data may be used for training",
  collectsData(model: { mayTrainOnYourPrompts?: boolean }): boolean {
    return model.mayTrainOnYourPrompts === true
  },
} as const
