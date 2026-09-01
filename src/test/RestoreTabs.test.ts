import * as assert from 'assert';
import * as vscode from 'vscode';

import { OpenTabsStore } from '../core/OpenTabsStore';
import { restoreOpenTabs } from '../core/restoreOpenTabs';

function memento(seed?: Record<string, unknown>): vscode.Memento {
	const values = new Map<string, unknown>(Object.entries(seed ?? {}));
	return {
		get: (key: string) => values.get(key),
		update: async (key: string, value: unknown) => {
			if (value === undefined) { values.delete(key); } else { values.set(key, value); }
		},
		keys: () => Array.from(values.keys()),
	} as unknown as vscode.Memento;
}

suite('Restoring the tab strip', () => {
	test('remembers the open conversations with their labels and forgets an empty strip', () => {
		const store = new OpenTabsStore(memento());
		store.save({
			agentName: 'Agent',
			tabs: [{ sessionId: 'a', label: 'Ports' }, { sessionId: 'b', label: 'Chat 2' }],
			activeSessionId: 'b',
		});

		assert.deepStrictEqual(store.load(), {
			agentName: 'Agent',
			tabs: [{ sessionId: 'a', label: 'Ports' }, { sessionId: 'b', label: 'Chat 2' }],
			activeSessionId: 'b',
		});

		store.save({ agentName: 'Agent', tabs: [], activeSessionId: null });
		assert.strictEqual(store.load(), undefined);
	});

	test('reads a snapshot written by the previous version', () => {
		const store = new OpenTabsStore(memento({
			'acp.openTabs': { version: 1, agentName: 'Agent', sessionIds: ['a'], activeSessionId: 'a' },
		}));

		assert.deepStrictEqual(store.load()?.tabs, [{ sessionId: 'a', label: 'Chat' }]);
	});

	test('loads the conversation that was in front and leaves the rest for later', async () => {
		const live = new Set<string>();
		let preferred: string | null = null;
		const sessionManager = {
			setPreferredRestoreSession: (id: string | null) => { preferred = id; },
			connectToAgent: async () => {
				assert.strictEqual(preferred, 'b', 'the active session is the one to bring back');
				live.add('b');
				return { sessionId: 'b' };
			},
			getSession: (id: string) => (live.has(id) ? { sessionId: id } : undefined),
			openStoredSession: async () => assert.fail('the other tabs stay closed until clicked'),
			listLiveSessions: () => Array.from(live).map((id) => ({ sessionId: id })),
		} as any;

		const pending = await restoreOpenTabs(sessionManager, {
			agentName: 'Agent',
			tabs: [
				{ sessionId: 'a', label: 'Ports' },
				{ sessionId: 'b', label: 'Subnets' },
				{ sessionId: 'c', label: 'Notes' },
			],
			activeSessionId: 'b',
		});

		assert.deepStrictEqual(pending.map((tab) => tab.sessionId), ['a', 'c']);
	});

	test('reports no tabs when the agent cannot be reached', async () => {
		const sessionManager = {
			setPreferredRestoreSession: () => undefined,
			connectToAgent: async () => { throw new Error('spawn failed'); },
			getSession: () => undefined,
			listLiveSessions: () => [],
		} as any;

		const pending = await restoreOpenTabs(sessionManager, {
			agentName: 'Agent',
			tabs: [{ sessionId: 'a', label: 'Ports' }],
			activeSessionId: 'a',
		});

		assert.deepStrictEqual(pending, []);
	});
});
