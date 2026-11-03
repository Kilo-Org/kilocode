process.on("SIGTERM", () => {})

if (import.meta.main) await Bun.sleep(60_000)
