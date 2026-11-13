// The Notifications tab choices: the v1 sound catalog (`kilo-code.v2.attention.sound` in package.json) and whether
// this platform has a native notification command.
const GROUPS = [
  { value: "alert", key: "alert", count: 10 },
  { value: "bip-bop", key: "bipbop", count: 10 },
  { value: "staplebops", key: "staplebops", count: 7 },
  { value: "nope", key: "nope", count: 12 },
  { value: "yup", key: "yup", count: 6 },
]

export const SOUND_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "default", labelKey: "settings.notifications.sound.default" },
  { value: "system", labelKey: "settings.notifications.sound.system" },
  ...GROUPS.flatMap((group) =>
    Array.from({ length: group.count }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0")
      return { value: `${group.value}-${suffix}`, labelKey: `sound.option.${group.key}${suffix}` }
    }),
  ),
]

/** The configured sound, or the default for a value outside the catalog. */
export function soundChoice(value: unknown): string {
  return SOUND_OPTIONS.some((option) => option.value === value) ? (value as string) : "default"
}

/** The host inlines whether this platform can show native notifications. */
export function osNotificationsAvailable(): boolean {
  if (typeof window === "undefined") return false
  return (window as unknown as { KILO_OS_NOTIFICATIONS?: boolean }).KILO_OS_NOTIFICATIONS === true
}
