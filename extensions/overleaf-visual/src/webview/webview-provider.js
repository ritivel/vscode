/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { OverleafVisualApiAdapter } = require('./api-adapter');

class OverleafVisualEditorProvider {
	static viewType = 'overleafVisual.editor';

	/**
	 * @param {vscode.ExtensionContext} context
	 */
	constructor(context) {
		this.context = context;
		/** @type {Map<string, Promise<void>>} */
		this._compileInFlight = new Map();
	}

	/**
	 * @param {vscode.TextDocument} document
	 * @param {vscode.WebviewPanel} webviewPanel
	 * @param {vscode.CancellationToken} _token
	 */
	async resolveCustomTextEditor(document, webviewPanel, _token) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this.context.extensionUri,
				...(workspaceFolder ? [workspaceFolder.uri] : []),
				vscode.Uri.joinPath(document.uri, '..'),
			],
		};

		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		const apiAdapter = new OverleafVisualApiAdapter(webviewPanel.webview, document, workspaceFolder);

		webviewPanel.webview.onDidReceiveMessage((message) => {
			if (apiAdapter.tryHandleMessage(message)) {
				return;
			}
			if (message && message.type === 'overleafVisual.compile') {
				void this.compileAndShowPdf(document, webviewPanel, workspaceFolder, apiAdapter);
				return;
			}
			if (message && message.type === 'ready') {
				apiAdapter.sendDocumentUpdate(document.getText());
			}
		});

		let updateTimeout;
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (apiAdapter.isApplyingChange()) {
				return;
			}
			if (updateTimeout) {
				clearTimeout(updateTimeout);
			}
			updateTimeout = setTimeout(() => {
				apiAdapter.sendDocumentUpdate(e.document.getText());
			}, 100);
		});

		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
			if (updateTimeout) {
				clearTimeout(updateTimeout);
			}
		});
	}

	/**
	 * Compile current .tex document and open the resulting PDF beside the editor.
	 * Prefers LaTeX-Workshop build; falls back to `tectonic` CLI.
	 *
	 * @param {vscode.TextDocument} document
	 * @param {vscode.WebviewPanel} webviewPanel
	 * @param {vscode.WorkspaceFolder | undefined} workspaceFolder
	 * @param {OverleafVisualApiAdapter} apiAdapter
	 */
	async compileAndShowPdf(document, webviewPanel, workspaceFolder, apiAdapter) {
		const texPath = document.uri.fsPath;
		const compileKey = document.uri.toString();

		// Avoid overlapping compiles (rapid clicks can cause "sometimes it works" behavior)
		if (this._compileInFlight.has(compileKey)) {
			return;
		}

		const run = (async () => {
			let ok = false;
			let detail = undefined;
			try {
				void webviewPanel.webview.postMessage({ type: 'overleafVisual.compile.status', phase: 'start' });

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Window,
						title: 'Compiling LaTeX…',
						cancellable: false,
					},
					async () => {
						// Ensure latest edits from the webview are applied before saving/compiling.
						await apiAdapter.waitForPendingEdits();

						// Ensure latest edits are on disk
						await document.save();

						// Prefer LaTeX-Workshop (handles more toolchains/configs); fall back to Tectonic for fast local builds.
						const pdfPath =
							(await this.compileWithLatexWorkshop(texPath, workspaceFolder)) ??
							(await this.compileWithTectonic(texPath));

						if (!pdfPath) {
							detail = 'LaTeX compile failed (no PDF produced).';
							void vscode.window.showErrorMessage(detail);
							return;
						}

						await this.openPdfBeside(pdfPath, webviewPanel);
						ok = true;
					}
				);
			} catch (err) {
				detail = err instanceof Error ? err.message : String(err);
				console.error('[overleaf-visual] compileAndShowPdf failed', err);
				void vscode.window.showErrorMessage('LaTeX compile failed (unexpected error).');
			} finally {
				void webviewPanel.webview.postMessage({
					type: 'overleafVisual.compile.status',
					phase: 'end',
					ok,
					message: detail,
				});
			}
		})();

		this._compileInFlight.set(compileKey, run);
		try {
			await run;
		} finally {
			this._compileInFlight.delete(compileKey);
		}
	}

	/**
	 * @param {string} texPath
	 * @param {vscode.WorkspaceFolder | undefined} workspaceFolder
	 * @returns {Promise<string | null>}
	 */
	async compileWithLatexWorkshop(texPath, workspaceFolder) {
		try {
			const latexWorkshopExtension = vscode.extensions.getExtension('James-Yu.latex-workshop');
			if (!latexWorkshopExtension) {
				return null;
			}

			if (!latexWorkshopExtension.isActive) {
				await latexWorkshopExtension.activate();
			}

			const texUri = vscode.Uri.file(texPath);
			const document = await vscode.workspace.openTextDocument(texUri);
			await document.save();

			// Give LaTeX-Workshop time to notice the file
			await new Promise((resolve) => setTimeout(resolve, 300));

			// Trigger build
			await vscode.commands.executeCommand('latex-workshop.build', false, texPath, 'latex');

			// Determine likely PDF output locations
			const texDir = path.dirname(texPath);
			const texBasename = path.basename(texPath, '.tex');
			const candidatePdfPaths = new Set();
			candidatePdfPaths.add(path.join(texDir, `${texBasename}.pdf`));

			try {
				const cfg = vscode.workspace.getConfiguration('latex-workshop', texUri);
				const outDirRaw = cfg.get('latex.outDir');
				if (typeof outDirRaw === 'string' && outDirRaw.trim()) {
					let outDir = outDirRaw;
					if (outDir.includes('%DIR%')) {
						outDir = outDir.replaceAll('%DIR%', texDir);
					} else if (!path.isAbsolute(outDir)) {
						// Best-effort: treat as relative to the root .tex file directory
						outDir = path.join(texDir, outDir);
					}
					candidatePdfPaths.add(path.join(outDir, `${texBasename}.pdf`));
				}
			} catch {
				// ignore and fall back to default candidate
			}

			// Wait for PDF to appear (LaTeX-Workshop build is async)
			const timeoutMs = 60_000;
			const stepMs = 500;
			const start = Date.now();
			while (Date.now() - start < timeoutMs) {
				for (const pdfPath of candidatePdfPaths) {
					try {
						await vscode.workspace.fs.stat(vscode.Uri.file(pdfPath));
						return pdfPath;
					} catch {
						// continue
					}
				}
				await new Promise((resolve) => setTimeout(resolve, stepMs));
			}

			return null;
		} catch (err) {
			console.error('[overleaf-visual] LaTeX-Workshop build failed', err);
			return null;
		}
	}

	/**
	 * @param {string} texPath
	 * @returns {Promise<string | null>}
	 */
	async compileWithTectonic(texPath) {
		const texDir = path.dirname(texPath);
		const texBasename = path.basename(texPath, '.tex');
		const pdfPath = path.join(texDir, `${texBasename}.pdf`);

		return await new Promise((resolve) => {
			let settled = false;
			const tectonicCommand = this.resolveTectonicCommand();
			// Enable SyncTeX so PDF -> source sync features (e.g. ctrl/cmd+click in viewers) work.
			// Without this, Tectonic produces a PDF but no `.synctex.gz`, leading to SyncTeX failures.
			const proc = spawn(tectonicCommand, ['-X', 'compile', '--synctex', texPath, '--outdir', texDir], {
				cwd: texDir,
				shell: process.platform === 'win32',
			});

			let stderr = '';
			proc.stderr.on('data', (d) => (stderr += String(d)));

			proc.on('error', (e) => {
				if (settled) {
					return;
				}
				settled = true;
				console.error('[overleaf-visual] Failed to run tectonic', e);

				const isSystem = tectonicCommand === 'tectonic' || tectonicCommand === 'tectonic.exe';
				void vscode.window.showErrorMessage(
					isSystem
						? 'Tectonic was not found on PATH. Install it, or use the bundled Tectonic from LaTeX-Workshop.'
						: `Failed to run Tectonic at: ${tectonicCommand}`
				);
				resolve(null);
			});

			proc.on('close', async (code) => {
				if (settled) {
					return;
				}
				settled = true;
				if (code !== 0) {
					const stderrPreview = stderr.length > 8000 ? `${stderr.slice(0, 8000)}\n…(stderr truncated)…` : stderr;
					console.error(`[overleaf-visual] tectonic exited non-zero (code=${code}). stderr:\n${stderrPreview}`);
					void vscode.window.showErrorMessage(`Tectonic failed (exit code ${code}). See Developer Tools console for stderr.`);
					resolve(null);
					return;
				}

				try {
					await vscode.workspace.fs.stat(vscode.Uri.file(pdfPath));
					resolve(pdfPath);
				} catch {
					resolve(null);
				}
			});
		});
	}

	/**
	 * Resolve a Tectonic executable to run.
	 *
	 * Mirrors LaTeX-Workshop's approach:
	 * - Prefer an explicit override (`OVERLEAF_TECTONIC_PATH`)
	 * - Prefer LaTeX-Workshop's bundled Tectonic binary (if present)
	 * - Fall back to system `tectonic`
	 */
	resolveTectonicCommand() {
		// Allow an explicit override for local dev.
		const envOverride = process.env.OVERLEAF_TECTONIC_PATH;
		if (envOverride && typeof envOverride === 'string') {
			const candidate = envOverride.trim();
			if (candidate) {
				try {
					if (fs.existsSync(candidate)) {
						return candidate;
					}
				} catch {
					// ignore
				}
			}
		}

		// Prefer LaTeX-Workshop's bundled Tectonic, if available.
		try {
			const lw = vscode.extensions.getExtension('James-Yu.latex-workshop');
			if (lw) {
				const platform = process.platform;
				const arch = process.arch;
				let platformDir;
				let binaryName;

				if (platform === 'darwin') {
					platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
					binaryName = 'tectonic';
				} else if (platform === 'linux') {
					// LaTeX-Workshop currently ships linux-x64 in this repo.
					platformDir = 'linux-x64';
					binaryName = 'tectonic';
				} else if (platform === 'win32') {
					platformDir = 'win32-x64';
					binaryName = 'tectonic.exe';
				}

				if (platformDir && binaryName) {
					const bundled = path.join(lw.extensionPath, 'binaries', platformDir, binaryName);
					if (fs.existsSync(bundled)) {
						// Ensure executable on Unix systems.
						if (platform !== 'win32') {
							try {
								fs.chmodSync(bundled, 0o755);
							} catch {
								// ignore
							}
						}
						return bundled;
					}
				}
			}
		} catch (err) {
			console.error('[overleaf-visual] Failed to resolve bundled tectonic', err);
		}

		// System fallback.
		return process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
	}

	/**
	 * @param {string} pdfPath
	 * @param {vscode.WebviewPanel} webviewPanel
	 */
	async openPdfBeside(pdfPath, webviewPanel) {
		const pdfUri = vscode.Uri.file(pdfPath);

		// Prefer LaTeX-Workshop PDF viewer hook if available; otherwise rely on VS Code PDF viewer.
		try {
			await vscode.commands.executeCommand('vscode.openWith', pdfUri, 'latex-workshop-pdf-hook', {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: false,
			});
			return;
		} catch {
			// ignore
		}

		try {
			const doc = await vscode.workspace.openTextDocument(pdfUri);
			await vscode.window.showTextDocument(doc, {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: false,
				preview: true,
			});
		} catch (err) {
			console.error('[overleaf-visual] Failed to open PDF', err);
			void vscode.window.showErrorMessage(`Failed to open PDF: ${pdfPath}`);
		}
	}

	/**
	 * @param {vscode.Webview} webview
	 */
	getHtmlForWebview(webview) {
		const nonce = this.getNonce();
		const cspSource = webview.cspSource;

		const htmlUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'overleaf-visual-ui.html');
		const htmlTemplate = fs.readFileSync(htmlUri.fsPath, 'utf8');

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'bundled', 'overleaf-visual-webview', 'index.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'bundled', 'overleaf-visual-webview', 'styles.css'));
		const mathJaxUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'mathjax', 'es5', 'tex-svg-full.js'));

		return htmlTemplate
			.replaceAll('{{cspSource}}', cspSource)
			.replaceAll('{{nonce}}', nonce)
			.replaceAll('{{scriptUri}}', String(scriptUri))
			.replaceAll('{{styleUri}}', String(styleUri))
			.replaceAll('{{mathJaxUri}}', String(mathJaxUri));
	}

	getNonce() {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}

module.exports = { OverleafVisualEditorProvider };

