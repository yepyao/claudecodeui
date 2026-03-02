# Plan: XML Tag Display Improvements for Chat Messages

## Objective

Improve how XML-like tags (injected by Cursor IDE into user messages) are displayed in the chat UI, rather than showing raw XML to the user.

## Findings: Complete Tag Inventory

Scanned all Cursor chat databases across 3 projects (45 sessions). Tags fall into 3 categories:

### Category A: System-Injected Tags (first user message only, per session)

These are **automatically injected by Cursor IDE** into the first user message. The user never typed them.

| Tag | Count | Parent | Content Type |
|-----|-------|--------|-------------|
| `<user_info>` | 44 | root | OS, shell, workspace path, date, terminals folder |
| `<git_status>` | 43 | root | Branch tracking info, ahead/behind status |
| `<rules>` | 44 | root | Workspace rules container |
| `<always_applied_workspace_rules>` | 20 | rules | Array of rule entries |
| `<always_applied_workspace_rule>` | 67 | above | Individual rule content (name attr) |
| `<agent_requestable_workspace_rules>` | 44 | rules | Array of requestable rules |
| `<agent_requestable_workspace_rule>` | 332 | above | Rule description (fullPath attr) |
| `<agent_transcripts>` | 21 | root | Past chat location info |
| `<project_layout>` | 23 | root | File structure snapshot |

### Category B: User Query Wrapper

| Tag | Count | Parent | Notes |
|-----|-------|--------|-------|
| `<user_query>` | 395 | root | Wraps EVERY user message (both first and follow-up) |

### Category C: Incidental Tags (from code snippets pasted by user)

| Tag | Count | Notes |
|-----|-------|-------|
| `<string>`, `<span>`, `<Tooltip>`, `<Flex>`, `<button>`, `<Label>` etc. | ~50 total | Code/JSX fragments in user messages |
| `<attached_files>` | 6 | Cursor injects when user edits are reverted |
| `<system_reminder>` | 1 | Cursor injects on mode switch |

## Current Behavior

The UI currently displays **raw text** including all XML tags verbatim in user message bubbles. This means:
- User sees `<user_info>OS Version: linux 6.14.0-35-generic...` as their first "message"
- `<user_query>` wrapper is shown around every message
- Hundreds of lines of rules/config are displayed as if the user typed them

## Proposed Changes

### 1. Strip `<user_query>` wrapper — **ALWAYS** (highest priority)

Every user message is wrapped in `<user_query>...</user_query>`. Strip this tag and show only the inner content.

**Display**: Just the text inside, no indication needed.

### 2. Strip/hide system-injected tags from first message — **COLLAPSIBLE**

The first user message per session contains a massive block of system context (`<user_info>`, `<git_status>`, `<rules>`, `<project_layout>`, `<agent_transcripts>`). This should be:

- **Separated** from the user's actual query (which is inside `<user_query>` at the end)
- **Shown in a collapsible "Context" section** above the first user message, with a summary line

**Proposed display**:

```
┌─ 🔧 Session Context ──────────────────────────┐
│ ▶ User Info: linux, bash, /path/to/workspace   │
│ ▶ Git Status: main...origin/main               │
│ ▶ Rules: 5 workspace rules                     │
│ ▶ Project Layout: 42 files                     │
└────────────────────────────────────────────────┘
```

Each line expands on click to show full content.

### 3. `<attached_files>` — **COLLAPSIBLE**

Show as a collapsible "Attached Changes" section with a diff-like display.

**Display**: `📎 Attached file changes (click to expand)`

### 4. `<system_reminder>` — **HIDE or SUBTLE INDICATOR**

This is a system mode-switch message. Show as a subtle system message, not as a user bubble.

**Display**: Small gray italic text like `— Switched to Agent mode —`

### 5. Code/JSX tags (Category C) — **NO CHANGE**

These are actual content the user pasted. Display as-is (they're part of the message).

## Implementation Approach

### Where to implement

**Option A (Recommended): Transform layer** — `messageTransforms.ts`
- Parse XML tags during message conversion
- Extract system context into structured metadata on the `ChatMessage` object
- Strip `<user_query>` wrapper at this layer

**Option B: Render layer** — `MessageComponent.tsx`
- Parse at render time
- More flexible but slower

### Proposed `ChatMessage` type additions

```typescript
interface ChatMessage {
  // ... existing fields ...
  
  // New fields for parsed system context
  systemContext?: {
    userInfo?: { os: string; shell: string; workspace: string; date: string };
    gitStatus?: string;
    rules?: { name: string; content: string }[];
    projectLayout?: string;
    agentTranscripts?: string;
  };
  attachedFiles?: string;  // raw content of <attached_files>
}
```

### New UI component

`SystemContextBanner.tsx` — Renders the collapsible context section for the first message.

## Tasks

- [ ] Add XML tag parser utility to extract/strip known tags from user messages
- [ ] Update `convertCursorSessionMessages()` to strip `<user_query>` and extract system context
- [ ] Update `convertSessionMessages()` (Claude path) similarly  
- [ ] Add `systemContext` fields to `ChatMessage` type
- [ ] Create `SystemContextBanner` collapsible component
- [ ] Update `MessageComponent` to render system context as collapsible section
- [ ] Handle `<attached_files>` as collapsible "changes" section
- [ ] Handle `<system_reminder>` as subtle system indicator

## Tag Display Decision Summary

| Tag | Display? | Format |
|-----|----------|--------|
| `<user_query>` | Strip wrapper, show content only | Plain text |
| `<user_info>` | Yes, collapsible | Summary line + expandable details |
| `<git_status>` | Yes, collapsible | Summary line + expandable details |
| `<rules>` | Yes, collapsible | "N rules" summary + expandable list |
| `<project_layout>` | Yes, collapsible | "N files" summary + expandable tree |
| `<agent_transcripts>` | Yes, collapsible | One-line path info |
| `<attached_files>` | Yes, collapsible | "Attached changes" with diff view |
| `<system_reminder>` | Subtle indicator | Gray italic system message |
| Code tags (`<span>`, etc.) | As-is | No change (user content) |

## Questions

1. Should the collapsible context banner appear as a separate element above the first user bubble, or inside the bubble itself?
2. Should we persist the expanded/collapsed state, or always start collapsed?
