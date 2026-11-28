export namespace ConfigModelCapabilities {
  export type Modality = "text" | "audio" | "image" | "video" | "pdf"

  const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

  export type Capabilities = {
    attachment: boolean
    input: Record<Modality, boolean>
    output: Record<Modality, boolean>
  }

  type ModelInput = {
    attachment?: boolean | null
    modalities?: {
      input?: readonly Modality[]
      output?: readonly Modality[]
    } | null
  }

  // The config schema exposes two independent capability switches - the
  // `attachment` boolean and the `modalities.input/output` arrays - while the
  // runtime model only carries one derived capabilities object. Bridging them
  // here keeps attachment-only configs working (image guard, mobile/console
  // attachment guard) instead of letting each flag silently disagree (#15790).
  //
  // Implicit derivation keys off the image modality only, so on every
  // non-explicit path `attachment` stays equal to `input.image`: a guard
  // reading either flag then makes the same call. pdf/audio/video remain
  // opt-in through explicit modalities. The gate is an actual
  // modalities.input array, not the mere presence of a modalities object: an
  // output-only modalities entry must neither block the attachment image
  // backfill nor overwrite the capabilities the catalog already derived.
  export function resolve(
    model: ModelInput,
    existing?: { capabilities: Capabilities },
  ): Capabilities {
    const inputModalities = model.modalities?.input
    const outputModalities = model.modalities?.output
    const hasInputModalities = Array.isArray(inputModalities)

    const attachment =
      // Explicit true/false always wins; compare with === so an explicit
      // false is never flipped back to true by the fallbacks below.
      model.attachment === true || model.attachment === false
        ? model.attachment
        : hasInputModalities
          ? // Image-only derivation keeps attachment and input.image in lockstep.
            inputModalities.includes("image")
          : (existing?.capabilities.attachment ?? false)

    const input = Object.fromEntries(
      MODALITIES.map((m) => {
        // Local const keeps the Array.isArray narrowing stable inside this closure.
        const inputs = inputModalities
        const value = Array.isArray(inputs)
          ? // An explicit array (including an empty one) is the source of truth.
            inputs.includes(m)
          : model.attachment === true && m === "image"
            ? // The attachment switch backfills vision only when no explicit input
              // array is present; output-only modalities never block the backfill,
              // and pdf/audio/video stay opt-in through explicit modalities.
              true
            : (existing?.capabilities.input[m] ?? (m === "text" ? true : false))
        return [m, value]
      }),
    ) as Record<Modality, boolean>

    const output = Object.fromEntries(
      MODALITIES.map((m) => {
        const value = Array.isArray(outputModalities)
          ? outputModalities.includes(m)
          : (existing?.capabilities.output[m] ?? (m === "text" ? true : false))
        return [m, value]
      }),
    ) as Record<Modality, boolean>

    return { attachment, input, output }
  }
}
