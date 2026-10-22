import type { LaunchOptions } from "playwright-core"

export function options(
  system: boolean,
  port?: number,
  env: Record<string, string | undefined> = process.env,
): LaunchOptions {
  return {
    chromiumSandbox: true,
    headless: true,
    env: Object.fromEntries(
      Object.entries(env).filter(
        ([key, value]) =>
          typeof value === "string" &&
          !/proxy/i.test(key) &&
          !/(TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)(_|$)/i.test(key),
      ),
    ),
    args: [
      "--no-proxy-server",
      ...(port ? ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`] : []),
    ],
    ...(system ? { channel: "chrome" } : {}),
  }
}
