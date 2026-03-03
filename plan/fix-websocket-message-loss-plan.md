# Plan: Fix WebSocket Message Loss

## Problem

Messages are being lost due to React's state batching when using `latestMessage` state + `useEffect` pattern.

```
WebSocket → setLatestMessage(A) → setLatestMessage(B) → setLatestMessage(C) → React renders → useEffect sees only C
```

Messages A and B are **lost forever**.

## Root Cause

```javascript
// WebSocketContext.tsx - PROBLEM
websocket.onmessage = (event) => {
  setLatestMessage(data);  // React batches this!
};

// Consumer - PROBLEM  
useEffect(() => {
  // Only sees the LAST message after React batches
}, [latestMessage]);
```

React batches state updates. If multiple messages arrive before React re-renders, only the last one is seen.

## Solution: Direct Handler Registration

Instead of going through React state, let components register handlers that are called **synchronously** when messages arrive.

### New Architecture

```
WebSocket onmessage 
    ↓ (synchronous)
Call all registered handlers in order
    ↓ (synchronous)
Each handler processes message immediately
```

### Implementation

#### 1. Update WebSocketContext

```typescript
// WebSocketContext.tsx
type MessageHandler = (message: any) => void;

const useWebSocketProviderState = () => {
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  
  // Keep latestMessage for backward compatibility
  const [latestMessage, setLatestMessage] = useState<any>(null);
  
  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => handlersRef.current.delete(handler);
  }, []);
  
  // In connect():
  websocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    // Call all handlers SYNCHRONOUSLY - no message loss!
    handlersRef.current.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error('Handler error:', e);
      }
    });
    
    // Also update state for backward compatibility
    setLatestMessage(data);
  };
  
  return {
    subscribe,  // NEW
    latestMessage,  // Keep for backward compat
    // ...
  };
};
```

#### 2. Create useWebSocketHandler Hook

```typescript
// hooks/useWebSocketHandler.ts
export function useWebSocketHandler(
  handler: (message: any) => void,
  deps: any[] = []
) {
  const { subscribe } = useWebSocket();
  
  useEffect(() => {
    const unsubscribe = subscribe(handler);
    return unsubscribe;
  }, [subscribe, ...deps]);
}
```

#### 3. Update useChatRealtimeHandlers

```typescript
// useChatRealtimeHandlers.ts
export function useChatRealtimeHandlers({ ... }) {
  const thinkingBufferRef = useRef('');
  
  // Handler is called synchronously for EVERY message
  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'cursor-thinking':
        if (message.data?.text) {
          // Accumulate in ref (synchronous, no loss)
          thinkingBufferRef.current += message.data.text;
          
          // Debounced flush to React state for UI update
          scheduleFlush();
        }
        break;
      // ... other cases
    }
  }, [/* deps */]);
  
  useWebSocketHandler(handleMessage, [/* deps */]);
}
```

## Tasks

- [ ] 1. Add `subscribe` function to WebSocketContext
- [ ] 2. Update `onmessage` to call handlers synchronously  
- [ ] 3. Create `useWebSocketHandler` hook
- [ ] 4. Update `useChatRealtimeHandlers` to use new pattern
- [ ] 5. Keep `latestMessage` for backward compatibility (other components use it)
- [ ] 6. Add thinking buffer ref with debounced flush
- [ ] 7. Test with rapid message stream
- [ ] 8. Remove debug logging after confirmed working

## Why This Works

1. **No message loss**: Handlers called synchronously in `onmessage`, before any batching
2. **Order guaranteed**: JavaScript single-threaded, handlers called in message order
3. **Backward compatible**: `latestMessage` still works for components that don't need every message
4. **Simple**: No complex queue management, just callback pattern

## Risks

1. **Handler errors**: One handler throwing could affect others → wrap in try/catch
2. **Slow handlers**: Synchronous handlers block next message → handlers should be fast
3. **Memory**: Handlers must be cleaned up on unmount → return unsubscribe function

## Alternative Considered: Message Queue

We tried adding a `messageQueue` array to WebSocket context, but:
- Still goes through React state → still has batching issues
- Complex to manage queue clearing
- Required changes across many files

Direct handler registration is simpler and more reliable.
