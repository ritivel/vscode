/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

import path from 'node:path';
import fs from 'node:fs';
import { buildParserFile } from '@lezer/generator';
import { run } from '../esbuild-webview-common.mjs';

const srcDir = path.join(import.meta.dirname, 'webview-src');
const outDir = path.join(import.meta.dirname, 'bundled');

const overleafFrontendJsRoot = path.join(
	import.meta.dirname,
	'..',
	'overleaf',
	'services',
	'web',
	'frontend',
	'js'
);

const overleafRoot = path.join(import.meta.dirname, '..', 'overleaf');

function ensureLezerParsers() {
	/** @type {Array<{ grammarPath: string; parserOutputPath: string; termsOutputPath: string }>} */
	const grammars = [
		{
			grammarPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-latex',
				'latex.grammar'
			),
			parserOutputPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-latex',
				'latex.mjs'
			),
			termsOutputPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-latex',
				'latex.terms.mjs'
			),
		},
		{
			grammarPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-bibtex',
				'bibtex.grammar'
			),
			parserOutputPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-bibtex',
				'bibtex.mjs'
			),
			termsOutputPath: path.join(
				overleafFrontendJsRoot,
				'features',
				'source-editor',
				'lezer-bibtex',
				'bibtex.terms.mjs'
			),
		},
	];

	for (const g of grammars) {
		// Only generate when missing so we don't dirty the working tree on every build.
		if (fs.existsSync(g.parserOutputPath) && fs.existsSync(g.termsOutputPath)) {
			continue;
		}

		const grammarText = fs.readFileSync(g.grammarPath, 'utf8');
		const { parser, terms } = buildParserFile(grammarText, {
			fileName: g.grammarPath,
			moduleStyle: 'es',
		});
		fs.writeFileSync(g.parserOutputPath, parser);
		fs.writeFileSync(g.termsOutputPath, terms);
	}
}

/** @type {import('esbuild').Plugin} */
const overleafAliasPlugin = {
	name: 'overleaf-alias',
	setup(build) {
		// Map Overleaf webpack alias "@" -> services/web/frontend/js
		build.onResolve({ filter: /^@\// }, (args) => {
			const candidate = path.join(overleafFrontendJsRoot, args.path.slice(2));

			// Because we override resolution here, we must emulate extension resolution.
			// Overleaf sources commonly import without an explicit extension.
			const tryPaths = [
				candidate,
				`${candidate}.ts`,
				`${candidate}.tsx`,
				`${candidate}.js`,
				`${candidate}.jsx`,
				path.join(candidate, 'index.ts'),
				path.join(candidate, 'index.tsx'),
				path.join(candidate, 'index.js'),
				path.join(candidate, 'index.jsx'),
			];
			for (const p of tryPaths) {
				try {
					if (fs.existsSync(p)) {
						return { path: p };
					}
				} catch {
					// ignore
				}
			}

			// Let esbuild report a useful error.
			return { path: candidate };
		});
	},
};

/** @type {import('esbuild').Plugin} */
const overleafWorkspacePackagesPlugin = {
	name: 'overleaf-workspace-packages',
	setup(build) {
		build.onResolve({ filter: /^overleaf-editor-core$/ }, () => {
			return {
				path: path.join(overleafRoot, 'libraries', 'overleaf-editor-core', 'index.js'),
			};
		});

		// Minimal set needed by overleaf-editor-core and some frontend bits.
		build.onResolve({ filter: /^@overleaf\/o-error$/ }, () => {
			return {
				path: path.join(overleafRoot, 'libraries', 'o-error', 'index.cjs'),
			};
		});
	},
};

/** @type {import('esbuild').Plugin} */
const overleafMacroStubPlugin = {
	name: 'overleaf-macro-stub',
	setup(build) {
		// Overleaf uses a Babel macro to import optional modules. For this extension we
		// ship no optional Overleaf modules, so stub it to an empty list.
		build.onResolve({ filter: /import-overleaf-module\.macro$/ }, () => {
			return { path: 'import-overleaf-module.macro', namespace: 'overleaf-macro-stub' };
		});
		build.onLoad({ filter: /.*/, namespace: 'overleaf-macro-stub' }, () => {
			return {
				contents: `
export default function importOverleafModules() { return []; }
`,
				loader: 'js',
			};
		});
	},
};

ensureLezerParsers();

run({
	entryPoints: [
		{ in: path.join(srcDir, 'index.tsx'), out: 'overleaf-visual-webview/index' },
		{ in: path.join(srcDir, 'styles.css'), out: 'overleaf-visual-webview/styles' },
	],
	srcDir,
	outdir: outDir,
	additionalOptions: {
		plugins: [overleafAliasPlugin, overleafWorkspacePackagesPlugin, overleafMacroStubPlugin],
		// Keep the bundle readable while we are integrating Overleaf's code.
		// (Common webview build defaults to minified output.)
		minify: false,
		sourcemap: true,
		// Overleaf TSX often uses named React imports only; using the automatic runtime avoids
		// requiring a global `React` for JSX transforms.
		jsx: 'automatic',
		// IMPORTANT: Overleaf sources live in a sibling subtree, so normal node module
		// resolution won't find our extension-local dependencies. Provide explicit lookup paths.
		nodePaths: [
			path.join(import.meta.dirname, 'node_modules'),
			path.join(import.meta.dirname, '..', '..', 'node_modules'),
		],
		loader: {
			'.css': 'css',
			'.svg': 'dataurl',
			'.woff': 'file',
			'.woff2': 'file',
			'.ttf': 'file',
			'.eot': 'file',
		},
	},
}, process.argv);

