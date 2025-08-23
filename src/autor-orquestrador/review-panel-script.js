// @ts-check

// This script will be run within the webview itself
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    document.getElementById('approve-btn')?.addEventListener('click', () => {
        vscode.postMessage({
            command: 'approve'
        });
    });

    document.getElementById('revise-btn')?.addEventListener('click', () => {
        const feedback = document.getElementById('review-feedback')?.value;
        vscode.postMessage({
            command: 'revise',
            feedback: feedback
        });
    });
}());
