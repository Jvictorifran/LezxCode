// Estado global compartilhado entre os módulos
export const state = {
  root: null,
  settings: {},
  info: {},
  live: { running: false, port: null }
};

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
}
export function emit(evt, ...args) {
  for (const fn of listeners.get(evt) || []) fn(...args);
}
