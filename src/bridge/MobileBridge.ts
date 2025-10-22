import * as http from "http";
import * as vscode from "vscode";
import { ClineProvider } from "../core/webview/ClineProvider";
import { Task } from "../core/task/Task";
import { RooCodeEventName, ClineMessage } from "@roo-code/types";
import { getModeBySlug } from "../shared/modes";

const HOST = "0.0.0.0";

import { Socket } from "net";

export let server: http.Server | null = null;
let outputChannel: vscode.OutputChannel;
const sockets = new Set<Socket>();

export function getBridgeStatus(): "running" | "stopped" | "error" {
	if (server) {
		return "running";
	}
	return "stopped";
}

function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel("Kilo Code Mobile Bridge");
	}
	return outputChannel;
}

export function startMobileBridge(port: number) {
	if (server) {
		const msg = `Kilo Code Mobile Bridge is already running on port ${port}.`;
		getOutputChannel().appendLine(msg);
		vscode.window.showInformationMessage(msg);
		return;
	}

	const channel = getOutputChannel();
	channel.show();
	channel.appendLine(`Starting Kilo Code Mobile Bridge on port ${port}...`);

	server = http.createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID, Cache-Control, x-requested-with");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method === "POST" && req.url === "/new-task") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", async () => {
				try {
					const { message } = JSON.parse(body);
					const provider = await ClineProvider.getInstance();
					if (!provider) {
						res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Kilo Code is not running" }));
						return;
					}

					res.writeHead(200, {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						"Access-Control-Allow-Origin": "*",
						Connection: "keep-alive",
						"Transfer-Encoding": "chunked",
					});

					const taskPromise = new Promise<Task>((resolve) => {
						provider.once(RooCodeEventName.TaskCreated, (task) => {
							resolve(task as Task);
						});
					});

					await vscode.commands.executeCommand("kilo-code.newTask", { prompt: message });

					const task = await taskPromise;

					// Send taskId as the first event
					res.write(`id: ${Date.now()}\n`);
					res.write(`event: taskId\n`);
					res.write(`data: ${JSON.stringify({ taskId: task.taskId })}\n\n`);

					// Send message history
					task.clineMessages.forEach((msg) => {
						res.write(`id: ${msg.ts}\n`);
						res.write(`data: ${JSON.stringify(msg)}\n\n`);
					});

					const listener = (e: { message: ClineMessage }) => {
						res.write(`id: ${e.message.ts}\n`);
						res.write(`data: ${JSON.stringify(e.message)}\n\n`);
					};

					task.on(RooCodeEventName.Message, listener);

					const heartbeat = setInterval(() => {
						res.write(":heartbeat\n\n");
					}, 10000);

					task.once(RooCodeEventName.TaskCompleted, () => {
						clearInterval(heartbeat);
						task.off(RooCodeEventName.Message, listener);
						res.end();
					});

					req.on("close", () => {
						clearInterval(heartbeat);
						task.off(RooCodeEventName.Message, listener);
						res.end();
					});
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: error.message }));
				}
			});
		} else if (req.method === "POST" && req.url === "/send-followup") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", async () => {
				try {
					const { taskId, message } = JSON.parse(body);
					const provider = await ClineProvider.getInstance();
					if (!provider) {
						res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Kilo Code is not running" }));
						return;
					}

					const task = provider.getCurrentTask();
					if (!task || task.taskId !== taskId) {
						res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Task not found" }));
						return;
					}

					task.handleWebviewAskResponse("messageResponse", message);
					res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ status: "ok" }));
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: error.message }));
				}
			});
		} else if (req.method === "POST" && req.url === "/cancel-task") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", async () => {
				try {
					const { taskId } = JSON.parse(body);
					const provider = await ClineProvider.getInstance();
					if (!provider) {
						res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Kilo Code is not running" }));
						return;
					}
					const task = provider.getCurrentTask();
					if (!task || task.taskId !== taskId) {
						res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Task not found" }));
						return;
					}

					await task.abortTask(true);
					res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ status: "ok" }));
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: error.message }));
				}
			});
		} else if (req.method === "GET" && req.url === "/tasks") {
			try {
				const provider = await ClineProvider.getInstance();
				if (!provider) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: "Kilo Code is not running" }));
					return;
				}
				const history = provider.getTaskHistory();
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify(history));
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: error.message }));
			}
		} else if (req.method === "GET" && req.url?.startsWith("/tasks/")) {
			const taskId = req.url.split("/")[2];
			if (!taskId) {
				res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: "Task ID is required" }));
				return;
			}
			try {
				const provider = await ClineProvider.getInstance();
				if (!provider) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: "Kilo Code is not running" }));
					return;
				}
				const task = await provider.getTaskWithId(taskId);
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify(task.uiMessages));
			} catch (error) {
				res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: "Task not found" }));
			}
		} else if (req.method === "GET" && req.url === "/modes") {
			try {
				const provider = await ClineProvider.getInstance();
				if (!provider) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: "Kilo Code is not running" }));
					return;
				}
				const modes = await provider.getModes();
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify(modes));
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json", "Access-control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: error.message }));
			}
		} else if (req.method === "POST" && req.url === "/modes") {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", async () => {
				try {
					const { mode } = JSON.parse(body);
					const provider = await ClineProvider.getInstance();
					if (!provider) {
						res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Kilo Code is not running" }));
						return;
					}
					const customModes = await provider.customModesManager.getCustomModes();
					const modeToSet = getModeBySlug(mode, customModes);
					if (!modeToSet) {
						res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ error: "Mode not found" }));
						return;
					}
					await provider.handleModeSwitch(modeToSet.slug as any);
					res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ status: "ok" }));
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: error.message }));
				}
			});
		} else if (req.method === "GET" && req.url === "/health") {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			const workspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : "No workspace open";
			res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
			res.end(JSON.stringify({ status: "ok", workspacePath }));
		} else if (req.method === "POST" && req.url?.startsWith("/tasks/") && req.url.endsWith("/condense")) {
			const taskId = req.url.split("/")[2];
			if (!taskId) {
				res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: "Task ID is required" }));
				return;
			}
			try {
				const provider = await ClineProvider.getInstance();
				if (!provider) {
					res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: "Kilo Code is not running" }));
					return;
				}
				const task = provider.getCurrentTask();
				if (!task || task.taskId !== taskId) {
					res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
					res.end(JSON.stringify({ error: "Task not found or not active" }));
					return;
				}
				await task.condenseContext();
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ status: "ok" }));
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ error: error.message }));
			}
		} else {
			res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
			res.end(JSON.stringify({ error: "Not Found" }));
		}
	});

	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => {
			sockets.delete(socket);
		});
	});

	server.on("error", (err) => {
		const msg = `Kilo Code Mobile Bridge error: ${err.message}`;
		getOutputChannel().appendLine(msg);
		vscode.window.showErrorMessage(msg);
		server = null;
	});

	server.listen(port, HOST, () => {
		const msg = `Kilo Code Mobile Bridge listening on http://${HOST}:${port}`;
		vscode.window.showInformationMessage(msg);
		channel.appendLine(msg);
	});
}

export function stopMobileBridge() {
	if (server) {
		for (const socket of sockets) {
			socket.destroy();
		}
		sockets.clear();
		server.close(() => {
			const msg = "Kilo Code Mobile Bridge stopped.";
			vscode.window.showInformationMessage(msg);
			getOutputChannel().appendLine(msg);
			server = null;
		});
	} else {
		const msg = "Kilo Code Mobile Bridge is not running.";
		getOutputChannel().appendLine(msg);
		vscode.window.showInformationMessage(msg);
	}
}
