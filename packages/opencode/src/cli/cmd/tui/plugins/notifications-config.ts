// kilocode_change - new file
/**
 * Helper functions for reading and writing notification settings in the TUI KV store.
 *
 * These settings are persisted per-project in `kv.json` and are read by the
 * `internal:notifications` plugin when deciding whether to deliver sounds and
 * native desktop notifications.
 */

export const KV_ATTENTION_SOUND = "attention.sound"
export const KV_ATTENTION_NOTIFICATIONS = "attention.notifications"

export function readSound(kv: { get: (key: string, fallback?: boolean) => boolean }): boolean {
  return kv.get(KV_ATTENTION_SOUND, true)
}

export function writeSound(kv: { set: (key: string, value: boolean) => void }, value: boolean): void {
  kv.set(KV_ATTENTION_SOUND, value)
}

export function readNotifications(kv: { get: (key: string, fallback?: boolean) => boolean }): boolean {
  return kv.get(KV_ATTENTION_NOTIFICATIONS, true)
}

export function writeNotifications(kv: { set: (key: string, value: boolean) => void }, value: boolean): void {
  kv.set(KV_ATTENTION_NOTIFICATIONS, value)
}

export function getAttentionConfig(api: any) {
  return {
    sound: api.kv?.get("attention.sound") ?? true,
    notifications: api.kv?.get("attention.notifications") ?? true,
  }
}

export function toggleAttention(api: any, key: 'sound' | 'notifications', currentValue: boolean) {
  api.kv?.set(`attention.${key}`, !currentValue)
}
