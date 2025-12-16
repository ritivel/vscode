/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Webview global injected by VS Code
declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { LanguageSupport } from '@codemirror/language';

// Overleaf pieces we reuse
import { CodeMirrorStateContext, CodeMirrorViewContext } from '../../overleaf/services/web/frontend/js/features/source-editor/components/codemirror-context';
import EditorSwitch from '../../overleaf/services/web/frontend/js/features/source-editor/components/editor-switch';
import { ToolbarItems } from '../../overleaf/services/web/frontend/js/features/source-editor/components/toolbar/toolbar-items';
import { minimumListDepthForSelection } from '../../overleaf/services/web/frontend/js/features/source-editor/utils/tree-operations/ancestors';

import { EditorContext } from '../../overleaf/services/web/frontend/js/shared/context/editor-context';
import { ProjectContext } from '../../overleaf/services/web/frontend/js/shared/context/project-context';
import { PermissionsContext } from '../../overleaf/services/web/frontend/js/features/ide-react/context/permissions-context';
import { EditorPropertiesContext } from '../../overleaf/services/web/frontend/js/features/ide-react/context/editor-properties-context';
import { EditorOpenDocContext } from '../../overleaf/services/web/frontend/js/features/ide-react/context/editor-open-doc-context';
import type { Permissions } from '../../overleaf/services/web/frontend/js/features/ide-react/types/permissions';

import { LaTeXLanguage } from '../../overleaf/services/web/frontend/js/features/source-editor/languages/latex/latex-language';
import { insertFigure } from '../../overleaf/services/web/frontend/js/features/source-editor/extensions/toolbar/commands';
import { insertTable } from '../../overleaf/services/web/frontend/js/features/source-editor/extensions/toolbar/commands';
import { setVisual, visual } from '../../overleaf/services/web/frontend/js/features/source-editor/extensions/visual/visual';
import { languageLoadedEffect } from '../../overleaf/services/web/frontend/js/features/source-editor/extensions/language';
import type { PreviewPath } from '../../overleaf/services/web/types/preview-path';
import type { WritefullAPI } from '../../overleaf/services/web/frontend/js/shared/context/types/writefull-instance';

type DocumentUpdateMessage = { type: 'overleafVisual.documentUpdate'; content: string };
type DocumentEditMessage = { type: 'overleafVisual.doc.applyEdits'; fullText: string };
type PreviewPathRequestMessage = { type: 'overleafVisual.previewPath.request'; id: number; path: string };
type PreviewPathResponseMessage = { type: 'overleafVisual.previewPath.response'; id: number; uri: string | null; extension?: string | null };
type CompileRequestMessage = { type: 'overleafVisual.compile' };
type CompileStatusMessage = { type: 'overleafVisual.compile.status'; phase: 'start' | 'end'; ok?: boolean; message?: string };

const vscode = acquireVsCodeApi();

// Init i18n (keys will fall back to showing the key itself unless you add resources)
void i18next.use(initReactI18next).init({
	lng: 'en',
	fallbackLng: 'en',
	resources: {
		en: {
			translation: {
				code_editor: 'Code',
				visual_editor: 'Visual',
				toolbar_code_visual_editor_switch: 'Editor mode',
				toolbar_change_editor_mode: 'Change editor mode',
				visual_editor_is_only_available_for_tex_files: 'Visual editor is only available for .tex files',

				toolbar_undo_redo_actions: 'Undo/Redo',
				toolbar_undo: 'Undo',
				toolbar_redo: 'Redo',

				toolbar_text_formatting: 'Section',
				toolbar_text_style: 'Formatting',
				toolbar_bold: 'Bold',
				toolbar_italic: 'Italic',

				toolbar_insert_math_and_symbols: 'Math',
				toolbar_insert_symbol: 'Insert symbol',

				toolbar_insert_misc: 'Insert',
				toolbar_insert_link: 'Insert link',
				toolbar_insert_cross_reference: 'Insert reference',
				toolbar_insert_citation: 'Insert citation',
				toolbar_insert_figure: 'Insert figure',
				toolbar_insert_table: 'Insert table',
				toolbar_generate_table: 'Generate table',
				upload_from_computer: 'Upload from computer',
				from_project_files: 'From project files',
				from_another_project: 'From another project',
				from_url: 'From URL',
				generate_from_text: 'Generate from text',
				generate_from_text_or_image: 'Generate from text or image',
				select_size: 'Select size',
				toolbar_table_insert_table_lowercase: 'Insert table',
				toolbar_table_insert_size_table: 'Insert {{size}} table',

				toolbar_list_indentation: 'Lists',
				toolbar_bulleted_list: 'Bulleted list',
				toolbar_numbered_list: 'Numbered list',
				toolbar_decrease_indent: 'Decrease indent',
				toolbar_increase_indent: 'Increase indent',

				loading: 'Loading',
				ok: 'OK',
			},
		},
	},
	interpolation: { escapeValue: false },
});

const rootEl = document.getElementById('overleaf-visual-root');
if (!rootEl) {
	throw new Error('Missing #overleaf-visual-root');
}

const isDarkTheme =
	document.body.classList.contains('vscode-dark') ||
	document.body.classList.contains('vscode-high-contrast') ||
	document.body.classList.contains('vscode-high-contrast-light'); // treat HC light as "dark-like" for contrast

function WebviewApp() {
	const editorHostRef = useRef<HTMLDivElement | null>(null);
	const [view, setView] = useState<EditorView | null>(null);
	const [state, setState] = useState<EditorState>(() => EditorState.create());
	const viewRef = useRef<EditorView | null>(null);

	const [showVisual, setShowVisual] = useState(true);
	const [isCompiling, setIsCompiling] = useState(false);
	const [compileStatus, setCompileStatus] = useState<string>('Ready');
	const compileTimeoutRef = useRef<number | null>(null);

	// Document sync:
	// - The extension replies to `{ type: 'ready' }` with `overleafVisual.documentUpdate`.
	// - That message can arrive before CodeMirror is constructed; queue it.
	// - Applying `documentUpdate` should not echo back `doc.applyEdits` (which can mark the file dirty).
	const pendingInitialContent = useRef<string | null>(null);
	const isApplyingExternalUpdate = useRef(false);

	// Preview-by-path bridge
	const requestIdRef = useRef(0);
	const pendingPreview = useRef(new Map<number, (value: PreviewPath | null) => void>());
	const previewByPath = useCallback((p: string): PreviewPath | null => {
		// Overleaf expects a synchronous function. We provide a synchronous cache-less stub:
		// return a placeholder immediately, then the widget will re-render on view.requestMeasure()
		// when the asset is available in the filesystem.
		// For now, do a best-effort async request and return null.
		void new Promise<PreviewPath | null>((resolve) => {
			const id = ++requestIdRef.current;
			pendingPreview.current.set(id, resolve);
			const msg: PreviewPathRequestMessage = { type: 'overleafVisual.previewPath.request', id, path: p };
			vscode.postMessage(msg);
			setTimeout(() => {
				if (pendingPreview.current.has(id)) {
					pendingPreview.current.delete(id);
					resolve(null);
				}
			}, 2000);
		});
		return null;
	}, []);

	const applyExternalContentToView = useCallback((targetView: EditorView, content: string) => {
		const current = targetView.state.doc.toString();
		if (current === content) {
			return;
		}
		isApplyingExternalUpdate.current = true;
		try {
			targetView.dispatch({
				changes: { from: 0, to: targetView.state.doc.length, insert: content },
				selection: targetView.state.selection,
			});
		} finally {
			isApplyingExternalUpdate.current = false;
		}
	}, []);

	// Create CodeMirror view once
	useEffect(() => {
		if (!editorHostRef.current || view) {
			return;
		}

		const languageSupport = new LanguageSupport(LaTeXLanguage);

		const initial = EditorState.create({
			doc: '',
			extensions: [
				// Needed so Overleaf themes that use &dark/&light selectors apply correctly
				// (e.g. table generator theme variables).
				EditorView.theme({}, { dark: isDarkTheme }),
				EditorView.lineWrapping,
				history(),
				languageSupport,
				EditorState.phrases.of({
					sorry_your_table_cant_be_displayed_at_the_moment: "Sorry, your table can't be displayed at the moment.",
					this_could_be_because_we_cant_support_some_elements_of_the_table: "This could be because we can't support some elements of the table.",
				}),
				// Install Overleaf visual mode support, and default to Visual=true.
				visual({ visual: true, previewByPath }),
			],
		});

		const cm = new EditorView({
			state: initial,
			dispatchTransactions: (trs) => {
				cm.update(trs);
				setState(cm.state);
				// Send doc updates to extension host
				if (!isApplyingExternalUpdate.current && trs.some(t => t.docChanged)) {
					const fullText = cm.state.doc.toString();
					const msg: DocumentEditMessage = { type: 'overleafVisual.doc.applyEdits', fullText };
					vscode.postMessage(msg);
				}
			},
			parent: editorHostRef.current,
		});

		// If the extension already sent initial content before CodeMirror was ready, apply it now.
		if (pendingInitialContent.current !== null) {
			applyExternalContentToView(cm, pendingInitialContent.current);
			pendingInitialContent.current = null;
		}

		viewRef.current = cm;
		setView(cm);
		setState(cm.state);
	}, [applyExternalContentToView, previewByPath, view]);

	// React -> CodeMirror toggle visual mode (Overleaf-controlled)
	useEffect(() => {
		if (!view) {
			return;
		}
		view.dispatch(setVisual({ visual: showVisual, previewByPath }));
		// Overleaf's visual mode waits for a "language loaded" signal before forcing a full parse and
		// showing content. In this webview we load the language eagerly (via `LaTeXLanguage`) so that
		// signal never happens naturally; emit it on (re)entering visual mode so toggling is instant.
		if (showVisual) {
			view.dispatch({ effects: [languageLoadedEffect.of(null)] });
		}
	}, [previewByPath, showVisual, view]);

	// Emit "language loaded" once on startup so the initial Visual render doesn't wait.
	useEffect(() => {
		if (!view) {
			return;
		}
		view.dispatch({ effects: [languageLoadedEffect.of(null)] });
	}, [view]);

	// Webview message handling
	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const msg = event.data as DocumentUpdateMessage | PreviewPathResponseMessage | CompileStatusMessage;

			if (msg?.type === 'overleafVisual.documentUpdate') {
				const activeView = viewRef.current;
				if (!activeView) {
					// Queue latest content until CodeMirror is ready.
					pendingInitialContent.current = msg.content;
					return;
				}
				applyExternalContentToView(activeView, msg.content);
				return;
			}

			if (msg?.type === 'overleafVisual.previewPath.response') {
				const resolve = pendingPreview.current.get(msg.id);
				if (resolve) {
					pendingPreview.current.delete(msg.id);
					if (msg.uri && msg.extension) {
						resolve({ url: msg.uri, extension: msg.extension });
					} else {
						resolve(null);
					}
					// Ask CodeMirror to re-measure; many widgets call requestMeasure after async work.
					activeView?.requestMeasure();
				}
			}

			if (msg?.type === 'overleafVisual.compile.status') {
				if (msg.phase === 'start') {
					setIsCompiling(true);
					setCompileStatus('Compiling…');
					if (compileTimeoutRef.current) {
						window.clearTimeout(compileTimeoutRef.current);
					}
					compileTimeoutRef.current = window.setTimeout(() => {
						setIsCompiling(false);
						setCompileStatus('Compile timed out.');
						compileTimeoutRef.current = null;
					}, 120_000);
					return;
				}
				if (msg.phase === 'end') {
					setIsCompiling(false);
					if (compileTimeoutRef.current) {
						window.clearTimeout(compileTimeoutRef.current);
						compileTimeoutRef.current = null;
					}
					if (msg.ok) {
						setCompileStatus('Compiled.');
					} else {
						setCompileStatus(msg.message ? `Compile failed: ${msg.message}` : 'Compile failed.');
					}
					return;
				}
			}
		};

		window.addEventListener('message', onMessage);
		// Request initial document content only after the message handler is registered,
		// so we don't miss the extension's first `documentUpdate` reply.
		vscode.postMessage({ type: 'ready' });
		return () => window.removeEventListener('message', onMessage);
	}, [applyExternalContentToView]);

	// Make "Insert figure" work without Overleaf's modal stack:
	// Overleaf's toolbar dispatches a `figure-modal:open` event, expecting a modal to handle it.
	// In this standalone webview, we just insert a standard snippet at the cursor.
	useEffect(() => {
		if (!view) {
			return;
		}
		const onOpenFigureModal = () => {
			try {
				insertFigure(view);
				view.focus();
			} catch (err) {
				console.error('[overleaf-visual] insertFigure failed', err);
			}
		};
		window.addEventListener('figure-modal:open', onOpenFigureModal);
		return () => window.removeEventListener('figure-modal:open', onOpenFigureModal);
	}, [view]);

	// Minimal "Writefull" API stub, used by Overleaf to expose the Table Generator entrypoint.
	// We don't have the Writefull backend here, but we can still provide the same UX surface:
	// click "Generate from text or image" -> show a simple size prompt -> insert a table.
	const writefullInstance = useMemo<WritefullAPI>(() => {
		const listeners = new Map<string, Set<(detail: any) => void>>();
		return {
			addEventListener(name, callback) {
				const set = listeners.get(name) ?? new Set();
				set.add(callback as any);
				listeners.set(name, set);
			},
			removeEventListener(name, callback) {
				listeners.get(name)?.delete(callback as any);
			},
			openTableGenerator() {
				window.dispatchEvent(new CustomEvent('overleafVisual.tableGenerator.open'));
			},
			openEquationGenerator() {
				alert('Equation generator is not implemented yet in overleaf-visual.');
			},
			openFigureGenerator() {
				alert('Figure generator is not implemented yet in overleaf-visual.');
			},
		};
	}, []);

	useEffect(() => {
		if (!view) {
			return;
		}
		const onOpen = () => {
			const colsRaw = prompt('Table columns?', '3');
			const rowsRaw = prompt('Table rows?', '3');
			const cols = Math.max(1, Number.parseInt(colsRaw ?? '3', 10) || 3);
			const rows = Math.max(1, Number.parseInt(rowsRaw ?? '3', 10) || 3);
			try {
				insertTable(view, cols, rows);
				view.focus();
			} catch (err) {
				console.error('[overleaf-visual] insertTable failed', err);
			}
		};
		window.addEventListener('overleafVisual.tableGenerator.open', onOpen as EventListener);
		return () => window.removeEventListener('overleafVisual.tableGenerator.open', onOpen as EventListener);
	}, [view]);

	// Basic stubs to satisfy Overleaf context consumers used by the toolbar
	const permissions: Permissions = useMemo(() => ({
		read: true,
		write: true,
		admin: false,
		comment: true,
		resolveOwnComments: true,
		resolveAllComments: true,
		trackedWrite: true,
		labelVersion: false,
	}), []);

	const projectValue = useMemo(() => ({
		projectId: 'local-project',
		project: null,
		joinProject: () => undefined,
		updateProject: () => undefined,
		joinedOnce: true,
		projectSnapshot: {} as any,
		tags: [],
		features: { trackChangesVisible: false } as any,
		name: 'Local Project',
	}), []);

	const editorValue = useMemo(() => ({
		renameProject: () => undefined,
		isProjectOwner: true,
		isPendingEditor: false,
		deactivateTutorial: () => undefined,
		inactiveTutorials: [],
		currentPopup: null,
		setCurrentPopup: () => undefined,
		hasPremiumSuggestion: false,
		setHasPremiumSuggestion: () => undefined,
		setPremiumSuggestionResetDate: () => undefined,
		premiumSuggestionResetDate: new Date(),
		writefullInstance,
		setWritefullInstance: () => undefined,
	}), [writefullInstance]);

	const editorPropsValue = useMemo(() => ({
		showVisual,
		setShowVisual,
		showSymbolPalette: false,
		setShowSymbolPalette: () => undefined,
		toggleSymbolPalette: () => undefined,
		opening: false,
		setOpening: () => undefined,
		trackChanges: false,
		setTrackChanges: () => undefined,
		wantTrackChanges: false,
		setWantTrackChanges: () => undefined,
		errorState: false,
		setErrorState: () => undefined,
	}), [showVisual]);

	const openDocValue = useMemo(() => ({
		currentDocumentId: 'doc',
		setCurrentDocumentId: () => undefined,
		openDocName: 'main.tex',
		setOpenDocName: () => undefined,
		currentDocument: null,
		setCurrentDocument: () => undefined,
	}), []);

	const languageName = 'latex';
	const listDepth = minimumListDepthForSelection(state);

	return (
		<I18nextProvider i18n={i18next}>
			<ProjectContext.Provider value={projectValue as any}>
				<PermissionsContext.Provider value={permissions}>
					<EditorContext.Provider value={editorValue as any}>
						<EditorPropertiesContext.Provider value={editorPropsValue as any}>
							<EditorOpenDocContext.Provider value={openDocValue as any}>
								<CodeMirrorStateContext.Provider value={state}>
									<CodeMirrorViewContext.Provider value={view ?? undefined}>
										<div className="ov-toolbar">
											<EditorSwitch />
											{view && (
												<ToolbarItems
													state={state}
													languageName={languageName}
													visual={showVisual}
													listDepth={listDepth}
												/>
											)}
											<div style={{ flex: 1 }} />
											<button
												type="button"
												className="ov-btn primary"
												title="Compile and open PDF preview"
												disabled={isCompiling}
												onClick={() => {
													const msg: CompileRequestMessage = { type: 'overleafVisual.compile' };
													vscode.postMessage(msg);
													// Optimistic UI: show progress instantly, even before the extension replies.
													setIsCompiling(true);
													setCompileStatus('Compiling…');
												}}
											>
												{isCompiling ? (
													<span className="ov-inline">
														<span className="ov-spinner" aria-hidden="true" />
														Compiling…
													</span>
												) : (
													'Compile'
												)}
											</button>
										</div>
										<div className="ov-editor" ref={editorHostRef} />
										<div className="ov-status">
											Overleaf Visual Editor (local) - {compileStatus}
										</div>
									</CodeMirrorViewContext.Provider>
								</CodeMirrorStateContext.Provider>
							</EditorOpenDocContext.Provider>
						</EditorPropertiesContext.Provider>
					</EditorContext.Provider>
				</PermissionsContext.Provider>
			</ProjectContext.Provider>
		</I18nextProvider>
	);
}

createRoot(rootEl).render(<WebviewApp />);

// Stub Overleaf global events for actions we haven't implemented yet
window.addEventListener('add-new-review-comment', (e) => {
	console.warn('[overleaf-visual] add-new-review-comment (not implemented)', e);
	alert('Comments are not implemented yet in overleaf-visual.');
});

