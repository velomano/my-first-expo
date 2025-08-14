// lib/bus.ts — 초간단 이벤트 버스 (의존성 없음)
type Handler<T = any> = (payload: T) => void;

const listeners: Record<string, Set<Handler>> = {};

export const bus = {
  on<T = any>(event: string, handler: Handler<T>) {
    (listeners[event] ??= new Set()).add(handler as Handler);
    return () => listeners[event]?.delete(handler as Handler);
  },
  emit<T = any>(event: string, payload: T) {
    listeners[event]?.forEach(fn => fn(payload));
  },
};
