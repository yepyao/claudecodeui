# Switch Cursor Sessions to Read from Chats Store.db

## Objective

Change Cursor session discovery to read from `~/.cursor/chats/{cwdHash}/` instead of `agent-transcripts/` to get proper session names.

## Current State

- `getCursorAgentSessions()` reads from `~/.cursor/projects/{encoded}/agent-transcripts/`
- Session names come from store.db lookup (fallback to JSONL summary)
- Misses sessions that only exist in chats (like "List Files")

## Proposed Changes

### File: `server/projects.js`

Replace `getCursorAgentSessions()` to read directly from chats store.db:

1. Calculate cwdHash from projectPath
2. Scan `~/.cursor/chats/{cwdHash}/` for session folders
3. Read metadata from each session's store.db
4. Return sessions with name, createdAt, messageCount

## Tasks

- [x] Rewrite `getCursorAgentSessions()` to read from chats
- [x] Remove dependency on agent-transcripts for session discovery
- [x] Remove `getCursorSessionName()` (no longer needed - integrated into main function)
- [x] Update callers to pass projectPath (already done)
