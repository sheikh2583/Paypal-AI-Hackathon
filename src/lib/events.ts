export type AppEventType = "message.created" | "invoice.paid" | "invoice.updated" | "approval.created";

export interface AppEvent {
  type: AppEventType;
  invoiceId?: string;
  at: string;
}

type EventListener = (event: AppEvent) => void;
const processScope = globalThis as typeof globalThis & { chaserEventListeners?: Set<EventListener> };
const listeners = processScope.chaserEventListeners ??= new Set<EventListener>();

export function emit(event: AppEvent): void {
  for (const listener of [...listeners]) listener(event);
}

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
