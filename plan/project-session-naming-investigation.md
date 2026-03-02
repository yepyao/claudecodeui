# Plan: Investigate Project and Session Naming

## Objective

Understand how project display names and session names are determined, stored, and displayed in the UI.

## Questions to Answer

### 1. Project Display Name
- How is the display name determined?
- Can users modify it?
- Where is it stored if modified?

### 2. Session Name (Claude)
- Which field is displayed on the UI?
- What is the usage of `summary` field?
- How does `lastUserMessage` affect the display?

### 3. Cursor Session Name
- Why do sessions show as "untitled session" in UI?
- Do Cursor sessions have names when listed via CLI?
- What's the discrepancy between CLI and our implementation?

## Investigation Tasks

- [ ] 1. Read `generateDisplayName()` function in `server/projects.js`
- [ ] 2. Check `loadProjectConfig()` and `saveProjectConfig()` for storage
- [ ] 3. Find where project rename happens (API endpoint)
- [ ] 4. Check UI components for session display field usage
- [ ] 5. Compare Claude session parsing (`parseJsonlSessions`) for name/summary logic
- [ ] 6. Check Cursor CLI to see how it displays session names
- [ ] 7. Compare with our `parseCursorAgentSession()` implementation

## Deliverables

- Documentation of current behavior
- Identification of any bugs or inconsistencies
- Recommendations for fixes if needed

---

**Waiting for approval to proceed with investigation.**
