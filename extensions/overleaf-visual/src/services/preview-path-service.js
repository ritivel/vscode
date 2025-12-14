/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const path = require('node:path');

class PreviewPathService {
	/**
	 * @param {vscode.WorkspaceFolder | undefined} workspaceFolder
	 * @param {vscode.Webview} webview
	 */
	constructor(workspaceFolder, webview) {
		this.workspaceFolder = workspaceFolder;
		this.webview = webview;
	}

	async resolvePreviewPath(filePath) {
		if (!this.workspaceFolder) {
			return null;
		}
		try {
			let normalizedPath = filePath;
			if (normalizedPath.startsWith('/')) {
				normalizedPath = normalizedPath.slice(1);
			}

			const targetUri = vscode.Uri.joinPath(this.workspaceFolder.uri, normalizedPath);
			try {
				const stat = await vscode.workspace.fs.stat(targetUri);
				if (stat.type === vscode.FileType.File) {
					return this.webview.asWebviewUri(targetUri).toString();
				}
			} catch {
				return await this.tryImageExtensions(normalizedPath);
			}
			return null;
		} catch (err) {
			console.error(`[overleaf-visual] Failed to resolve preview path: ${filePath}`, err);
			return null;
		}
	}

	guessExtension(filePath) {
		const ext = path.extname(filePath);
		return ext ? ext.replace(/^\./, '').toLowerCase() : null;
	}

	async tryImageExtensions(basePath) {
		if (!this.workspaceFolder) {
			return null;
		}
		const ext = path.extname(basePath);
		const baseWithoutExt = ext ? basePath.slice(0, -ext.length) : basePath;
		const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.eps'];
		for (const imageExt of imageExtensions) {
			try {
				const candidateUri = vscode.Uri.joinPath(this.workspaceFolder.uri, `${baseWithoutExt}${imageExt}`);
				const stat = await vscode.workspace.fs.stat(candidateUri);
				if (stat.type === vscode.FileType.File) {
					return this.webview.asWebviewUri(candidateUri).toString();
				}
			} catch {
				// continue
			}
		}
		return null;
	}
}

module.exports = { PreviewPathService };

