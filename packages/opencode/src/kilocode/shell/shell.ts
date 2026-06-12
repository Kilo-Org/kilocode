import { Buffer } from "node:buffer"

export function args(command: string) {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(command)]
}

function encoded(command: string) {
  const payload = Buffer.from(command, "utf8").toString("base64")
  return Buffer.from(
    `[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
$OutputEncoding = [Console]::OutputEncoding;
& ([scriptblock]::Create([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}'))))`,
    "utf16le",
  ).toString("base64")
}
