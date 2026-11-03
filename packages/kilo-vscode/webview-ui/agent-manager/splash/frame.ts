interface Box {
  top: number
  bottom: number
}

/**
 * The preview list's scrollTop. Rows are readable between the sticky project
 * header and the bottom fade. Keep every marked row (`top`..`bottom`) in view
 * when they fit, otherwise the `active` one, moving as little as possible from
 * `current`. Boxes are in the list's content coordinates.
 */
export function frame(opts: Box & { active: Box; height: number; fade: number; header: number; current: number }) {
  const room = opts.height - opts.fade - opts.header
  const box = opts.bottom - opts.top <= room ? opts : opts.active
  return Math.max(0, Math.min(Math.max(opts.current, box.bottom - opts.height + opts.fade), box.top - opts.header))
}
