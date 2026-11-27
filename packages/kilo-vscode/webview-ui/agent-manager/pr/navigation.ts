import { batch, createEffect, createSignal, untrack } from "solid-js"

interface Target {
  projectId?: string
  worktreeId: string
}

export function createPRNavigation(opts: {
  project: () => string | undefined
  active: () => string | undefined
  selection: () => string | null
  select: (target: Target) => void
  visible: () => boolean
  open: () => void
  refresh: (target: Target) => void
}) {
  const [pending, setPending] = createSignal<Target & { id: number; opened: boolean }>()
  let next = 0
  const matches = (target: Target) =>
    opts.project() === target.projectId && opts.active() === target.projectId && opts.selection() === target.worktreeId

  createEffect(() => {
    const value = pending()
    if (!value) return
    const selected = matches(value)
    if (value.opened) {
      if (!selected || !opts.visible()) setPending(undefined)
      return
    }
    if (!selected) return
    untrack(() =>
      batch(() => {
        setPending({ ...value, opened: true })
        opts.open()
        opts.refresh(value)
      }),
    )
  })

  return {
    open: (target: Target) =>
      batch(() => {
        opts.select(target)
        setPending({ ...target, id: ++next, opened: false })
      }),
    cancel: () => setPending(undefined),
    jump: () => {
      const value = pending()
      return value?.opened && matches(value) && opts.visible() ? value.id : undefined
    },
    complete: (id: number) => {
      if (pending()?.id === id) setPending(undefined)
    },
  }
}
