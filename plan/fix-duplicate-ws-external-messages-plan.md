# Plan: Fix Duplicate Messages from WebSocket + External Load

## Objective
Prevent duplicate messages from appearing when both WebSocket messages and external message loads are triggered for the same session.

## Problem Description
Messages are displayed twice because they can come from two sources:
1. **WebSocket (realtime)**: Messages arrive via `useChatRealtimeHandlers` and update `chatMessages` directly
2. **External Load**: Messages are fetched via API when `externalMessageUpdate` triggers, updating `sessionMessages` → `convertedMessages` → `chatMessages`

## Current State Analysis

### Message Flow Paths

**Path 1: WebSocket (realtime)**
```
latestMessage → useChatRealtimeHandlers → setChatMessages() directly
```

**Path 2: External Load (API)**
```
externalMessageUpdate change → loadSessionMessages('external') → 
setSessionMessages() → convertedMessages → setChatMessages()
```

### When External Updates Trigger

In `useProjectsState.ts`, `externalMessageUpdate` increments when:
1. File system changes detected for the session file (lines 355-363)
2. Session blob updates detected (lines 368-378)
3. Batch session updates received (lines 256-262)

The guard `!activeSessions.has(selectedSession.id)` should prevent triggers during active sessions, but there are timing issues.

### Root Causes

1. **Race condition with activeSessions**: The session may not be in `activeSessions` quickly enough when it starts, allowing external updates to trigger
2. **No deduplication**: When external messages load, they append to `sessionMessages` without checking if those messages already exist in `chatMessages`
3. **Offset tracking doesn't account for WS messages**: The `offsetEndRef` tracks API-loaded messages but WS messages added to `chatMessages` aren't tracked

### Reproduction Scenario
1. User sends a message in an existing session
2. Session becomes active, WS messages start arriving
3. External update triggers (file change detected before activeSessions updated)
4. API loads the same messages that WS already delivered
5. Both sets of messages appear in the UI

## Proposed Solutions

### Option A: Message Deduplication by ID (Recommended)

Add deduplication in `useChatSessionState.ts` when converting/setting messages:

```ts
// In the effect that sets chatMessages from convertedMessages
useEffect(() => {
  if (sessionMessages.length > 0) {
    setChatMessages((existing) => {
      // Build a set of existing message identifiers
      const existingKeys = new Set(
        existing.map((msg) => getMessageKey(msg))
      );
      
      // Filter out duplicates from converted messages
      const newMessages = convertedMessages.filter(
        (msg) => !existingKeys.has(getMessageKey(msg))
      );
      
      // If no new messages, keep existing to avoid re-render
      if (newMessages.length === 0) {
        return existing;
      }
      
      // Merge: keep existing, append only new
      return [...existing, ...newMessages];
    });
  }
}, [convertedMessages, sessionMessages.length]);
```

With a helper function:
```ts
function getMessageKey(msg: ChatMessage): string {
  // Use toolId if present (unique identifier from Claude)
  if (msg.toolId) return `tool:${msg.toolId}`;
  
  // Use timestamp + type + content hash for other messages
  const timestamp = msg.timestamp?.getTime() || 0;
  const contentHash = msg.content?.substring(0, 50) || '';
  return `${msg.type}:${timestamp}:${contentHash}`;
}
```

### Option B: Suppress External Updates During Active Window

Add a time-based guard to prevent external updates shortly after session becomes active:

```ts
// In useProjectsState.ts
const sessionActiveTimestamps = useRef<Map<string, number>>(new Map());

// When session becomes active, record timestamp
// When checking externalMessageUpdate trigger:
const activeTime = sessionActiveTimestamps.current.get(sessionId);
const recentlyBecameActive = activeTime && Date.now() - activeTime < 2000;
if (!activeSessions.has(sessionId) && !recentlyBecameActive) {
  setExternalMessageUpdate((prev) => prev + 1);
}
```

### Option C: Replace Instead of Merge for External Updates

When external messages load, replace `chatMessages` entirely instead of merging:

```ts
// In the externalMessageUpdate effect
if (newMessages.length > 0) {
  // Replace sessionMessages with full range
  setSessionMessages((previous) => [...previous, ...newMessages]);
  // Let the conversion effect handle chatMessages
}
```

But this would lose any streaming/partial messages from WS.

## Recommended Approach

**Option A (Message Deduplication)** is the safest because:
1. It handles all edge cases regardless of timing
2. Doesn't change when external updates trigger
3. Preserves streaming messages from WS
4. Simple to implement and test

## Implementation Tasks

- [ ] Add `getMessageKey` helper function in `useChatSessionState.ts`
- [ ] Modify the `setChatMessages(convertedMessages)` effect to deduplicate
- [ ] Add optional: timestamp-based fallback matching for messages without toolId

## Risk Assessment

- **Low risk**: Deduplication is additive and doesn't change existing logic flow
- **Edge case**: Messages with identical content and close timestamps could be falsely deduplicated (rare)
- **Mitigation**: Use toolId as primary key when available (most Claude messages have this)

## Questions
- Should we also deduplicate when appending WS messages to `chatMessages`?
- Should the deduplication window be configurable?
