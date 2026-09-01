import * as vscode from 'vscode';

const STATE_KEY = 'acp.openTabs';

export interface OpenTabsSnapshot {
  agentName: string;
  sessionIds: string[];
  activeSessionId: string | null;
}

interface PersistedShape extends OpenTabsSnapshot {
  version: 1;
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
    if (!raw || raw.version !== 1 || !Array.isArray(raw.sessionIds) || !raw.agentName) {
      return undefined;
    }
    return {
      agentName: raw.agentName,
      sessionIds: raw.sessionIds.filter((id) => typeof id === 'string'),
      activeSessionId: raw.activeSessionId ?? null,
    };
  }

  save(snapshot: OpenTabsSnapshot): void {
    if (!snapshot.sessionIds.length) {
      void this.workspaceState.update(STATE_KEY, undefined);
      return;
    }
    const value: PersistedShape = { version: 1, ...snapshot };
    void this.workspaceState.update(STATE_KEY, value);
  }
}
