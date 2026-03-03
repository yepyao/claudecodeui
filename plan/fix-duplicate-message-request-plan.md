# Plan: Fix Duplicate Message Requests on Session Click

## Objective
Prevent duplicate API calls when clicking a cursor session in the sidebar, which causes duplicate messages to be shown.

## Root Cause
When clicking a session, there's a race condition between:
1. Initial session load completing and setting `offsetBeginRef.current > 0`
2. Scroll-to-bottom executing (has a 200ms delay)
3. Scroll event firing while content is at top position

The `loadOlderMessages` function doesn't check if an initial session load is in progress, so it can fire immediately after the initial load completes but before scroll-to-bottom happens.

**Sequence:**
1. Effect at line 312 resets `topLoadLockRef.current = false`
2. Effect at line 336 calls `loadSessionMessages('initial')`
3. API returns, sets `offsetBeginRef.current = N` (where N > 0 if session has > 50 messages)
4. React renders messages with scrollTop = 0
5. Scroll event fires (content render or effect)
6. `handleScroll` sees `scrolledNearTop = true`, calls `loadOlderMessages`
7. `loadOlderMessages` checks `offsetBeginRef.current > 0` → true → makes second API call

## Proposed Changes

### File: `src/components/chat/hooks/useChatSessionState.ts`

Add a guard in `loadOlderMessages` to check if initial session loading is in progress:

```ts
// Line ~218 - Add check for initial session loading
const loadOlderMessages = useCallback(
  async (container: HTMLDivElement) => {
    if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
      return false;
    }
    // ADD: Don't load older messages while initial session is loading
    if (isLoadingSessionRef.current) {
      return false;
    }
    if (allMessagesLoadedRef.current) return false;
    // ... rest unchanged
  },
  [isLoadingMoreMessages, loadSessionMessages],
);
```

## Tasks
- [x] Add `isLoadingSessionRef.current` guard in `loadOlderMessages` function (line ~218)

## Risk Assessment
- **Low risk**: Single guard addition, defensive check
- The ref is already being set/reset properly in the codebase (lines 343, 427)
- No dependencies need to change since it's a ref, not state

## Alternative Considered
Could also set `topLoadLockRef.current = true` at the start of initial load and only reset after scroll-to-bottom completes, but this is more complex and changes existing behavior.
