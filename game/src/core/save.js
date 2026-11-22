// Save and load: a small localStorage snapshot of cash, mission progress, heat, position and the
// clock. No server, no secrets; a corrupt or absent record simply starts a new game.

import { SAVE_KEY } from '../core/config.js';

const VERSION = 2;

export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeSave(payload) {
  try {
    const data = { ...payload, version: VERSION, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage can be blocked from file:// in some browsers; saving then simply no-ops.
  }
}

export function hasSave() {
  return readSave() !== null;
}
