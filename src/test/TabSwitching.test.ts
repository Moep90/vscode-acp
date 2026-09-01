import * as assert from 'assert';
import * as vscode from 'vscode';

import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';

function harness() {
	const posted: any[] = [];
	const updates = new SessionUpdateHandler();
	let active = 'session-a';
	const sessionManager = {
		getActiveSessionId: () => active,
		getSession: (id: string) => ({ sessionId: id, agentDisplayName: 'Agent', cwd: '/tmp' }),
		listLiveSessions: () => [
			{ sessionId: 'session-a', agentDisplayName: 'Agent', title: undefined },
			{ sessionId: 'session-b', agentDisplayName: 'Agent', title: undefined },
		],
		activateSession: (id: string) => { active = id; return { sessionId: id }; },
		applyAvailableCommands: () => undefined,
		applyConfigOptions: () => undefined,
		applySessionInfoUpdate: () => undefined,
	} as any;

	const provider = new ChatWebviewProvider(vscode.Uri.file('/tmp/acp'), sessionManager, updates);
	let onMessage: (message: any) => void = () => undefined;
	const view = {
		webview: {
			options: {},
			html: '',
			cspSource: 'test',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage: (handler: (message: any) => void) => {
				onMessage = handler;
				return { dispose: () => undefined };
			},
			postMessage: async (message: any) => { posted.push(message); return true; },
		},
		onDidDispose: () => ({ dispose: () => undefined }),
		show: () => undefined,
	} as unknown as vscode.WebviewView;
	provider.resolveWebviewView(view, {} as any, {} as any);

	const say = (sessionId: string, text: string) =>
		updates.handleUpdate({
			sessionId,
			update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
		} as any);

	return { posted, provider, say, select: (sessionId: string) => onMessage({ type: 'selectSession', sessionId }) };
}

function chunks(posted: any[]): string[] {
	return posted
		.filter((m) => m.type === 'sessionUpdate')
		.map((m) => m.update?.content?.text);
}

suite('Tab switching', () => {
	test('sends only what arrived while the tab was in the background', () => {
		const h = harness();
		h.say('session-a', 'a1');
		h.say('session-a', 'a2');

		h.select('session-b');
		h.say('session-b', 'b1');
		h.say('session-a', 'a3-in-background');

		h.posted.length = 0;
		h.select('session-a');

		assert.deepStrictEqual(
			chunks(h.posted),
			['a3-in-background'],
			'the two chunks already on screen are not sent again',
		);
		assert.ok(
			h.posted.some((m) => m.type === 'showSession' && m.sessionId === 'session-a'),
			'the webview is told which cached view to show',
		);
		assert.strictEqual(
			h.posted.filter((m) => m.type === 'loadSessionStart').length,
			0,
			'no full reload of the conversation',
		);
	});

	test('a tab with nothing new sends no updates at all', () => {
		const h = harness();
		h.say('session-a', 'a1');
		h.select('session-b');

		h.posted.length = 0;
		h.select('session-a');

		assert.deepStrictEqual(chunks(h.posted), []);
		assert.ok(h.posted.some((m) => m.type === 'showSession'));
	});

	test('reports whether the session it shows is busy', () => {
		const h = harness();
		h.select('session-b');
		const busy = h.posted.filter((m) => m.type === 'processing');
		assert.deepStrictEqual(busy.map((m) => m.busy), [false]);
	});
});
