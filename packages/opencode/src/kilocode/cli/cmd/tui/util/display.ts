export function hasDisplay() {
  if (process.platform !== "linux") return true
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
}
