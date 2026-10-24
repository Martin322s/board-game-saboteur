import { handleGameCommand, type HandlerDeps } from './handler.ts';

/**
 * HTTP layer for `game-command`, built only on Web standard Request/Response so it runs in the
 * Deno Edge runtime and in Node tests alike.
 */
export interface HttpDeps extends HandlerDeps {
  /** Verifies a bearer token and returns the user id, or null if invalid. */
  readonly authenticate: (token: string) => Promise<string | null>;
  readonly allowedOrigins: readonly string[];
  /** Structured log sink. Never receives state, hands or roles. */
  readonly log?: (entry: Record<string, unknown>) => void;
}

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-rules-version';

function corsHeaders(origin: string | null, allowed: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleGameHttp(req: Request, deps: HttpDeps): Promise<Response> {
  const cors = corsHeaders(req.headers.get('Origin'), deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'INVALID_REQUEST' }, cors);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, error: 'INVALID_REQUEST' }, cors);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  try {
    const userId = token ? await deps.authenticate(token) : null;
    const result = await handleGameCommand(
      { userId, rulesVersion: req.headers.get('x-rules-version'), body },
      deps,
    );
    const b = body as { roomId?: unknown; command?: { type?: unknown } } | null;
    deps.log?.({
      fn: 'game-command',
      command: typeof b?.command?.type === 'string' ? b.command.type : null,
      roomId: typeof b?.roomId === 'string' ? b.roomId : null,
      ok: result.body.ok === true,
      error: result.body.ok === true ? null : result.body.error,
      version: result.body.version ?? null,
    });
    return json(result.status, result.body, cors);
  } catch (error) {
    deps.log?.({ fn: 'game-command', ok: false, error: 'INTERNAL', detail: String(error) });
    return json(500, { ok: false, error: 'INTERNAL' }, cors);
  }
}
