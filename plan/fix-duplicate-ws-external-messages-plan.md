# Plan: Fix Duplicate Messages from WebSocket + External Load

## Objective
Prevent duplicate messages from appearing when both WebSocket messages and external message loads are triggered for the same session.

## Problem Description
Messages are displayed twice because they can come from two sources:
1. **WebSocket (realtime)**: Messages arrive via `useChatRealtimeHandlers` and update `chatMessages` directly
2. **External Load**: Messages are fetched via API when `externalMessageUpdate` triggers, updating `sessionMessages` → `convertedMessages` → `chatMessages`

## Solution: Separated Message Storage

### Architecture

Instead of mixing WS and API messages in a single `chatMessages` state, we now maintain them separately:

```
API-loaded messages: sessionMessages → convertedMessages
WS messages: wsMessages (temporary buffer)
Display: chatMessages = convertedMessages + wsMessages
```

### Data Flow

**During Active Session:**
1. User message → `setWsMessages` (appended)
2. WS response messages → `setWsMessages` (appended/updated)
3. Display: `chatMessages = [...convertedMessages, ...wsMessages]`

**On Session Complete (Reconciliation):**
1. Wait 500ms for file writes to complete
2. Call `loadSessionMessages('external')` to get persisted messages
3. Clear `wsMessages` (drop temporary buffer)
4. Update `sessionMessages` with API data
5. Display automatically updates: `chatMessages = [...convertedMessages]`

### Key Files Modified

1. **`useChatSessionState.ts`**:
   - Added `wsMessages` state for temporary WS message buffer
   - Modified `chatMessages` derivation: `[...convertedMessages, ...wsMessages]`
   - `reconcileMessages()`: clears `wsMessages` and loads from API
   - Removed `incrementWsMessageCount` / `wsMessageCountRef`

2. **`useChatRealtimeHandlers.ts`**:
   - All message operations use `setWsMessages` instead of `setChatMessages`
   - Removed `setChatMessages` from interface (no longer needed)
   - `appendStreamingChunk` and `finalizeStreamingMessage` work with `setWsMessages`

3. **`useChatComposerState.ts`**:
   - User messages added to `setWsMessages` instead of `setChatMessages`
   - Removed `incrementWsMessageCount`

4. **`ChatInterface.tsx`**:
   - Passes `setWsMessages` to hooks instead of `incrementWsMessageCount`
   - Removed `setChatMessages` from `useChatRealtimeHandlers` call

## Benefits

1. **Clean separation**: API data and WS data never mix
2. **Simple reconciliation**: Just clear wsMessages and API replaces all
3. **No counting/tracking**: No need to track message counts
4. **No deduplication needed**: Sources are kept separate until reconciliation

## Implementation Status

- [x] Add `wsMessages` state in `useChatSessionState`
- [x] Combine `convertedMessages + wsMessages` for display
- [x] Update `useChatRealtimeHandlers` to use `setWsMessages`
- [x] Update `reconcileMessages` to clear `wsMessages`
- [x] Update `useChatComposerState` for user messages
- [x] Remove all `incrementWsMessageCount` code
- [x] TypeScript check passes

## Risk Assessment

- **Low risk**: Changes are localized to message handling
- **Benefit**: Eliminates race conditions and duplicate message issues
- **Trade-off**: wsMessages are temporary and lost if page refreshes before reconciliation (acceptable since they'll be loaded from API on refresh)
