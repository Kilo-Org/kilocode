import * as vscode from "vscode"

export function loginHtml(webview: vscode.Webview, input: {
  gateway: string
  platform: string
  loggedIn: boolean
  userId: string
  proxyPort: number
  callback: string
}): string {
  const nonce = String(Date.now())
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ")

  const status = input.loggedIn
    ? `<p class="ok">已登录${input.userId ? `（${escape(input.userId)}）` : ""}</p>
       <p class="hint">本地代理：<code>127.0.0.1:${input.proxyPort}</code></p>
       <button id="open-kilo">打开 Kilo Code</button>
       <button id="logout" class="secondary">退出登录</button>`
    : `<label>网关地址</label>
       <input id="gateway" type="url" placeholder="https://wab.flyfishphp.cn" value="${escape(input.gateway)}" />
       <label>Platform 地址（可选）</label>
       <input id="platform" type="url" placeholder="默认同网关" value="${escape(input.platform)}" />
       <p class="hint">OIDC 回调：<code>${escape(input.callback)}</code></p>
       <button id="login">OAuth 登录</button>`

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 20px 16px;
      margin: 0;
      line-height: 1.5;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 20px; font-size: 0.9rem; }
    label { display: block; margin: 12px 0 4px; font-size: 0.85rem; }
    input {
      width: 100%; box-sizing: border-box; padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
    }
    button {
      display: block; width: 100%; margin-top: 16px; padding: 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; font-size: 0.95rem;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .hint { font-size: 0.8rem; color: var(--vscode-descriptionForeground); margin-top: 12px; }
    .ok { color: var(--vscode-testing-iconPassed); }
    code { font-size: 0.75rem; word-break: break-all; }
  </style>
</head>
<body>
  <h1>驭码登录</h1>
  <p class="sub">登录后通过本地代理为 Kilo Code 注入 JWT，无需修改 Kilo 源码。</p>
  ${status}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("login")?.addEventListener("click", () => {
      vscode.postMessage({
        type: "login",
        gateway: document.getElementById("gateway")?.value ?? "",
        platform: document.getElementById("platform")?.value ?? "",
      });
    });
    document.getElementById("logout")?.addEventListener("click", () => vscode.postMessage({ type: "logout" }));
    document.getElementById("open-kilo")?.addEventListener("click", () => vscode.postMessage({ type: "openKilo" }));
  </script>
</body>
</html>`
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
}
