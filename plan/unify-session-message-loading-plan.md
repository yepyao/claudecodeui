# Plan: Unify Session Message Loading

## Objective
1. Replace the fragile "offset from end" pagination with a stable "offset from start" scheme that handles new messages correctly
2. Eliminate the separate `loadCursorSessionMessages` function — make all providers use the same `loadSessionMessages` path with incremental pagination

## Current State Analysis

### Two Loading Paths

| Aspect | `loadSessionMessages` (Claude/Codex/Gemini) | `loadCursorSessionMessages` (Cursor) |
|--------|---------------------------------------------|---------------------------------------|
| **API call** | `api.sessionMessages()` in `api.js` | Raw `fetch('/api/cursor/sessions/${id}?projectPath=...')` — bypasses `api.js` |
| **Backend endpoint** | `/api/projects/:name/sessions/:id/messages` (Claude), `/api/codex/sessions/:id/messages`, `/api/gemini/sessions/:id/messages` | `/api/cursor/sessions/:id` (note: no `/messages` suffix) |
| **Pagination** | Yes — `limit=20`, offset from end | None — loads ALL messages at once |
| **Response format** | `{ messages, total, hasMore, offset, limit }` | `{ success, session: { id, projectPath, messages, metadata, cwdId } }` |
| **State target** | `setSessionMessages(raw)` → `convertSessionMessages()` → `setChatMessages()` | Bypasses `sessionMessages`, goes directly to `setChatMessages()` via `convertCursorSessionMessages()` |
| **Scroll load-more** | Triggers `loadOlderMessages()` on scroll-to-top | Explicitly disabled: `if (provider === 'cursor') return false` |

### Current Pagination Is Fragile (offset from end)

Current backend logic (both Claude and Codex):
```javascript
// offset 0 = most recent messages
const startIndex = Math.max(0, total - offset - limit);
const endIndex = total - offset;
```

**Problem:** When new messages arrive, all offsets shift. Example:
- 100 messages, user loaded m61-m100 (offsetRef=40)
- 5 new messages arrive (total=105)
- Next "load more" with offset=40: `startIndex = 105-40-20 = 45`, `endIndex = 105-40 = 65` → returns m46-m65
- But user already has m61-m100 → **m61-m65 duplicated, m41-m45 skipped**

Current workaround: `externalMessageUpdate` resets everything (calls `loadSessionMessages` with `loadMore=false`), nuking all previously loaded older messages and resetting to just the latest 20. This loses the user's scroll position.

### Why Was Cursor Separated?

1. **No `/messages` endpoint**: Only `GET /api/cursor/sessions/:sessionId` exists (returns full session + all messages)
2. **Different response shape**: Cursor returns messages under `session.messages` with blob format
3. **Different data source**: SQLite `store.db` with protobuf DAG blobs vs JSONL files
4. `api.sessionMessages()` has a `cursor` branch routing to `/api/cursor/sessions/:id/messages` — but that endpoint **doesn't exist** (dead code)

## Proposed Changes

### New Pagination Scheme: Offset From Start

Messages are sorted by timestamp and assigned stable 0-based indices: oldest message = index `0`, newest = index `total - 1`. New messages always get higher indices — existing offsets never shift.

#### Offset Semantics

- **0-based**: index `0` is the first (oldest) message
- **Both inclusive**: `offsetBegin` and `offsetEnd` both point to actual returned messages
- Maps directly to JS array indices (`sortedMessages[offsetBegin]` through `sortedMessages[offsetEnd]`)

#### API Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | int, optional (default 20) | Max messages to return |
| `offsetEnd` | int, optional | Return messages ending at this index (inclusive). Used for loading history. |
| `offsetBegin` | int, optional | Return messages starting from this index (inclusive). Used for loading new messages. |

#### API Response (standardized across all providers)

```json
{
  "messages": [...],
  "total": 100,
  "offsetBegin": 80,
  "offsetEnd": 99
}
```

- `offsetBegin`: 0-based index of the **first** returned message (inclusive)
- `offsetEnd`: 0-based index of the **last** returned message (inclusive)
- `total`: total message count in the session

**`hasMore` is removed.** The frontend can derive it: `offsetBeginRef.current > 0` means there are older messages to load. No redundant field needed.

#### Three Usage Scenarios

**1. Initial load** — `?limit=20` (no offsets)

Returns the last 20 messages.

```
100 messages: [m0, m1, ..., m99]
Response: messages=[m80..m99], offsetBegin=80, offsetEnd=99, total=100
```

Frontend stores: `storedBegin=80, storedEnd=99`. Knows more history exists because `storedBegin > 0`.

**2. Load history** (scroll up) — `?limit=20&offsetEnd=79`

"Give me up to 20 messages ending at index 79 (inclusive)."

```
Response: messages=[m60..m79], offsetBegin=60, offsetEnd=79, total=100
```

Frontend updates: `storedBegin=60` (storedEnd stays at 99). Prepends messages. Still `storedBegin > 0`, so more history available.

Next load: `?limit=20&offsetEnd=59` → `offsetBegin=40, offsetEnd=59` → `storedBegin=40`

**3. External update** (new messages) — `?offsetBegin=100`

"Give me all messages from index 100 onward."

```
5 new messages arrived, total now 105.
Response: messages=[m100..m104], offsetBegin=100, offsetEnd=104, total=105
```

Frontend updates: `storedEnd=104`. Appends messages. No reset, no lost scroll position.

If no new messages: `messages=[], total=100`. Frontend checks `messages.length === 0` and skips updating offsets.

#### Backend Implementation (pseudocode)

```javascript
function paginate(sortedMessages, { limit = 20, offsetBegin, offsetEnd }) {
  const total = sortedMessages.length;
  if (total === 0) return { messages: [], total: 0, offsetBegin: -1, offsetEnd: -1 };

  let begin, end;

  if (offsetEnd !== undefined) {
    // Load history: N messages ending at offsetEnd (inclusive)
    end = Math.min(offsetEnd, total - 1);
    begin = Math.max(0, end - limit + 1);
  } else if (offsetBegin !== undefined) {
    // External update: all messages from offsetBegin onward
    begin = Math.max(0, offsetBegin);
    end = total - 1;
    if (begin > end) return { messages: [], total, offsetBegin: -1, offsetEnd: -1 };
  } else {
    // Initial load: last N messages
    end = total - 1;
    begin = Math.max(0, total - limit);
  }

  const messages = sortedMessages.slice(begin, end + 1);  // slice is exclusive on end, so +1

  return { messages, total, offsetBegin: begin, offsetEnd: end };
}
```

#### Frontend Offset Tracking

Replace single `messagesOffsetRef` with two refs:

```
offsetBeginRef  — index of the oldest loaded message
offsetEndRef    — index of the newest loaded message
```

| Action | Sends | On response |
|--------|-------|-------------|
| Initial load | `limit=20` | `storedBegin = offsetBegin`, `storedEnd = offsetEnd` |
| Load history | `limit=20, offsetEnd=storedBegin-1` | `storedBegin = offsetBegin`, prepend messages |
| External update | `offsetBegin=storedEnd+1` | `storedEnd = offsetEnd`, append messages |
| Session switch | — | Reset both to `-1` |

"Can I load more history?" → `offsetBeginRef.current > 0` (replaces old `hasMore` state).

#### Edge Cases

| Case | What happens |
|------|-------------|
| Session has 0 messages | `messages=[], total=0, offsetBegin=-1, offsetEnd=-1` |
| Session has ≤20 messages | Initial load returns all. `offsetBegin=0`. `storedBegin > 0` is false → no scroll-to-load-more. |
| Load history when already at start | Frontend checks `offsetBeginRef > 0` before requesting. Won't send request. |
| External update, no new messages | `messages=[], total=100`. Frontend checks `messages.length === 0`, skips offset update. |
| External update, many new messages | All returned (no limit). Frontend appends all, updates `storedEnd`. |

### Project Name Resolution (No Extra Params Needed)

The project object already has `cursorName`, and all backend endpoints already resolve:
```
projectName (Claude format: `-localhome-local-eyao-claudecodeui`)
  → strip leading dash → cursorName
  → extractCursorProjectPath(cursorName) → projectPath
  → MD5(projectPath) → cwdId → `~/.cursor/chats/<cwdId>/`
```
Used in `server/index.js` for session listing (line 699) and batch (line 742). So we just pass `projectName` — no extra `projectPath` param needed.

### Phase 1: Backend — New pagination for Claude and Codex

**File: `server/projects.js`**

- `getSessionMessages()` (line 1087): Replace offset-from-end logic with new `paginate()` scheme
  - Accept `{ limit, offsetBegin, offsetEnd }` instead of `{ limit, offset }`
  - Always return `{ messages, total, offsetBegin, offsetEnd }`
  - Keep backward compat: if old `offset` param is passed (no `offsetBegin`/`offsetEnd`), fall back to old behavior during transition
- `getCodexSessionMessages()` (line 1805): Same changes

**File: `server/index.js`**

- Update Claude messages endpoint (line 774) to parse new query params (`offsetBegin`, `offsetEnd`)

**File: `server/routes/codex.js`**

- Update Codex messages endpoint to parse new query params

### Phase 2: Backend — Create Cursor messages endpoint

**File: `server/routes/cursor.js`**

- Extract DAG parsing/blob sorting from existing `GET /sessions/:sessionId` handler into a reusable function
- Add new route: `GET /sessions/:sessionId/messages`
  - Accept `?projectName=...&limit=N&offsetBegin=N&offsetEnd=N`
  - Resolve `projectName` → `projectPath` → `cwdId` (same pattern as session listing)
  - Reuse extracted DAG parsing logic
  - Apply same pagination scheme
  - Return standardized `{ messages, total, offsetBegin, offsetEnd }`

### Phase 3: Frontend — Update `api.js` and `loadSessionMessages`

**File: `src/utils/api.js`**

- Update `sessionMessages()` signature: `(projectName, sessionId, limit, offsetBegin, offsetEnd, provider)`
- Build query string from the new params (only include non-null values)
- For cursor branch: append `projectName` as query parameter

**File: `src/components/chat/hooks/useChatSessionState.ts`**

- Replace `messagesOffsetRef` with `offsetBeginRef` and `offsetEndRef` (both init to `-1`)
- Remove `hasMoreMessages` state — replace with derived check: `offsetBeginRef.current > 0`
- **Initial load** (`loadMore=false`): call API with just `limit=20`, store returned `offsetBegin`/`offsetEnd`
- **Load history** (`loadOlderMessages`): guard with `offsetBeginRef.current > 0`, call API with `offsetEnd=offsetBeginRef.current-1, limit=20`, prepend results, update `offsetBeginRef`
- **External update** (`externalMessageUpdate`): call API with `offsetBegin=offsetEndRef.current+1`, **append** new messages (not replace!), update `offsetEndRef`. If `messages.length === 0`, skip.
- Remove `loadCursorSessionMessages` — cursor now goes through `loadSessionMessages`
- Remove `if (provider === 'cursor') return false` from `loadOlderMessages`
- Remove cursor-specific branch in `loadAllMessages`

### Phase 4: Frontend — Unify the message conversion pipeline

**File: `src/components/chat/hooks/useChatSessionState.ts`**

- Cursor messages now flow through `sessionMessages` → conversion → `chatMessages` like all other providers
- The conversion `useEffect` detects provider and calls the appropriate converter (`convertSessionMessages` or `convertCursorSessionMessages`)

## Tasks

- [ ] 1. Refactor `getSessionMessages()` in `server/projects.js` — new pagination with `offsetBegin`/`offsetEnd` (0-based, both inclusive)
- [ ] 2. Refactor `getCodexSessionMessages()` in `server/projects.js` — same new pagination
- [ ] 3. Update Claude messages endpoint in `server/index.js` to parse new query params
- [ ] 4. Update Codex messages endpoint in `server/routes/codex.js` to parse new query params
- [ ] 5. Extract DAG parsing logic in `server/routes/cursor.js` into reusable function
- [ ] 6. Add `GET /api/cursor/sessions/:sessionId/messages` endpoint with new pagination
- [ ] 7. Update `api.sessionMessages()` in `src/utils/api.js` — new params + `projectName` for cursor
- [ ] 8. Replace `messagesOffsetRef` with `offsetBeginRef`/`offsetEndRef` in `useChatSessionState.ts`
- [ ] 9. Update `loadSessionMessages` — store `offsetBegin`/`offsetEnd` from response
- [ ] 10. Update `loadOlderMessages` — send `offsetEnd=offsetBeginRef-1`
- [ ] 11. Update `externalMessageUpdate` handler — send `offsetBegin=offsetEndRef+1`, append instead of replace
- [ ] 12. Remove `loadCursorSessionMessages` from `useChatSessionState.ts`
- [ ] 13. Update session selection logic to route cursor through `loadSessionMessages`
- [ ] 14. Update conversion `useEffect` to handle cursor messages flowing through `sessionMessages`
- [ ] 15. Remove `if (provider === 'cursor') return false` from `loadOlderMessages`
- [ ] 16. Remove cursor-specific branch in `loadAllMessages`
- [ ] 17. Test: Initial load returns last 20 messages with correct offsets
- [ ] 18. Test: Scroll-to-top loads older messages correctly (no duplicates/gaps)
- [ ] 19. Test: External update appends only new messages (no full reset)
- [ ] 20. Test: Edge cases — empty session, ≤20 messages, already at start
- [ ] 21. Test: Cursor session loads with pagination
- [ ] 22. Test: "Load All" works for all providers

## Risk Assessment

- **Low risk**: Backend pagination change is backward-detectable (new param names vs old). Old `offset` param can be supported as fallback during transition.
- **Medium risk**: External update behavior changes from "reset" to "append" — needs testing that message ordering and scroll position stay correct
- **Medium risk**: Frontend unification touches the core message loading pipeline — careful testing needed for all providers
- **Low risk**: Cursor backend is additive (new endpoint, existing full-session endpoint unchanged)
