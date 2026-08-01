import type { ElementHandle, Page } from "playwright"
import type { RefEntry, Snapshot } from "../../types"

type WalkedNode = {
  ref: string
  role: string | null
  name: string
}

type WalkResult = {
  nodes: WalkedNode[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function walked(value: unknown): value is WalkedNode {
  if (!record(value)) return false
  return (
    typeof value.ref === "string" &&
    (typeof value.role === "string" || value.role === null) &&
    typeof value.name === "string"
  )
}

function result(value: unknown): value is WalkResult {
  return record(value) && Array.isArray(value.nodes) && value.nodes.every(walked)
}

const WALK_SCRIPT = `
(() => {
  const out = { nodes: [], counter: { value: 1 } };
  const visited = new WeakSet();

  function clear(root) {
    for (const el of Array.from(root.querySelectorAll('[data-kilo-ref]'))) el.removeAttribute('data-kilo-ref');
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) clear(el.shadowRoot);
    }
  }

  function roleOf(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'button') return 'button';
    if (t === 'a') return 'link';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') {
      const type = (el.type || '').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(t)) return 'heading';
    return null;
  }

  function nameOf(el) {
    // Compute the accessible name the way Playwright does for role=name=.
    // Priority: aria-labelledby > aria-label > label[for=id] > placeholder > name > text.
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ids = labelledBy.split(/\\s+/);
      const parts = ids.map((id) => { const ref = document.getElementById(id); return ref ? (ref.textContent || '').trim() : ''; }).filter(Boolean);
      if (parts.length > 0) return parts.join(' ').slice(0, 100);
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.id) {
      const lbl = document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
      if (lbl) {
        const txt = (lbl.textContent || '').replace(/\\*+/g, '').replace(/\\s+/g, ' ').trim();
        if (txt) return txt.slice(0, 100);
      }
    }
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    if (el.getAttribute('name')) return el.getAttribute('name');
    const inner = (el.innerText || el.textContent || '').trim();
    return inner.slice(0, 100);
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['input', 'button', 'select', 'textarea', 'a'].includes(tag)) return true;
    if (el.getAttribute('role')) return true;
    if (el.getAttribute('onclick')) return true;
    if (el.getAttribute('tabindex')) return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function isHidden(el) {
    const style = getComputedStyle(el);
    return el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  }

  function walk(root) {
    const kids = Array.from(root.children);
    for (const el of kids) {
      if (visited.has(el)) continue;
      visited.add(el);
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'meta', 'link', 'head', 'title'].includes(tag)) continue;
      if (isHidden(el)) continue;
      if (isInteractive(el) || (el.textContent || '').trim().length > 0) {
        const role = roleOf(el);
        const name = (nameOf(el) || '').trim();
        if (role || (el.tagName.toLowerCase() === 'a' && name)) {
          const ref = 'e' + out.counter.value++;
          el.setAttribute('data-kilo-ref', ref);
          out.nodes.push({
            ref,
            role,
            name,
          });
        }
      }
      const sr = el.shadowRoot;
      if (sr) {
        walk(sr);
      }
      walk(el);
    }
  }

  clear(document);
  walk(document.body);
  return out;
})();
`

export namespace Refs {
  export function stash(session: string, snapshot: Snapshot): void {
    CACHE.set(session, snapshot)
  }

  export function lookup(session: string): Snapshot | undefined {
    return CACHE.get(session)
  }

  export function reset(session: string): void {
    CACHE.delete(session)
  }

  export function clear(): void {
    CACHE.clear()
  }

  export function resolve(session: string, ref: string): { selector: string; entry: RefEntry } {
    const snap = CACHE.get(session)
    if (!snap) throw new Error(`no snapshot cached for session "${session}" — run snapshot first`)
    const entry = snap.refs.find((r) => r.ref === ref)
    if (!entry) throw new Error(`ref "${ref}" not in current snapshot`)
    if (!entry.selector) throw new Error(`ref "${ref}" has no resolvable selector`)
    return { selector: entry.selector, entry }
  }

  /**
   * Resolve a ref or selector to a Playwright ElementHandle.
   * Selectors may include the `>>` shadow-piercing operator
   * (e.g. `#shadow-host >> #shadow-pin`); refs always use the
   * selector captured at snapshot time, which is also a `>>` chain
   * when the element lives in a shadow root.
   */
  export async function refOrSelector(
    page: Page,
    session: string,
    ref: string | undefined,
    selector: string | undefined,
  ): Promise<ElementHandle | null> {
    if (ref) {
      const resolved = resolve(session, ref)
      return resolveLocator(page, resolved.selector)
    }
    if (selector) return resolveLocator(page, selector)
    throw new Error("must provide either --ref or --selector")
  }

  export async function use<T>(
    page: Page,
    session: string,
    ref: string | undefined,
    selector: string | undefined,
    fn: (target: ElementHandle) => Promise<T>,
  ): Promise<T> {
    const target = await refOrSelector(page, session, ref, selector)
    if (!target) throw new Error(`no element found for ${ref ?? selector}`)
    try {
      return await fn(target)
    } finally {
      await target.dispose()
    }
  }

  export async function capture(session: string, page: Page): Promise<Snapshot> {
    const value: unknown = await page.evaluate(WALK_SCRIPT)
    if (!result(value)) throw new Error("browser snapshot returned an invalid result")
    const refs: RefEntry[] = []
    for (const node of value.nodes) {
      const ref = node.ref
      const entry: RefEntry = {
        ref,
        role: node.role ?? "",
        name: node.name,
        depth: 0,
      }
      const sel = buildSelector(node)
      if (sel) entry.selector = sel
      refs.push(entry)
    }
    const snapshot = renderTextTree(refs)
    const out: Snapshot = { snapshot, refs }
    stash(session, out)
    return out
  }
}

function buildSelector(node: WalkedNode): string {
  return `[data-kilo-ref="${node.ref}"]`
}

function renderTextTree(refs: RefEntry[]): string {
  return refs.map((r: RefEntry) => `- [ref=${r.ref}] [${r.role}] ${JSON.stringify(r.name)}`).join("\n")
}

function resolveLocator(page: Page, selector: string): Promise<ElementHandle | null> {
  // page.$() only supports CSS selectors; role selectors require locator().
  // We always go through locator() to support both.
  if (selector.includes(">>")) {
    const parts = selector.split(">>").map((s) => s.trim())
    let loc = page.locator(parts[0]).first()
    for (let i = 1; i < parts.length; i++) {
      loc = loc.locator(parts[i])
    }
    return loc.elementHandle()
  }
  return page.locator(selector).first().elementHandle()
}

const CACHE = new Map<string, Snapshot>()
