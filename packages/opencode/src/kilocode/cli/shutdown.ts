export namespace KiloShutdown {
  const tasks = new Set<() => void | Promise<void>>()

  export function register(task: () => void | Promise<void>) {
    tasks.add(task)
    return () => tasks.delete(task)
  }

  export async function run() {
    const pending = Array.from(tasks)
    tasks.clear()
    await Promise.all(pending.map((task) => task()))
  }
}
