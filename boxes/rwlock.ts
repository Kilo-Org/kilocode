/**
 * rwlock.ts — Readers-writer lock map (writer priority, no starvation)
 * Zero deps.
 *
 * using r = await rwlock.read("key")
 * using w = await rwlock.write("key")
 */
const map = new Map<string, { r: number; w: boolean; wr: (() => void)[]; ww: (() => void)[] }>()

function get(k: string) {
  if (!map.has(k)) map.set(k, { r: 0, w: false, wr: [], ww: [] })
  return map.get(k)!
}

function drain(k: string) {
  const l = map.get(k)
  if (!l || l.w || l.r > 0) return
  if (l.ww.length > 0) { l.ww.shift()!(); return }
  while (l.wr.length > 0) l.wr.shift()!()
  if (l.r === 0 && !l.w && l.wr.length === 0 && l.ww.length === 0) map.delete(k)
}

function mkRelease(k: string, mode: "r" | "w"): Disposable {
  return { [Symbol.dispose]: () => { const l = map.get(k); if (!l) return; if (mode === "w") l.w = false; else l.r--; drain(k) } }
}

export async function read(k: string): Promise<Disposable> {
  const l = get(k)
  return new Promise<Disposable>((res) => {
    if (!l.w && l.ww.length === 0) { l.r++; res(mkRelease(k, "r")) }
    else l.wr.push(() => { l.r++; res(mkRelease(k, "r")) })
  })
}

export async function write(k: string): Promise<Disposable> {
  const l = get(k)
  return new Promise<Disposable>((res) => {
    if (!l.w && l.r === 0) { l.w = true; res(mkRelease(k, "w")) }
    else l.ww.push(() => { l.w = true; res(mkRelease(k, "w")) })
  })
}
