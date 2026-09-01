import type { SessionManager } from './SessionManager';
import type { OpenTab, OpenTabsSnapshot } from './OpenTabsStore';
import { log, logError } from '../utils/Logger';

/**
 * Bring back the conversation that was in front before the window reloaded and
 * report the other tabs, which stay unloaded until the user opens one.
 */
export async function restoreOpenTabs(
  sessionManager: SessionManager,
  snapshot: OpenTabsSnapshot,
): Promise<OpenTab[]> {
  if (!snapshot.tabs.length) {
    return [];
  }

  sessionManager.setPreferredRestoreSession(snapshot.activeSessionId);
  try {
    await sessionManager.connectToAgent(snapshot.agentName);
  } catch (e) {
    sessionManager.setPreferredRestoreSession(null);
    logError(`Could not reconnect "${snapshot.agentName}"`, e);
    return [];
  }

  const pending = snapshot.tabs.filter((tab) => !sessionManager.getSession(tab.sessionId));
  log(`Restored the active conversation, ${pending.length} tab(s) wait to be opened`);
  return pending;
}
