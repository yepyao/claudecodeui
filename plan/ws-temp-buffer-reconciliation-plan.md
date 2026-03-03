# Plan: WebSocket Temp Buffer with Delta Replacement on Session Complete

## Objective
Avoid duplicate messages by buffering WebSocket messages separately and replacing them with API data (delta only) when session becomes inactive.

## Approach (Confirmed)
1. Store WS messages in a temporary buffer while showing them immediately in UI
2. When session becomes inactive, trigger API request with `offsetBegin = offsetEndRef + 1`
3. Replace only the delta portion (messages after `offsetEndRef`) with API response
4. Drop the WS temp buffer - API is the source of truth for completed sessions

## Current State Analysis

### Message Sources
1. **WebSocket (realtime)**: `useChatRealtimeHandlers.ts` → `setChatMessages()` directly
2. **API Load (external)**: `externalMessageUpdate` trigger → `loadSessionMessages('external')` → `setSessionMessages()` → `setChatMessages()`

### Session Lifecycle
- **Active**: `onSessionActive(sessionId)` called when user sends a message (`useChatComposerState.ts:579`)
- **Inactive**: `onSessionInactive(sessionId)` called when:
  - `claude-complete`, `codex-complete`, `cursor-result`, `session-aborted` events received
  - `session-status` indicates not processing

### Offset Tracking (Critical)
- `offsetEndRef` is **only updated** when messages are loaded via API (`useChatSessionState.ts:160-165`)
- WS messages added to `chatMessages` do **NOT** update `offsetEndRef`
- **Conclusion**: `offsetBegin = offsetEndRef + 1` correctly excludes WS messages ✓

## Implementation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Session Active                                │
│                                                                      │
│  chatMessages = [API messages (0..offsetEndRef)] + [WS messages]    │
│                  ▲ from initial load                ▲ realtime      │
│                                                                      │
│  wsMessagesRef = [WS messages]  (tracked separately for cleanup)    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Session becomes inactive (complete event)
┌─────────────────────────────────────────────────────────────────────┐
│                       Delta Replacement                              │
│                                                                      │
│  1. Receive complete event (claude-complete, cursor-result, etc.)   │
│  2. Wait ~500ms for file writes to complete                         │
│  3. Call API: loadSessionMessages('external', offsetBegin=offsetEndRef+1)  │
│  4. Rebuild chatMessages:                                            │
│     - Keep: messages[0..offsetEndRef] (already from API)            │
│     - Replace: messages after offsetEndRef with API response        │
│  5. Clear wsMessagesRef buffer                                       │
│  6. Update offsetEndRef to new value from API response              │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Tasks

### Phase 1: Add WS Message Tracking
- [x] Add `wsMessageCountRef` in `useChatSessionState.ts` to track how many WS messages were added
- [x] Modify `useChatRealtimeHandlers.ts` to increment this counter when adding WS messages
- [x] Reset counter on session change

### Phase 2: Trigger Reconciliation on Session Complete
- [x] Add callback `onReconcileMessages` to `useChatRealtimeHandlers` args
- [x] In complete event handlers (`claude-complete`, `cursor-result`, `codex-complete`):
  - Call `onReconcileMessages()` after a short delay (500ms)
- [x] `onReconcileMessages` implementation in `useChatSessionState.ts`:
  ```typescript
  const reconcileMessages = useCallback(async () => {
    // Load delta from API
    const newMessages = await loadSessionMessages(projectName, sessionId, 'external', provider);
    
    if (newMessages.length > 0) {
      // Keep API messages, replace WS portion with new API data
      setChatMessages((prev) => {
        const apiMessageCount = prev.length - wsMessageCountRef.current;
        const keptMessages = prev.slice(0, apiMessageCount);
        return [...keptMessages, ...convertedNewMessages];
      });
    }
    
    // Clear WS tracking
    wsMessageCountRef.current = 0;
  }, [...]);
  ```

### Phase 3: Disable External Updates During Active Session
- [x] Ensure `externalMessageUpdate` doesn't trigger while session is active (already guarded by `activeSessions.has()`)
- [x] Verify timing: session must be marked inactive BEFORE reconciliation triggers

## Files Modified

1. **`src/components/chat/hooks/useChatSessionState.ts`**
   - [x] Added `wsMessageCountRef` and `reconcileTimerRef`
   - [x] Added `incrementWsMessageCount` callback
   - [x] Added `reconcileMessages` callback with 500ms delay
   - [x] Reset counters on session change
   - [x] Exported new callbacks

2. **`src/components/chat/hooks/useChatRealtimeHandlers.ts`**
   - [x] Added `incrementWsMessageCount` and `onReconcileMessages` to interface
   - [x] Updated `appendStreamingChunk` to accept `onNewMessage` callback
   - [x] Added `incrementWsMessageCount` calls in all places where new messages are added
   - [x] Added `onReconcileMessages` calls in `claude-complete`, `cursor-result`, `codex-complete`

3. **`src/components/chat/view/ChatInterface.tsx`**
   - [x] Destructured `incrementWsMessageCount` and `reconcileMessages` from `useChatSessionState`
   - [x] Passed callbacks to `useChatRealtimeHandlers`
   - [x] Passed `incrementWsMessageCount` to `useChatComposerState`

4. **`src/components/chat/hooks/useChatComposerState.ts`**
   - [x] Added `incrementWsMessageCount` to interface and parameters
   - [x] Called `incrementWsMessageCount` when user message is added

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| File writes not complete when API called | Missing messages | 500ms delay before reconciliation |
| Session aborted mid-stream | Partial messages | Still reconcile - API has what was persisted |
| Race with external update trigger | Double load | Reconciliation replaces, so no duplicates |

## Edge Cases

1. **No new messages from API**: If `newMessages.length === 0`, keep existing chatMessages (WS messages are valid)
2. **User switches session before complete**: Reset `wsMessageCountRef` on session change
3. **Multiple complete events**: Guard against multiple reconciliation calls

## Why This Works

- Messages `[0..offsetEndRef]` are always from API (authoritative)
- Messages after `offsetEndRef` are from WS (temporary, for real-time UX)
- On complete, API returns all messages from `offsetEndRef + 1` onwards
- We replace the WS portion with API data → no duplicates, consistent state
