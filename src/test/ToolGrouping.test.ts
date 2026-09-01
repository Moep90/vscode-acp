import * as assert from 'assert';
import * as vscode from 'vscode';
import { JSDOM } from 'jsdom';

import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';

function webview() {
	const provider = new ChatWebviewProvider(
		vscode.Uri.file('/tmp/acp-client-test'),
		{} as any,
		new SessionUpdateHandler(),
	);
	const html = (provider as any).getHtmlContent({
		cspSource: 'test-source',
		asWebviewUri: (uri: vscode.Uri) => uri,
	} as unknown as vscode.Webview) as string;
	const dom = new JSDOM(html, {
		runScripts: 'dangerously',
		beforeParse(window) {
			(window as any).acquireVsCodeApi = () => ({
				postMessage: () => undefined,
				getState: () => undefined,
				setState: (next: unknown) => next,
			});
		},
	});
	const send = (data: Record<string, unknown>) =>
		dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
	return {
		dom,
		send,
		update: (update: Record<string, unknown>) => send({ type: 'sessionUpdate', update }),
		dispose: () => { dom.window.close(); provider.dispose(); },
	};
}

function turnLayout(dom: JSDOM): string[] {
	const turn = dom.window.document.querySelector('.turn');
	return Array.from(turn?.children ?? []).map((child) =>
		child.classList.contains('turn-tools')
			? `tools:${child.querySelectorAll('.tool-call-inline').length}`
			: child.classList.contains('thought-block')
				? 'thought'
				: 'message',
	);
}

suite('Tool call grouping', () => {
	test('keeps each group under the message it belongs to', () => {
		const h = webview();
		try {
			h.send({ type: 'promptStart' });
			h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading first.' } });
			h.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read: a.md', status: 'pending' });
			h.update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'read: b.md', status: 'pending' });
			h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Now patching.' } });
			h.update({ sessionUpdate: 'tool_call', toolCallId: 't3', title: 'patch: a.md', status: 'pending' });

			assert.deepStrictEqual(turnLayout(h.dom), ['message', 'tools:2', 'message', 'tools:1']);
		} finally {
			h.dispose();
		}
	});

	test('a thought opens its own group too', () => {
		const h = webview();
		try {
			h.send({ type: 'promptStart' });
			h.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Let me look.' } });
			h.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read: a.md', status: 'pending' });

			assert.deepStrictEqual(turnLayout(h.dom), ['thought', 'tools:1']);
		} finally {
			h.dispose();
		}
	});

	test('collapses only the groups that are long', () => {
		const h = webview();
		try {
			h.send({ type: 'promptStart' });
			h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Many reads.' } });
			for (let i = 0; i < 4; i++) {
				h.update({ sessionUpdate: 'tool_call', toolCallId: `t${i}`, title: `read: ${i}.md`, status: 'pending' });
			}
			h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'One write.' } });
			h.update({ sessionUpdate: 'tool_call', toolCallId: 'w', title: 'patch: a.md', status: 'pending' });
			h.send({ type: 'promptEnd', stopReason: 'end_turn' });

			const lists = h.dom.window.document.querySelectorAll('.turn-tools-list');
			assert.strictEqual(lists.length, 2);
			assert.ok(lists[0].classList.contains('collapsed'), 'the group of four is folded away');
			assert.ok(!lists[1].classList.contains('collapsed'), 'the single call stays visible');
		} finally {
			h.dispose();
		}
	});
});
