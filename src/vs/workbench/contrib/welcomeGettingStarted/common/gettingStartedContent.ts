/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import themePickerContent from './media/theme_picker.js';
import themePickerSmallContent from './media/theme_picker_small.js';
import notebookProfileContent from './media/notebookProfile.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import product from '../../../../platform/product/common/product.js';

interface IGettingStartedContentProvider {
	(): string;
}

const defaultChat = {
	documentationUrl: product.defaultChatAgent?.documentationUrl ?? '',
	manageSettingsUrl: product.defaultChatAgent?.manageSettingsUrl ?? '',
	provider: product.defaultChatAgent?.provider ?? { default: { name: '' } },
	publicCodeMatchesUrl: product.defaultChatAgent?.publicCodeMatchesUrl ?? '',
	termsStatementUrl: product.defaultChatAgent?.termsStatementUrl ?? '',
	privacyStatementUrl: product.defaultChatAgent?.privacyStatementUrl ?? ''
};

export const copilotSettingsMessage = localize({ key: 'settings', comment: ['{Locked="["}', '{Locked="]({0})"}', '{Locked="]({1})"}'] }, "{0} Copilot may show [public code]({1}) suggestions and use your data to improve the product. You can change these [settings]({2}) anytime.", defaultChat.provider.default.name, defaultChat.publicCodeMatchesUrl, defaultChat.manageSettingsUrl);

class GettingStartedContentProviderRegistry {

	private readonly providers = new Map<string, IGettingStartedContentProvider>();

	registerProvider(moduleId: string, provider: IGettingStartedContentProvider): void {
		this.providers.set(moduleId, provider);
	}

	getProvider(moduleId: string): IGettingStartedContentProvider | undefined {
		return this.providers.get(moduleId);
	}
}
export const gettingStartedContentRegistry = new GettingStartedContentProviderRegistry();

export async function moduleToContent(resource: URI): Promise<string> {
	if (!resource.query) {
		throw new Error('Getting Started: invalid resource');
	}

	const query = JSON.parse(resource.query);
	if (!query.moduleId) {
		throw new Error('Getting Started: invalid resource');
	}

	const provider = gettingStartedContentRegistry.getProvider(query.moduleId);
	if (!provider) {
		throw new Error(`Getting Started: no provider registered for ${query.moduleId}`);
	}

	return provider();
}

gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker', themePickerContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker_small', themePickerSmallContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/notebookProfile', notebookProfileContent);
// Register empty media for accessibility walkthrough
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/empty', () => '');

export type BuiltinGettingStartedStep = {
	id: string;
	title: string;
	description: string;
	completionEvents?: string[];
	when?: string;
	media:
	| { type: 'image'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string }
	| { type: 'svg'; path: string; altText: string }
	| { type: 'markdown'; path: string }
	| { type: 'video'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; poster?: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string };
};

export type BuiltinGettingStartedCategory = {
	id: string;
	title: string;
	description: string;
	isFeatured: boolean;
	next?: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'steps'; steps: BuiltinGettingStartedStep[] };
	walkthroughPageTitle: string;
};

export type BuiltinGettingStartedStartEntry = {
	id: string;
	title: string;
	description: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'startEntry'; command: string };
};

type GettingStartedWalkthroughContent = BuiltinGettingStartedCategory[];
type GettingStartedStartEntryContent = BuiltinGettingStartedStartEntry[];

export const startEntries: GettingStartedStartEntryContent = [
	{
		id: 'welcome.createRegulatoryProduct',
		title: localize('gettingStarted.createRegulatoryProduct.title', "Create Regulatory Product"),
		description: localize('gettingStarted.createRegulatoryProduct.description', "Start a new regulatory product project"),
		icon: Codicon.rocket,
		content: {
			type: 'startEntry',
			command: 'command:cline.createRegulatoryProduct',
		}
	},
	{
		id: 'welcome.openExistingDossier',
		title: localize('gettingStarted.openExistingDossier.title', "Open Existing Dossier"),
		description: localize('gettingStarted.openExistingDossier.description', "Open an existing regulatory dossier folder"),
		icon: Codicon.folderOpened,
		content: {
			type: 'startEntry',
			command: 'command:cline.productsButtonClicked',
		}
	}
];

export const walkthroughs: GettingStartedWalkthroughContent = [
	{
		id: 'walkthrough.createCTDUganda',
		title: localize('gettingStarted.createCTDUganda.title', "Create a CTD for Uganda"),
		description: localize('gettingStarted.createCTDUganda.description', "Create a Common Technical Document (CTD) submission for Uganda regulatory requirements."),
		isFeatured: true,
		icon: Codicon.folderOpened,
		content: {
			type: 'steps',
			steps: [
				{
					id: 'createCTDUganda.step1',
					title: localize('gettingStarted.createCTDUganda.step1.title', "Set up your workspace"),
					description: localize('gettingStarted.createCTDUganda.step1.description', "Open or create a folder for your CTD submission project"),
					media: {
						type: 'markdown',
						path: 'ctd_uganda_step1.md'
					}
				},
				{
					id: 'createCTDUganda.step2',
					title: localize('gettingStarted.createCTDUganda.step2.title', "Create dossier structure"),
					description: localize('gettingStarted.createCTDUganda.step2.description', "Use Ritivel to create the CTD folder structure"),
					media: {
						type: 'markdown',
						path: 'ctd_uganda_step2.md'
					}
				},
				{
					id: 'createCTDUganda.step3',
					title: localize('gettingStarted.createCTDUganda.step3.title', "Organize your documents"),
					description: localize('gettingStarted.createCTDUganda.step3.description', "Upload and organize source documents"),
					media: {
						type: 'markdown',
						path: 'ctd_uganda_step3.md'
					}
				},
				{
					id: 'createCTDUganda.step4',
					title: localize('gettingStarted.createCTDUganda.step4.title', "Generate regulatory content"),
					description: localize('gettingStarted.createCTDUganda.step4.description', "Let Ritivel generate CTD sections from your documents"),
					media: {
						type: 'markdown',
						path: 'ctd_uganda_step4.md'
					}
				},
				{
					id: 'createCTDUganda.step5',
					title: localize('gettingStarted.createCTDUganda.step5.title', "Review and submit"),
					description: localize('gettingStarted.createCTDUganda.step5.description', "Review generated content and prepare for submission"),
					media: {
						type: 'markdown',
						path: 'ctd_uganda_step5.md'
					}
				}
			]
		},
		walkthroughPageTitle: localize('gettingStarted.createCTDUganda.walkthroughPageTitle', "Create a CTD for Uganda")
	},
	{
		id: 'walkthrough.runChecklist',
		title: localize('gettingStarted.runChecklist.title', "How to run the Checklist"),
		description: localize('gettingStarted.runChecklist.description', "Run the regulatory checklist to ensure your dossier meets all requirements."),
		isFeatured: true,
		icon: Codicon.check,
		content: {
			type: 'steps',
			steps: [
				{
					id: 'runChecklist.step1',
					title: localize('gettingStarted.runChecklist.step1.title', "Access the checklist"),
					description: localize('gettingStarted.runChecklist.step1.description', "Open the regulatory checklist feature in Ritivel"),
					media: {
						type: 'markdown',
						path: 'checklist_step1.md'
					}
				},
				{
					id: 'runChecklist.step2',
					title: localize('gettingStarted.runChecklist.step2.title', "Run pre-submission checks"),
					description: localize('gettingStarted.runChecklist.step2.description', "Execute automated checks on your dossier"),
					media: {
						type: 'markdown',
						path: 'checklist_step2.md'
					}
				},
				{
					id: 'runChecklist.step3',
					title: localize('gettingStarted.runChecklist.step3.title', "Review checklist results"),
					description: localize('gettingStarted.runChecklist.step3.description', "Address any issues identified by the checklist"),
					media: {
						type: 'markdown',
						path: 'checklist_step3.md'
					}
				},
				{
					id: 'runChecklist.step4',
					title: localize('gettingStarted.runChecklist.step4.title', "Complete all requirements"),
					description: localize('gettingStarted.runChecklist.step4.description', "Ensure all checklist items are satisfied"),
					media: {
						type: 'markdown',
						path: 'checklist_step4.md'
					}
				}
			]
		},
		walkthroughPageTitle: localize('gettingStarted.runChecklist.walkthroughPageTitle', "How to run the Checklist")
	},
	{
		id: 'walkthrough.prepareModule23',
		title: localize('gettingStarted.prepareModule23.title', "Prepare Module 2.3 (QOS)"),
		description: localize('gettingStarted.prepareModule23.description', "Prepare Quality Overall Summary (QOS) documentation for Module 2.3."),
		isFeatured: true,
		icon: Codicon.file,
		content: {
			type: 'steps',
			steps: [
				{
					id: 'prepareModule23.step1',
					title: localize('gettingStarted.prepareModule23.step1.title', "Understand Module 2.3 requirements"),
					description: localize('gettingStarted.prepareModule23.step1.description', "Review the Quality Overall Summary (QOS) structure"),
					media: {
						type: 'markdown',
						path: 'module23_step1.md'
					}
				},
				{
					id: 'prepareModule23.step2',
					title: localize('gettingStarted.prepareModule23.step2.title', "Gather source documents"),
					description: localize('gettingStarted.prepareModule23.step2.description', "Collect all quality-related source documents"),
					media: {
						type: 'markdown',
						path: 'module23_step2.md'
					}
				},
				{
					id: 'prepareModule23.step3',
					title: localize('gettingStarted.prepareModule23.step3.title', "Generate QOS content"),
					description: localize('gettingStarted.prepareModule23.step3.description', "Use Ritivel to generate Module 2.3 content"),
					media: {
						type: 'markdown',
						path: 'module23_step3.md'
					}
				},
				{
					id: 'prepareModule23.step4',
					title: localize('gettingStarted.prepareModule23.step4.title', "Review and refine"),
					description: localize('gettingStarted.prepareModule23.step4.description', "Review generated content for accuracy and completeness"),
					media: {
						type: 'markdown',
						path: 'module23_step4.md'
					}
				},
				{
					id: 'prepareModule23.step5',
					title: localize('gettingStarted.prepareModule23.step5.title', "Cross-reference with Module 3"),
					description: localize('gettingStarted.prepareModule23.step5.description', "Ensure consistency with Module 3 documentation"),
					media: {
						type: 'markdown',
						path: 'module23_step5.md'
					}
				}
			]
		},
		walkthroughPageTitle: localize('gettingStarted.prepareModule23.walkthroughPageTitle', "Prepare Module 2.3 (QOS)")
	}
];
