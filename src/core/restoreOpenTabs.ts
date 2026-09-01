import type { SessionManager } from './SessionManager';
import type { OpenTabsSnapshot } from './OpenTabsStore';
import { log, logError } from '../utils/Logger';

/** Restoring more than this at once would replay a lot of history at startup. */
const MAX_RESTORED_TABS = 5;

/**
 * Reopen the conversations that were in the tab strip before the window was
 * reloaded. Sessions the agent no longer knows are skipped; connecting is left
 * to the caller's error handling.
 */
export async function restoreOpenTabs(
  sessionManager: SessionManager,
  snapshot: OpenTabsSnapshot,
): Promise<void> {
  const wanted = snapshot.sessionIds.slice(-MAX_RESTORED_TABS);
  if (!wanted.length) {
    return;
  }

  await sessionManager.connectToAgent(snapshot.agentName);

  for (const sessionId of wanted) {
    if (sessionManager.getSession(sessionId)) {
      continue;
    }
    try {
      await sessionManager.openStoredSession(snapshot.agentName, sessionId);
    } catch (e) {
      logError(`Could not reopen conversation ${sessionId}`, e);
    }
  }

  const active = snapshot.activeSessionId;
  if (active && sessionManager.getSession(active)) {
    sessionManager.activateSession(active);
  }
  log(`Restored ${sessionManager.listLiveSessions().length} conversation(s)`);
}
