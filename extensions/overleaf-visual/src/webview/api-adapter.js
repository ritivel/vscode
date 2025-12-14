/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');

class OverleafVisualApiAdapter {
	/**
	 * @param {vscode.Webview} webview
	 * @param {vscode.TextDocument} document
	 * @param {vscode.WorkspaceFolder | undefined} workspaceFolder
	 */
	constructor(webview, document, workspaceFolder) {
		this.webview = webview;
		this.document = document;
		this.workspaceFolder = workspaceFolder;
		this.isApplyingEditorChange = false;
		/** @type {Promise<void>} */
		this._pendingEdits = Promise.resolve();
	}

	isApplyingChange() {
		return this.isApplyingEditorChange;
	}

	tryHandleMessage(message) {
		if (!message || typeof message.type !== 'string') {
			return false;
		}
		if (message.type === 'overleafVisual.doc.applyEdits') {
			void this.handleDocumentEdit(message);
			return true;
		}
		if (message.type === 'overleafVisual.previewPath.request') {
			this.handlePreviewPathRequest(message);
			return true;
		}
		return false;
	}

	async handleDocumentEdit(message) {
		if (typeof message.fullText !== 'string') {
			return;
		}

		// Serialize incoming edits from the webview so callers (e.g. Compile) can await
		// a consistent "latest text is applied" point-in-time.
		this._pendingEdits = this._pendingEdits.then(async () => {
			this.isApplyingEditorChange = true;
			try {
				await this.applyEdits(message.fullText);
			} finally {
				this.isApplyingEditorChange = false;
			}
		});

		await this._pendingEdits;
	}

	async applyEdits(fullText) {
		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(
			this.document.positionAt(0),
			this.document.positionAt(this.document.getText().length)
		);
		edit.replace(this.document.uri, fullRange, fullText);
		try {
			await vscode.workspace.applyEdit(edit);
		} catch (err) {
			console.error('[overleaf-visual] Failed to apply edits to document', err);
		}
	}

	/**
	 * Await any in-flight edits received from the webview.
	 * @returns {Promise<void>}
	 */
	waitForPendingEdits() {
		return this._pendingEdits;
	}

	sendDocumentUpdate(content) {
		void this.webview.postMessage({
			type: 'overleafVisual.documentUpdate',
			content
		});
	}

	async handlePreviewPathRequest(message) {
		if (!this.workspaceFolder) {
			this.postPreviewPathResponse(message.id, null, null);
			return;
		}
		try {
			const { PreviewPathService } = require('../services/preview-path-service');
			const service = new PreviewPathService(this.workspaceFolder, this.webview);
			const uri = await service.resolvePreviewPath(message.path);
			const ext = service.guessExtension(message.path);
			this.postPreviewPathResponse(message.id, uri, ext);
		} catch (err) {
			console.error('[overleaf-visual] Failed to resolve preview path', err);
			this.postPreviewPathResponse(message.id, null, null);
		}
	}

	postPreviewPathResponse(id, uri, extension) {
		void this.webview.postMessage({
			type: 'overleafVisual.previewPath.response',
			id,
			uri,
			extension,
		});
	}
}

module.exports = { OverleafVisualApiAdapter };

