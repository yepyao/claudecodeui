# Plan: Cursor Session Mode Support

## Objective
1. Add session mode support for Cursor with modes: "default", "ask", "plan"
2. Pass `--mode` flag to cursor-agent CLI for "ask" and "plan" modes
3. Don't add `-f` flag when "ask" or "plan" mode is selected
4. Hide token/context usage pie for Cursor sessions

## Proposed Changes

### 1. Frontend: `src/components/chat/hooks/useChatProviderState.ts`
- Change mode cycling for Cursor to use: `['default', 'ask', 'plan']` instead of permission modes

### 2. Frontend: `src/components/chat/view/subcomponents/ChatInputControls.tsx`
- Update button labels for Cursor to show "Default", "Ask", "Plan" modes
- Hide TokenUsagePie when provider is 'cursor'

### 3. Frontend: `src/i18n/locales/en/chat.json`
- Add translations for Cursor session modes

### 4. Frontend: `src/components/chat/hooks/useChatComposerState.ts`
- Pass `sessionMode` to cursor-command options

### 5. Backend: `server/cursor-cli.js`
- Add `--mode ask` or `--mode plan` flag when those modes are selected
- Only add `-f` flag when mode is "default" AND skipPermissions is enabled

## Tasks
- [x] Update useChatProviderState.ts for Cursor modes
- [x] Update ChatInputControls.tsx for Cursor mode display + hide token usage
- [x] Add translations for Cursor modes
- [x] Update useChatComposerState.ts to pass sessionMode
- [x] Update ChatInterface.tsx to pass cursorSessionMode
- [x] Update ChatComposer.tsx to pass cursorSessionMode
- [x] Update cursor-cli.js to handle session modes
- [x] Update types/types.ts with CursorSessionMode type
- [x] Update doc/permission-modes.md with full documentation
