# Plan: Message Offset-Based Deduplication

## Objective
Use message offsets to deduplicate messages, preventing duplicate displays when multiple load mechanisms trigger.

## Current State

### Message Sources
1. **Initial load** - `loadSessionMessages('initial')` → returns messages with API response containing `offsetBegin`/`offsetEnd`
2. **External load** - `loadSessionMessages('external')` → fetches messages after `offsetEndRef`
3. **History load** - `loadSessionMessages('history')` → fetches messages before `offsetBeginRef`
4. **WS messages** - Real-time messages via WebSocket (no offset)

### Current Offset Tracking
- `offsetBeginRef` - tracks earliest loaded message offset
- `offsetEndRef` - tracks latest loaded message offset
- API returns `data.offsetBegin` and `data.offsetEnd` for the batch
- Individual messages don't store their offset

### Message Types
- **Claude sessions**: Raw messages have `timestamp`, no explicit offset
- **Cursor sessions**: Messages have `blobId`, `sequence`, `rowid`

## Proposed Solution

### 1. Add Offset to ChatMessage Type

```typescript
// In types/types.ts
export interface ChatMessage {
  // ... existing fields
  messageOffset?: number;  // API-sourced message offset (undefined for WS messages)
}
```

### 2. Track Loaded Offsets in State

```typescript
// In useChatSessionState.ts
const loadedOffsetsRef = useRef<Set<number>>(new Set());
```

### 3. Modify loadSessionMessages to Return Offset Info

The API likely returns messages with indices. We can calculate offset from `data.offsetBegin + index`:

```typescript
const loadSessionMessages = useCallback(async (...) => {
  // ... existing code
  const messages = data.messages || [];
  
  // Add offset to each message
  const messagesWithOffset = messages.map((msg, index) => ({
    ...msg,
    messageOffset: data.offsetBegin + index,
  }));
  
  return messagesWithOffset;
}, []);
```

### 4. Modify Message Transform Functions

Update `convertSessionMessages` and `convertCursorSessionMessages` to preserve offset:

```typescript
// In messageTransforms.ts
export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  // ... existing code
  // Preserve messageOffset from raw message
  if (message.messageOffset !== undefined) {
    chatMessage.messageOffset = message.messageOffset;
  }
};
```

### 5. Deduplicate When Setting Messages

```typescript
// In useChatSessionState.ts
const setSessionMessagesWithDedup = useCallback((newMessages) => {
  setSessionMessages((prev) => {
    const existingOffsets = new Set(
      prev.filter(m => m.messageOffset !== undefined).map(m => m.messageOffset)
    );
    
    const deduped = newMessages.filter(msg => 
      msg.messageOffset === undefined || !existingOffsets.has(msg.messageOffset)
    );
    
    return [...prev, ...deduped];
  });
}, []);
```

### 6. Reset Offsets on Session Change

```typescript
// When session changes
loadedOffsetsRef.current.clear();
```

## Implementation Tasks

- [ ] Add `messageOffset` field to `ChatMessage` type
- [ ] Modify `loadSessionMessages` to attach offset to each message
- [ ] Update `convertSessionMessages` to preserve `messageOffset`
- [ ] Update `convertCursorSessionMessages` to use `rowid` or `sequence` as offset
- [ ] Add deduplication logic when merging sessionMessages
- [ ] Reset offset tracking on session change
- [ ] Test initial load, external load, history load, and WS messages

## Benefits

1. **Reliable deduplication** - Offset is unique per message in session
2. **Simple comparison** - Number comparison vs complex object matching
3. **Works with existing API** - Just needs to track offset from response metadata
4. **Handles race conditions** - Multiple load triggers won't cause duplicates

## Edge Cases

| Case | Handling |
|------|----------|
| WS messages (no offset) | `messageOffset: undefined`, always included |
| History load (older messages) | Prepend, check offsets before existing |
| External load (newer messages) | Append, check offsets after existing |
| Session change | Clear offset tracking |
