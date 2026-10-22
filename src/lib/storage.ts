/** Per-browser conveniences only (e.g. the last display name). Never game state. */
const DISPLAY_NAME_KEY = 'tunnels.displayName';

export function loadDisplayName(): string {
  try {
    return localStorage.getItem(DISPLAY_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(DISPLAY_NAME_KEY, name);
  } catch {
    // Storage may be unavailable (private mode); the name is just a convenience.
  }
}
