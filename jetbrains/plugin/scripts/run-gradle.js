#!/usr/bin/env node

/**
 * Cross-platform Gradle wrapper script that checks for Java availability
 * before running Gradle commands. This allows the JetBrains plugin build
 * to gracefully skip when Java is not installed (e.g., when building only
 * the VSCode extension).
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the command to run from command line arguments
const args = process.argv.slice(2);
const command = args.join(' ');

if (!command) {
	console.error('Usage: node scripts/run-gradle.js <gradle-command>');
	process.exit(1);
}

// Check if Java is available
function checkJava() {
	return new Promise((resolve) => {
		const javaProcess = spawn('java', ['-version'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			shell: true,
		});

		let output = '';
		let error = '';

		javaProcess.stdout.on('data', (data) => {
			output += data.toString();
		});

		javaProcess.stderr.on('data', (data) => {
			error += data.toString();
		});

		javaProcess.on('close', (code) => {
			// Java -version outputs to stderr on most systems
			const versionOutput = error || output;
			resolve(code === 0 && versionOutput.includes('version'));
		});

		javaProcess.on('error', () => {
			resolve(false);
		});

		// Timeout after 5 seconds
		setTimeout(() => {
			javaProcess.kill();
			resolve(false);
		}, 5000);
	});
}

// Run Gradle command
function runGradle(command) {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32';
		const gradleCmd = isWindows ? 'gradlew.bat' : './gradlew';

		const gradleProcess = spawn(gradleCmd, args, {
			stdio: 'inherit',
			shell: true,
			cwd: path.join(__dirname, '..'),
		});

		gradleProcess.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Gradle command exited with code ${code}`));
			}
		});

		gradleProcess.on('error', (err) => {
			reject(err);
		});
	});
}

async function main() {
	const javaAvailable = await checkJava();

	if (!javaAvailable) {
		console.warn('Warning: Java is not installed or not available in PATH.');
		console.warn('Skipping Gradle command:', command);
		console.warn('This is expected if you are only building the VSCode extension.');
		process.exit(0);
	}

	try {
		await runGradle(command);
	} catch (error) {
		console.error('Gradle command failed:', error.message);
		process.exit(1);
	}
}

main();
