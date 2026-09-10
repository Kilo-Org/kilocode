import { getSharedHighlighter } from "@pierre/diffs"
import { bundledLanguages, type BundledLanguage } from "shiki"
import { fnv1a } from "../context/marked"

type Job = {
  code: string
  lang: string
  busy: boolean
}

const jobs = new WeakMap<HTMLPreElement, Job>()

function continues(before: string, after: string) {
  const base = before.endsWith("\n") ? before.slice(0, -1) : before
  return !!base && after.startsWith(base)
}

async function source(lang: string, code: string) {
  try {
    const highlighter = await getSharedHighlighter({ themes: ["Kilo"], langs: [] })
    const language = lang in bundledLanguages ? lang : "text"
    if (!highlighter.getLoadedLanguages().includes(language)) {
      await highlighter.loadLanguage(language as BundledLanguage)
    }
    return highlighter.codeToHtml(code, { lang: language, theme: "Kilo", tabindex: false })
  } catch (err) {
    console.warn("Streaming code highlight failed", lang, err)
    return
  }
}

export function update(pre: HTMLPreElement, html: string, code: string) {
  if (!pre.isConnected) return
  const dir = pre.getAttribute("dir") ?? "auto"
  const temp = document.createElement("div")
  temp.innerHTML = html
  const next = temp.firstElementChild
  if (!(next instanceof HTMLPreElement)) return
  const x = pre.scrollLeft
  for (const name of pre.getAttributeNames()) {
    pre.removeAttribute(name)
  }
  for (const attr of next.attributes) {
    pre.setAttribute(attr.name, attr.value)
  }
  pre.setAttribute("dir", dir)
  pre.setAttribute("data-source-hash", fnv1a(code))
  pre.replaceChildren(...Array.from(next.childNodes))
  pre.scrollLeft = x
}

async function refresh(pre: HTMLPreElement, code: string, lang: string) {
  if (!pre.isConnected || !code) return
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (!pre.isConnected) return
  const html = await source(lang, code)
  if (!html || !pre.isConnected) return
  update(pre, html, code)
}

function run(pre: HTMLPreElement, job: Job) {
  const code = job.code
  const lang = job.lang
  job.busy = true
  const done = () => {
    job.busy = false
    if (!pre.isConnected) return
    if (job.code !== code || job.lang !== lang) {
      run(pre, job)
      return
    }
  }
  void refresh(pre, code, lang).then(done, done)
}

function queue(pre: HTMLPreElement, code: string, lang: string) {
  const job = jobs.get(pre) ?? { code, lang, busy: false }
  job.code = code
  job.lang = lang
  jobs.set(pre, job)
  if (job.busy) return
  run(pre, job)
}

export function preserveStreamingHighlight(from: Element, to: Element, streaming: boolean) {
  if (!streaming) return false
  if (!(from instanceof HTMLPreElement) || !(to instanceof HTMLPreElement)) return false
  if (!from.classList.contains("shiki") || to.classList.contains("shiki")) return false
  const before = from.querySelector("code")?.textContent ?? ""
  const after = to.querySelector("code")?.textContent ?? ""
  const lang = to.querySelector("code")?.getAttribute("data-lang") || "text"
  if (!after || lang === "mermaid" || !continues(before, after)) return false
  queue(from, after, lang)
  return true
}
