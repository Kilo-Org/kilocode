/**
 * Context Engine Settings UI Provider
 * Displays configuration and statistics in a webview panel
 */

import * as vscode from "vscode"
import type { ContextEngine } from "../index"

export class ContextEngineSettingsProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "kilocode.contextEngine.settings"

	private _view?: vscode.WebviewView
	private _engine: ContextEngine

	constructor(
		private readonly _extensionUri: vscode.Uri,
		engine: ContextEngine,
	) {
		this._engine = engine
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

		// Handle messages from  the webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case "reindex":
					await this.handleReindex()
					break
				case "clear":
					await this.handleClear()
					break
				case "refresh":
					await this.refreshStats()
					break
			}
		})

		// Initial stats load
		this.refreshStats()
	}

	private async handleReindex() {
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Re-indexing project...",
					cancellable: false,
				},
				async (progress) => {
					await this._engine.indexProject((prog, message) => {
						progress.report({
							increment: prog,
							message,
						})
					})
				},
			)

			vscode.window.showInformationMessage("Project re-indexed successfully!")
			await this.refreshStats()
		} catch (error) {
			vscode.window.showErrorMessage(`Re-indexing failed: ${error}`)
		}
	}

	private async handleClear() {
		const confirm = await vscode.window.showWarningMessage(
			"Are you sure you want to clear all indexed data? This cannot be undone.",
			{ modal: true },
			"Yes, Clear",
			"Cancel",
		)

		if (confirm === "Yes, Clear") {
			try {
				await this._engine.clear()
				vscode.window.showInformationMessage("Index cleared successfully!")
				await this.refreshStats()
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to clear index: ${error}`)
			}
		}
	}

	private async refreshStats() {
		if (!this._view) {
			return
		}

		try {
			const stats = this._engine.getIndexingStats()
			const metrics = await this._engine.getPerformanceMetrics()

			this._view.webview.postMessage({
				type: "stats",
				data: {
					stats,
					metrics,
				},
			})
		} catch (error) {
			console.error("Failed to refresh stats:", error)
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Context Engine Settings</title>
    <style>
        body {
            padding: 20px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        .section {
            margin-bottom: 30px;
            padding: 15px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--vscode-textLink-foreground);
        }

        .stat-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .stat-row:last-child {
            border-bottom: none;
        }

        .stat-label {
            color: var(--vscode-descriptionForeground);
        }

        .stat-value {
            font-weight: 600;
            color: var(--vscode-textLink-activeForeground);
        }

        .button-group {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }

        button {
            flex: 1;
            padding: 10px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.danger {
            background: var(--vscode-errorForeground);
        }

        button.danger:hover {
            opacity: 0.9;
        }

        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }

        .badge.success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }

        .badge.warning {
            background: var(--vscode-editorWarning-foreground);
            color: white;
        }

        .progress-bar {
            width: 100%;
            height: 6px;
            background: var(--vscode-progressBar-background);
            border-radius: 3px;
            margin-top: 5px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--vscode-textLink-activeForeground);
            transition: width 0.3s;
        }

        .refresh-btn {
            float: right;
            padding: 4px 12px;
            font-size: 11px;
        }
    </style>
</head>
<body>
    <button class="refresh-btn" onclick="refresh()">🔄 Refresh</button>

    <h1 style="margin-top: 0;">Context Engine Settings</h1>

    <div class="section">
        <div class="section-title">📊 Indexing Statistics</div>
        <div class="stat-row">
            <span class="stat-label">Total Files</span>
            <span class="stat-value" id="totalFiles">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Indexed Files</span>
            <span class="stat-value" id="indexedFiles">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Total Chunks</span>
            <span class="stat-value" id="totalChunks">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Failed Files</span>
            <span class="stat-value" id="failedFiles">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Database Size</span>
            <span class="stat-value" id="dbSize">-</span>
        </div>
        <div id="indexProgress" style="margin-top: 10px;"></div>
    </div>

    <div class="section">
        <div class="section-title">⚡ Performance Metrics</div>
        <div class="stat-row">
            <span class="stat-label">Query Latency (p95)</span>
            <span class="stat-value" id="queryLatency">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Cache Hit Rate</span>
            <span class="stat-value" id="cacheHitRate">-</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Memory Footprint</span>
            <span class="stat-value" id="memoryFootprint">-</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">⚙️ Actions</div>
        <div class="button-group">
            <button onclick="reindex()">🔄 Re-index Project</button>
            <button class="danger" onclick="clearIndex()">🗑️ Clear Index</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'stats') {
                updateStats(message.data);
            }
        });

        function updateStats(data) {
            const { stats, metrics } = data;

            // Update indexing stats
            document.getElementById('totalFiles').textContent = stats.totalFiles.toLocaleString();
            document.getElementById('indexedFiles').textContent = stats.indexedFiles.toLocaleString();
            document.getElementById('totalChunks').textContent = stats.totalChunks.toLocaleString();
            document.getElementById('failedFiles').textContent = stats.failedFiles.length;
            document.getElementById('dbSize').textContent = (stats.databaseSize / 1024 / 1024).toFixed(2) + ' MB';

            // Update progress bar
            const progress = stats.totalFiles > 0 ? (stats.indexedFiles / stats.totalFiles) * 100 : 0;
            document.getElementById('indexProgress').innerHTML = \`
                <div class="progress-bar">
                    <div class="progress-fill" style="width: \${progress}%"></div>
                </div>
                <div style="text-align: center; margin-top: 5px; font-size: 11px;">
                    \${progress.toFixed(1)}% indexed
                </div>
            \`;

            // Update performance metrics
            document.getElementById('queryLatency').textContent = metrics.queryLatencyP95.toFixed(2) + ' ms';
            document.getElementById('cacheHitRate').textContent = (metrics.cacheHitRate * 100).toFixed(1) + '%';
            document.getElementById('memoryFootprint').textContent = metrics.memoryFootprint.toFixed(2) + ' MB';
        }

        function reindex() {
            vscode.postMessage({ type: 'reindex' });
        }

        function clearIndex() {
            vscode.postMessage({ type: 'clear' });
        }

        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }
    </script>
</body>
</html>`
	}
}
