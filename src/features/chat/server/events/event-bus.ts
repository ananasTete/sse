/**
 * Simple in-memory event bus to decouple chat stream generation
 * from HTTP connections, allowing reconnection.
 */

type Subscriber = (event: string) => void

interface EventBus {
  subscribers: Map<string, Set<Subscriber>>
  history: Map<string, string[]>
  completed: Set<string>
  aborted: Set<string>
}

declare global {
  var __mockEventBus: EventBus | undefined
}

function getEventBus(): EventBus {
  globalThis.__mockEventBus ??= {
    subscribers: new Map(),
    history: new Map(),
    completed: new Set(),
    aborted: new Set(),
  }
  return globalThis.__mockEventBus
}

export function subscribeToMessage(
  messageUuid: string,
  subscriber: Subscriber
): () => void {
  const bus = getEventBus()
  
  if (!bus.subscribers.has(messageUuid)) {
    bus.subscribers.set(messageUuid, new Set())
  }
  
  bus.subscribers.get(messageUuid)!.add(subscriber)
  
  return () => {
    const subs = bus.subscribers.get(messageUuid)
    if (subs) {
      subs.delete(subscriber)
      if (subs.size === 0) {
        bus.subscribers.delete(messageUuid)
      }
    }
  }
}

export function publishEvent(
  messageUuid: string,
  eventString: string,
  eventType?: string
): void {
  const bus = getEventBus()
  
  // Store in history
  if (!bus.history.has(messageUuid)) {
    bus.history.set(messageUuid, [])
  }
  bus.history.get(messageUuid)!.push(eventString)
  
  // Mark as completed if it's the final event
  if (eventType === 'message_stop') {
    bus.completed.add(messageUuid)
  }
  
  // Notify subscribers
  const subs = bus.subscribers.get(messageUuid)
  if (subs) {
    for (const sub of subs) {
      try {
        sub(eventString)
      } catch (err) {
        console.error('Error in subscriber', err)
      }
    }
  }
}

export function getHistory(messageUuid: string): string[] {
  return getEventBus().history.get(messageUuid) || []
}

export function isCompleted(messageUuid: string): boolean {
  return getEventBus().completed.has(messageUuid)
}

export function abortMessage(messageUuid: string): void {
  const bus = getEventBus()
  bus.aborted.add(messageUuid)
  bus.completed.add(messageUuid) // Count aborted as completed so we don't wait forever
}

export function isAborted(messageUuid: string): boolean {
  return getEventBus().aborted.has(messageUuid)
}

export function cleanupMessage(messageUuid: string): void {
  const bus = getEventBus()
  bus.subscribers.delete(messageUuid)
  bus.history.delete(messageUuid)
  bus.completed.delete(messageUuid)
  bus.aborted.delete(messageUuid)
}
