import * as vscode from 'vscode';

export function getReviewPanelHtml(report: string, cspSource: string, scriptUri: vscode.Uri, styleUri: vscode.Uri): string {
    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleUri}" rel="stylesheet">
            <title>Revisão do Editor</title>
        </head>
        <body>
            <h1>Relatório de Revisão do Editor</h1>
            <div id="report-content">
                <pre>${report}</pre>
            </div>
            <hr>
            <h2>Ações</h2>
            <vscode-text-area id="review-feedback" placeholder="Adicione seus comentários para a revisão aqui..." rows="5" style="width: 100%"></vscode-text-area>
            <br/><br/>
            <vscode-button id="approve-btn">Aprovar e Continuar</vscode-button>
            <vscode-button id="revise-btn">Solicitar Revisão</vscode-button>

            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
