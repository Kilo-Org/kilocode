import { Schema } from "effect"

export namespace KiloTitleIcon {
  export const Value = Schema.Literals(["none", "unicode", "emojis"]).annotate({
    description: "Status icon style shown in terminal titles",
  })
  export type Value = Schema.Schema.Type<typeof Value>
  export const Default = "none" satisfies Value
}
