export const FreeModelDisclosure = {
  label: "Data collected",
  panel: "Free - data collected",
  collectsData(model: { isFree?: boolean; api?: { npm?: string } }): boolean {
    return model.isFree === true && model.api?.npm === "@kilocode/kilo-gateway"
  },
} as const
