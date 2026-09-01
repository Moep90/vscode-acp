import * as assert from 'assert';
import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';

import { SessionManager } from '../core/SessionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';

function seededManager() {
	const killed: string[] = [];
	let created = 1;
	const connection = {
		newSession: async () => ({ sessionId: `session-${++created}` }),
	};
	const connectionManager = {
		getConnection: (agentId: string) =>
			agentId === 'agent-1' ? { connection, initResponse: {} } : undefined,
		removeConnection: () => undefined,
	} as any;
	const agentManager = {
		killAgent: (agentId: string) => killed.push(agentId),
	} as any;

	const manager = new SessionManager(agentManager, connectionManager, new SessionUpdateHandler());
	const seed = {
		sessionId: 'session-1',
		agentId: 'agent-1',
		agentName: 'Agent',
		agentDisplayName: 'Agent',
		cwd: '/tmp',
		createdAt: new Date().toISOString(),
		initResponse: {} as any,
		modes: null,
		models: null,
		configOptions: null,
		availableCommands: [],
	};
	(manager as any).sessions.set('session-1', seed);
	(manager as any).agentSessions.set('Agent', 'session-1');
	(manager as any).activeSessionId = 'session-1';

	return { manager, killed };
}

suite('Live sessions', () => {
	test('a new conversation leaves the running session alive', async () => {
		const { manager, killed } = seededManager();

		const created = await manager.newConversation();

		assert.strictEqual(created?.sessionId, 'session-2');
		assert.deepStrictEqual(killed, [], 'the agent process is not killed');
		assert.strictEqual(manager.getActiveSessionId(), 'session-2');
		assert.deepStrictEqual(
			manager.listLiveSessions().map((session) => session.sessionId),
			['session-1', 'session-2'],
		);
	});

	test('switching back to a live session needs no replay from the agent', async () => {
		const { manager } = seededManager();
		await manager.newConversation();

		const back = manager.activateSession('session-1');

		assert.strictEqual(back?.sessionId, 'session-1');
		assert.strictEqual(manager.getActiveSessionId(), 'session-1');
		assert.strictEqual(manager.activateSession('session-404'), undefined);
	});

	test('disconnecting drops every session of that agent', async () => {
		const { manager, killed } = seededManager();
		await manager.newConversation();

		await manager.disconnectAgent('Agent');

		assert.deepStrictEqual(killed, ['agent-1']);
		assert.deepStrictEqual(manager.listLiveSessions(), []);
		assert.strictEqual(manager.getActiveSessionId(), null);
	});
});

suite('Closing and reopening', () => {
	test('closing a tab drops the session and hands over to another one', async () => {
		const { manager, killed } = seededManager();
		await manager.newConversation();
		assert.strictEqual(manager.getActiveSessionId(), 'session-2');

		await manager.closeSession('session-2');

		assert.deepStrictEqual(killed, [], 'the agent process keeps running');
		assert.deepStrictEqual(
			manager.listLiveSessions().map((session: any) => session.sessionId),
			['session-1'],
		);
		assert.strictEqual(manager.getActiveSessionId(), 'session-1');

		await manager.closeSession('session-1');
		assert.deepStrictEqual(manager.listLiveSessions(), []);
		assert.strictEqual(manager.getActiveSessionId(), null);
	});

	test('closing asks the agent only when it supports session/close', async () => {
		const { manager } = seededManager();
		const asked: string[] = [];
		(manager as any).connectionManager.getConnection = (agentId: string) =>
			agentId === 'agent-1'
				? {
					connection: {
						newSession: async () => ({ sessionId: 'unused' }),
						closeSession: async ({ sessionId }: { sessionId: string }) => { asked.push(sessionId); },
					},
					initResponse: {},
				}
				: undefined;

		await manager.closeSession('session-1');
		assert.deepStrictEqual(asked, [], 'no capability, no call');

		(manager as any).sessions.set('session-1', {
			sessionId: 'session-1', agentId: 'agent-1', agentName: 'Agent', agentDisplayName: 'Agent',
			cwd: '/tmp', createdAt: new Date().toISOString(), initResponse: {} as any,
			modes: null, models: null, configOptions: null, availableCommands: [],
		});
		(manager as any).capabilities.set('Agent', { list: true, load: false, resume: true, close: true });
		await manager.closeSession('session-1');
		assert.deepStrictEqual(asked, ['session-1']);
	});

	test('the reopen list skips sessions that are already open', async () => {
		const { manager } = seededManager();
		await manager.newConversation();
		(manager as any).capabilities.set('Agent', { list: true, load: false, resume: true, close: false });
		(manager as any).listSessions = async () => ({
			sessions: [
				{ sessionId: 'session-1', updatedAt: '2026-09-01T05:00:00Z' },
				{ sessionId: 'stored-old', updatedAt: '2026-08-30T05:00:00Z' },
				{ sessionId: 'stored-new', updatedAt: '2026-08-31T05:00:00Z' },
			],
		});

		const offered = await manager.listResumableSessions('Agent', '/work');

		assert.deepStrictEqual(
			offered.map((session: any) => session.sessionId),
			['stored-new', 'stored-old'],
			'open sessions are gone and the rest is newest first',
		);
	});
});

suite('Session tabs', () => {
	test('a session change does not wipe the chat restored after a reload', () => {
		const posted: any[] = [];
		const sessionManager = {
			getActiveSessionId: () => 'session-1',
			getSession: () => undefined,
			listLiveSessions: () => [],
		} as any;
		const provider = new ChatWebviewProvider(
			vscode.Uri.file('/tmp/acp-client-test'),
			sessionManager,
			new SessionUpdateHandler(),
		);
		const view = {
			webview: {
				options: {},
				html: '',
				cspSource: 'test-source',
				asWebviewUri: (uri: vscode.Uri) => uri,
				onDidReceiveMessage: () => ({ dispose: () => undefined }),
				postMessage: async (message: any) => { posted.push(message); return true; },
			},
			onDidDispose: () => ({ dispose: () => undefined }),
			show: () => undefined,
		} as unknown as vscode.WebviewView;

		try {
			provider.resolveWebviewView(view, {} as any, {} as any);
			posted.length = 0;

			// After a reload the client has no buffered updates for the session
			// the webview restored from its own saved state.
			provider.notifyActiveSessionChanged();

			assert.deepStrictEqual(
				posted.filter((message) => message.type === 'clearChat'),
				[],
				'the restored transcript survives',
			);
			assert.ok(posted.some((message) => message.type === 'state'));
		} finally {
			provider.dispose();
		}
	});

	test('renders one tab per session and reports the clicked one', () => {
		const updateHandler = new SessionUpdateHandler();
		const provider = new ChatWebviewProvider(
			vscode.Uri.file('/tmp/acp-client-test'),
			{} as any,
			updateHandler,
		);
		const html = (provider as any).getHtmlContent({
			cspSource: 'test-source',
			asWebviewUri: (uri: vscode.Uri) => uri,
		} as unknown as vscode.Webview) as string;
		const posted: any[] = [];
		const dom = new JSDOM(html, {
			runScripts: 'dangerously',
			beforeParse(window) {
				(window as any).acquireVsCodeApi = () => ({
					postMessage: (message: any) => posted.push(message),
					getState: () => undefined,
					setState: (next: unknown) => next,
				});
			},
		});

		try {
			dom.window.dispatchEvent(
				new dom.window.MessageEvent('message', {
					data: {
						type: 'sessions',
						sessions: [
							{ sessionId: 'session-1', label: 'Chat 1', agentName: 'Agent', active: false, busy: true },
							{ sessionId: 'session-2', label: 'Chat 2', agentName: 'Agent', active: true, busy: false },
						],
					},
				}),
			);

			const tabs = dom.window.document.querySelectorAll('.session-tab');
			assert.strictEqual(tabs.length, 2);
			assert.ok(tabs[1].classList.contains('active'), 'the second tab is on screen');
			assert.strictEqual(tabs[0].querySelectorAll('.busy').length, 1, 'the running tab is marked');
			assert.strictEqual(tabs[1].querySelectorAll('.busy').length, 0);

			(tabs[1] as HTMLElement).click();
			assert.strictEqual(
				posted.filter((m) => m.type === 'selectSession').length,
				0,
				'clicking the visible tab does nothing',
			);

			(tabs[0] as HTMLElement).click();
			assert.deepStrictEqual(JSON.parse(JSON.stringify(posted[posted.length - 1])), {
				type: 'selectSession',
				sessionId: 'session-1',
			});

			(tabs[1].querySelector('.close') as HTMLElement).click();
			assert.deepStrictEqual(JSON.parse(JSON.stringify(posted[posted.length - 1])), {
				type: 'closeSession',
				sessionId: 'session-2',
			});
			assert.strictEqual(
				posted.filter((m) => m.type === 'selectSession').length,
				1,
				'the close button does not also switch tabs',
			);
		} finally {
			dom.window.close();
			provider.dispose();
		}
	});
});
