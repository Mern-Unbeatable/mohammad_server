/** Same state for the same conversation is relayed at most this often (client sends every 3s). */
export const TYPING_REPEAT_MS = 2500;
/** Hard cap per socket, so toggling true/false cannot be used to flood a conversation. */
export const TYPING_BURST = 20;
export const TYPING_BURST_WINDOW_MS = 10_000;
const MAX_TRACKED_CONVERSATIONS = 50;

/**
 * Per-socket gate for "typing" events, checked before any database work.
 * State changes (start/stop) pass immediately unless the burst cap is hit.
 */
export const createTypingThrottle = () => {
  const last = new Map<string, { typing: boolean; at: number }>();
  let windowStart = 0;
  let windowCount = 0;

  return (conversationId: string, typing: boolean, now = Date.now()): boolean => {
    if (now - windowStart >= TYPING_BURST_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= TYPING_BURST) return false;

    const previous = last.get(conversationId);
    if (previous && previous.typing === typing && now - previous.at < TYPING_REPEAT_MS) {
      return false;
    }

    if (!previous && last.size >= MAX_TRACKED_CONVERSATIONS) last.clear();
    last.set(conversationId, { typing, at: now });
    windowCount += 1;
    return true;
  };
};
