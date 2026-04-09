import { describe, expect, it } from "bun:test"
import {
  buildCustomModeList,
  isNativeModeModified,
  buildMergedNativeMode,
} from "../../../src/legacy-migration/migration-service"
import { NATIVE_MODE_DEFAULTS } from "../../../src/legacy-migration/native-mode-defaults"
import type { LegacyCustomMode, LegacyPromptComponent } from "../../../src/legacy-migration/legacy-types"

// ---------------------------------------------------------------------------
// isNativeModeModified
// ---------------------------------------------------------------------------

describe("isNativeModeModified", () => {
  const defaults = NATIVE_MODE_DEFAULTS["code"]!

  it("returns true when a YAML override exists", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "custom role",
      groups: ["read"],
    }
    expect(isNativeModeModified(yaml, undefined, defaults)).toBe(true)
  })

  it("returns false when no YAML and no prompts exist", () => {
    expect(isNativeModeModified(undefined, undefined, defaults)).toBe(false)
  })

  it("returns false when prompts match the defaults exactly", () => {
    const prompt: LegacyPromptComponent = {
      roleDefinition: defaults.roleDefinition,
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(false)
  })

  it("returns true when roleDefinition differs from default", () => {
    const prompt: LegacyPromptComponent = {
      roleDefinition: "You are a Python specialist.",
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(true)
  })

  it("returns true when customInstructions differs from default", () => {
    const prompt: LegacyPromptComponent = {
      customInstructions: "Always use type hints.",
    }
    // code mode has no default customInstructions, so any non-empty value is different
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(true)
  })

  it("returns true when whenToUse differs from default", () => {
    const prompt: LegacyPromptComponent = {
      whenToUse: "Use for Python only.",
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(true)
  })

  it("returns false when prompts have empty strings", () => {
    const prompt: LegacyPromptComponent = {
      roleDefinition: "",
      customInstructions: "",
      whenToUse: "",
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(false)
  })

  it("returns false when customInstructions matches default (ask mode)", () => {
    const ask = NATIVE_MODE_DEFAULTS["ask"]!
    const prompt: LegacyPromptComponent = {
      customInstructions: ask.customInstructions,
    }
    expect(isNativeModeModified(undefined, prompt, ask)).toBe(false)
  })

  it("returns true when customInstructions differs from default (ask mode)", () => {
    const ask = NATIVE_MODE_DEFAULTS["ask"]!
    const prompt: LegacyPromptComponent = {
      customInstructions: "Different instructions.",
    }
    expect(isNativeModeModified(undefined, prompt, ask)).toBe(true)
  })

  it("returns true when description differs from default", () => {
    const prompt: LegacyPromptComponent = {
      description: "My custom short description",
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(true)
  })

  it("returns false when description matches default", () => {
    const prompt: LegacyPromptComponent = {
      description: defaults.description,
    }
    expect(isNativeModeModified(undefined, prompt, defaults)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildCustomModeList
// ---------------------------------------------------------------------------

describe("buildCustomModeList", () => {
  it("returns non-native custom modes as before", () => {
    const modes: LegacyCustomMode[] = [
      { slug: "translate", name: "Translate", roleDefinition: "translator", groups: ["read"] },
    ]
    const result = buildCustomModeList(modes, null)
    expect(result).toEqual([{ name: "Translate", slug: "translate" }])
  })

  it("still filters out unmodified native modes from YAML", () => {
    // A mode list with only non-native entries + an exact-slug match that is not a YAML
    // override (just a non-matching slug that happens to be native) — this shouldn't happen
    // in practice because custom_modes.yaml would only have a native slug if the user put it there
    const result = buildCustomModeList(null, null)
    expect(result).toEqual([])
  })

  it("includes a modified native mode from YAML with -custom slug", () => {
    const modes: LegacyCustomMode[] = [
      {
        slug: "code",
        name: "My Code Mode",
        roleDefinition: "You are a specialized engineer.",
        groups: ["read", "edit"],
      },
    ]
    const result = buildCustomModeList(modes, null)
    expect(result).toEqual([{ name: "My Code Mode (Custom)", slug: "code-custom", nativeSlug: "code" }])
  })

  it("includes a modified native mode from customModePrompts with -custom slug", () => {
    const prompts: Record<string, LegacyPromptComponent> = {
      code: { roleDefinition: "You are a Python expert." },
    }
    const result = buildCustomModeList(null, prompts)
    expect(result).toEqual([{ name: "Code (Custom)", slug: "code-custom", nativeSlug: "code" }])
  })

  it("does not include a native mode when prompts match defaults", () => {
    const defaults = NATIVE_MODE_DEFAULTS["code"]!
    const prompts: Record<string, LegacyPromptComponent> = {
      code: { roleDefinition: defaults.roleDefinition },
    }
    const result = buildCustomModeList(null, prompts)
    expect(result).toEqual([])
  })

  it("combines non-native custom modes and modified native modes", () => {
    const modes: LegacyCustomMode[] = [
      { slug: "translate", name: "Translate", roleDefinition: "translator", groups: ["read"] },
      { slug: "code", name: "Custom Code", roleDefinition: "specialized", groups: ["read", "edit"] },
    ]
    const result = buildCustomModeList(modes, null)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ name: "Translate", slug: "translate" })
    expect(result[1]).toEqual({ name: "Custom Code (Custom)", slug: "code-custom", nativeSlug: "code" })
  })

  it("produces only one entry when both YAML and prompts exist for same native slug", () => {
    const modes: LegacyCustomMode[] = [
      { slug: "code", name: "Custom Code", roleDefinition: "from yaml", groups: ["read"] },
    ]
    const prompts: Record<string, LegacyPromptComponent> = {
      code: { roleDefinition: "from prompts" },
    }
    const result = buildCustomModeList(modes, prompts)
    const native = result.filter((m) => m.nativeSlug === "code")
    expect(native).toHaveLength(1)
    expect(native[0]!.slug).toBe("code-custom")
  })

  it("excludes 'build' since it is a native slug with no legacy defaults", () => {
    const modes: LegacyCustomMode[] = [{ slug: "build", name: "Build", roleDefinition: "builder", groups: ["read"] }]
    // "build" is in DEFAULT_MODE_SLUGS (so filtered from non-native pass) but has no
    // entry in NATIVE_MODE_DEFAULTS (so skipped in the native-modification pass)
    const result = buildCustomModeList(modes, null)
    expect(result).toEqual([])
  })

  it("detects multiple modified native modes", () => {
    const prompts: Record<string, LegacyPromptComponent> = {
      code: { roleDefinition: "Custom code role" },
      debug: { roleDefinition: "Custom debug role" },
    }
    const result = buildCustomModeList(null, prompts)
    const slugs = result.map((m) => m.slug)
    expect(slugs).toContain("code-custom")
    expect(slugs).toContain("debug-custom")
  })
})

// ---------------------------------------------------------------------------
// buildMergedNativeMode
// ---------------------------------------------------------------------------

describe("buildMergedNativeMode", () => {
  it("returns null for unknown slugs", () => {
    expect(buildMergedNativeMode(undefined, undefined, "nonexistent")).toBeNull()
  })

  it("uses YAML mode as base when present", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "custom role from yaml",
      groups: ["read"],
    }
    const result = buildMergedNativeMode(yaml, undefined, "code")
    expect(result).not.toBeNull()
    expect(result!.roleDefinition).toBe("custom role from yaml")
    expect(result!.groups).toEqual(["read"])
  })

  it("uses native defaults as base when no YAML", () => {
    const prompt: LegacyPromptComponent = {
      roleDefinition: "custom role from prompts",
    }
    const result = buildMergedNativeMode(undefined, prompt, "code")
    expect(result).not.toBeNull()
    expect(result!.roleDefinition).toBe("custom role from prompts")
    expect(result!.name).toBe("Code")
    expect(result!.groups).toEqual(NATIVE_MODE_DEFAULTS["code"]!.groups)
  })

  it("overlays prompts on top of YAML", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "yaml role",
      customInstructions: "yaml instructions",
      groups: ["read"],
    }
    const prompt: LegacyPromptComponent = {
      roleDefinition: "prompt role",
    }
    const result = buildMergedNativeMode(yaml, prompt, "code")
    expect(result).not.toBeNull()
    expect(result!.roleDefinition).toBe("prompt role")
    expect(result!.customInstructions).toBe("yaml instructions")
  })

  it("preserves default groups when only prompts are present", () => {
    const prompt: LegacyPromptComponent = {
      customInstructions: "extra instructions",
    }
    const result = buildMergedNativeMode(undefined, prompt, "architect")
    expect(result).not.toBeNull()
    expect(result!.groups).toEqual(NATIVE_MODE_DEFAULTS["architect"]!.groups)
  })

  it("does not mutate the YAML input", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "original",
      groups: ["read"],
    }
    const prompt: LegacyPromptComponent = {
      roleDefinition: "overridden",
    }
    buildMergedNativeMode(yaml, prompt, "code")
    expect(yaml.roleDefinition).toBe("original")
  })

  it("does not overlay empty prompt strings", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "yaml role",
      groups: ["read"],
    }
    const prompt: LegacyPromptComponent = {
      roleDefinition: "",
      customInstructions: "",
    }
    const result = buildMergedNativeMode(yaml, prompt, "code")
    expect(result!.roleDefinition).toBe("yaml role")
    expect(result!.customInstructions).toBeUndefined()
  })

  it("includes whenToUse from prompts", () => {
    const prompt: LegacyPromptComponent = {
      whenToUse: "Use for special tasks",
    }
    const result = buildMergedNativeMode(undefined, prompt, "code")
    expect(result!.whenToUse).toBe("Use for special tasks")
  })

  it("overlays description from prompts", () => {
    const prompt: LegacyPromptComponent = {
      description: "My custom description",
    }
    const result = buildMergedNativeMode(undefined, prompt, "code")
    expect(result!.description).toBe("My custom description")
  })

  it("preserves default description when prompt description is empty", () => {
    const prompt: LegacyPromptComponent = {
      description: "",
    }
    const result = buildMergedNativeMode(undefined, prompt, "code")
    expect(result!.description).toBe(NATIVE_MODE_DEFAULTS["code"]!.description)
  })

  it("overlays description from prompts on top of YAML", () => {
    const yaml: LegacyCustomMode = {
      slug: "code",
      name: "My Code",
      roleDefinition: "yaml role",
      description: "yaml description",
      groups: ["read"],
    }
    const prompt: LegacyPromptComponent = {
      description: "prompt description",
    }
    const result = buildMergedNativeMode(yaml, prompt, "code")
    expect(result!.description).toBe("prompt description")
  })
})
