/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const { OverleafVisualEditorProvider } = require('./webview/webview-provider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			OverleafVisualEditorProvider.viewType,
			new OverleafVisualEditorProvider(context),
			{ supportsMultipleEditorsPerDocument: false }
		)
	);
}

function deactivate() { }

module.exports = { activate, deactivate };

