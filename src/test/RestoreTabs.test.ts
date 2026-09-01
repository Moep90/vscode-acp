import * as assert from 'assert';
import * as vscode from 'vscode';

import { OpenTabsStore } from '../core/OpenTabsStore';
import { restoreOpenTabs } from '../core/restoreOpenTabs';

function memento(): vscode.Memento {
	const values = new Map<string, unknown>();
	return {
		get: (key: string) => values.get(key),
		update: async (key: string, value: unknown) => {
			if (value === undefined) { values.delete(key); } else { values.set(key, value); }
		},
		keys: () => Array.from(values.keys()),
	} as unknown as vscode.Memento;
}

suite('Restoring the tab strip', () => {
	test('remembers the open conversations and forgets them when none are left', () => {
		const store = new OpenTabsStore(memento());
		store.save({ agentName: 'Agent', sessionIds: ['a', 'b'], activeSessionId: 'b' });

		assert.deepStrictEqual(store.load(), {
			agentName: 'Agent',
			sessionIds: ['a', 'b'],
			activeSessionId: 'b',
		});

		store.save({ agentName: 'Agent', sessionIds: [], activeSessionId: null });
		assert.strictEqual(store.load(), undefined);
	});

	test('reopens every remembered conversation and returns to the active one', async () => {
		const opened: string[] = [];
		const live = new Set<string>();
		let active: string | null = null;
		const sessionManager = {
			connectToAgent: async () => { live.add('a'); return { sessionId: 'a' }; },
			getSession: (id: string) => (live.has(id) ? { sessionId: id } : undefined),
			openStoredSession: async (_agent: string, id: string) => {
				opened.push(id);
				live.add(id);
				return { sessionId: id };
			},
			activateSession: (id: string) => { active = id; return { sessionId: id }; },
			listLiveSessions: () => Array.from(live).map((id) => ({ sessionId: id })),
		} as any;

		await restoreOpenTabs(sessionManager, {
			agentName: 'Agent',
			sessionIds: ['a', 'b', 'c'],
			activeSessionId: 'b',
		});

		assert.deepStrictEqual(opened, ['b', 'c'], 'the session connecting brought back is not opened twice');
		assert.strictEqual(active, 'b');
	});

	test('skips a conversation the agent no longer knows', async () => {
		const live = new Set<string>(['a']);
		const sessionManager = {
			connectToAgent: async () => ({ sessionId: 'a' }),
			getSession: (id: string) => (live.has(id) ? { sessionId: id } : undefined),
			openStoredSession: async (_agent: string, id: string) => {
				if (id === 'gone') { throw new Error('unknown session'); }
				live.add(id);
				return { sessionId: id };
			},
			activateSession: () => undefined,
			listLiveSessions: () => Array.from(live).map((id) => ({ sessionId: id })),
		} as any;

		await restoreOpenTabs(sessionManager, {
			agentName: 'Agent',
			sessionIds: ['a', 'gone', 'c'],
			activeSessionId: 'gone',
		});

		assert.deepStrictEqual(Array.from(live).sort(), ['a', 'c']);
	});
});
