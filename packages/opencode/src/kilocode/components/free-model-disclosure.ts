export const FreeModelDisclosure = {
  label: "May train",
  panel: "Free - data may be used for training",
  collectsData(model: { isFree?: boolean; api?: { npm?: string } }): boolean {
    return model.isFree === true && model.api?.npm === "@kilocode/kilo-gateway"
  },
} as const
