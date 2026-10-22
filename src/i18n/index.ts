import type { AppErrorCode } from '../lib/errors/appError.ts';
import { bg, type MessageKey, type Messages } from './bg.ts';

const messages: Messages = bg;

/** Translate a key, replacing `{name}` placeholders with the given values. */
export function t(key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Bulgarian text for an application error code (a missing key is a type error). */
export function errorMessage(code: AppErrorCode): string {
  const key: MessageKey = `errors.${code}`;
  return t(key);
}

export type { MessageKey };
