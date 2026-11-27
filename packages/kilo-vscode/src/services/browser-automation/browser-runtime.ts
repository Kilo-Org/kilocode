import type { LaunchOptions } from "playwright-core"

export function brokerOptions(
  system: boolean,
  port: number | undefined,
  proxy: NonNullable<LaunchOptions["proxy"]>,
): LaunchOptions {
  const base = options(system, port)
  return {
    ...base,
    proxy,
    ignoreDefaultArgs: ["--disable-popup-blocking", ...(port ? ["--disable-extensions"] : [])],
    args: [
      ...(base.args ?? []).filter((arg) => arg !== "--no-proxy-server"),
      "--force-device-scale-factor=2",
      "--disable-quic",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ...(port ? ["--enable-unsafe-extension-debugging"] : []),
    ],
  }
}

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
