import * as vscode from 'vscode';

const STATE_KEY = 'acp.openTabs';

export interface OpenTab {
  sessionId: string;
  label: string;
}

export interface OpenTabsSnapshot {
  agentName: string;
  tabs: OpenTab[];
  activeSessionId: string | null;
}

interface PersistedShape {
  version: 1 | 2;
  agentName: string;
  activeSessionId: string | null;
  /** Version 2. */
  tabs?: OpenTab[];
  /** Version 1, kept so an older snapshot still restores. */
  sessionIds?: string[];
}

/**
 * Remembers which conversations were open in this workspace. A window reload
 * restarts the extension host and kills the agent processes with it, so the
 * tabs are rebuilt from this on the next start.
 */
export class OpenTabsStore {
  constructor(private readonly workspaceState: vscode.Memento) {}

  load(): OpenTabsSnapshot | undefined {
    const raw = this.workspaceState.get<PersistedShape>(STATE_KEY);
    if (!raw || !raw.agentName) {
      return undefined;
    }
    const tabs: OpenTab[] = Array.isArray(raw.tabs)
      ? raw.tabs.filter((tab) => tab && typeof tab.sessionId === 'string')
      : (raw.sessionIds ?? [])
        .filter((id) => typeof id === 'string')
        .map((sessionId) => ({ sessionId, label: 'Chat' }));
    if (!tabs.length) {
      return undefined;
    }
    return {
      agentName: raw.agentName,
      tabs,
      activeSessionId: raw.activeSessionId ?? null,
    };
  }

  save(snapshot: OpenTabsSnapshot): void {
    if (!snapshot.tabs.length) {
      void this.workspaceState.update(STATE_KEY, undefined);
      return;
    }
    const value: PersistedShape = { version: 2, ...snapshot };
    void this.workspaceState.update(STATE_KEY, value);
  }
}
