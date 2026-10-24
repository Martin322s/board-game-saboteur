import { ConfirmButton } from '../../../components/ui.tsx';
import { t } from '../../../i18n/index.ts';
import type { ConnectionState, LobbyPlayer } from '../../../lib/services/types.ts';

const CONNECTION_STYLE: Record<ConnectionState, { dot: string; glyph: string }> = {
  CONNECTED: { dot: 'bg-emerald-400', glyph: '●' },
  AWAY: { dot: 'bg-amber-300', glyph: '◐' },
  DISCONNECTED: { dot: 'bg-slate-500', glyph: '○' },
};

/** Player rows. Status is always conveyed by text + symbol, never by colour alone. */
export function PlayerList({
  players,
  canKick,
  onKick,
  kickPending,
}: {
  players: readonly LobbyPlayer[];
  canKick: boolean;
  onKick: (playerId: string) => void;
  kickPending: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {players.map((player) => {
        const connection = CONNECTION_STYLE[player.connection];
        return (
          <li key={player.playerId} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
            <span className="w-16 text-sm text-fg-muted">
              {t('room.seat', { seat: player.seat + 1 })}
            </span>
            <span className="min-w-0 flex-1 font-medium break-words">
              {/* Rendered as text: React escapes names; nothing is interpreted as HTML. */}
              {player.displayName}
              {player.isMe && <span className="ml-1 text-fg-muted">{t('room.you')}</span>}
            </span>
            {player.isHost && (
              <span className="rounded border border-accent/60 px-2 py-0.5 text-sm text-accent">
                <span aria-hidden="true">♛ </span>
                {t('room.host')}
              </span>
            )}
            {!player.isHost && (
              <span className={`text-sm ${player.isReady ? 'text-positive' : 'text-fg-muted'}`}>
                <span aria-hidden="true">{player.isReady ? '✓ ' : '… '}</span>
                {player.isReady ? t('room.ready') : t('room.notReady')}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-sm text-fg-muted">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-full ${connection.dot}`}
              />
              <span aria-hidden="true">{connection.glyph}</span>
              {t(`room.connection.${player.connection}`)}
            </span>
            {canKick && !player.isMe && (
              <ConfirmButton
                label={t('room.kick', { name: player.displayName })}
                confirmLabel={t('room.kick.confirm', { name: player.displayName })}
                disabled={kickPending}
                onConfirm={() => onKick(player.playerId)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
