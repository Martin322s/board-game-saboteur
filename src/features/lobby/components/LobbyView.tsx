import { useId } from 'react';
import { useNavigate } from 'react-router';
import { inputStyles } from '../../../components/styles.ts';
import { Button, ConfirmButton, ErrorText } from '../../../components/ui.tsx';
import { errorMessage, t } from '../../../i18n/index.ts';
import { toAppError } from '../../../lib/errors/appError.ts';
import type { LobbySnapshot, RealtimeStatus } from '../../../lib/services/types.ts';
import { useGameCommand } from '../../game/hooks.ts';
import { useKickPlayer, useLeaveRoom, useSetReady, useUpdateCapacity } from '../hooks.ts';
import { CAPACITY_OPTIONS } from '../validation.ts';
import { PlayerList } from './PlayerList.tsx';
import { RoomCodeCard } from './RoomCodeCard.tsx';

export function LobbyView({
  snapshot,
  realtimeStatus,
  online,
}: {
  snapshot: LobbySnapshot;
  realtimeStatus: RealtimeStatus;
  online: boolean;
}) {
  const id = useId();
  const navigate = useNavigate();
  const { room, me, players, start } = snapshot;
  const setReady = useSetReady(room.code);
  const updateCapacity = useUpdateCapacity(room.code);
  const kick = useKickPlayer(room.code);
  const leave = useLeaveRoom(room.code);
  const startGame = useGameCommand(room.id, room.code);
  const failure = [
    setReady.error,
    updateCapacity.error,
    kick.error,
    leave.error,
    startGame.error,
  ].find(Boolean);
  const disconnected = !online || realtimeStatus === 'DISCONNECTED';

  return (
    <section aria-labelledby={`${id}-heading`} className="mx-auto w-full max-w-2xl space-y-6">
      {disconnected && (
        <p
          role="status"
          className="rounded-md border border-border bg-surface-raised p-3 text-fg"
        >
          <span aria-hidden="true">⚠ </span>
          {t('room.offline')}
        </p>
      )}

      <h1 id={`${id}-heading`} className="text-2xl font-bold">
        {t('room.heading', { code: room.code })}
      </h1>

      <RoomCodeCard code={room.code} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{t('room.players.heading')}</h2>
          <p className="text-fg-muted">
            {t('room.capacity', { count: players.length, capacity: room.capacity })}
          </p>
        </div>
        <PlayerList
          players={players}
          canKick={me.isHost}
          kickPending={kick.isPending}
          onKick={(playerId) => kick.mutate({ roomId: room.id, playerId })}
        />
      </div>

      {failure && <ErrorText>{errorMessage(toAppError(failure).code)}</ErrorText>}

      <div className="space-y-3 rounded-lg border border-border p-4">
        {me.isHost ? (
          <>
            <p className="text-fg-muted">{t('room.hostHint')}</p>
            <div className="max-w-xs space-y-1">
              <label htmlFor={`${id}-capacity`} className="block font-medium">
                {t('room.capacity.label')}
              </label>
              <select
                id={`${id}-capacity`}
                className={inputStyles}
                value={room.capacity}
                disabled={updateCapacity.isPending}
                onChange={(e) =>
                  updateCapacity.mutate({ roomId: room.id, capacity: Number(e.target.value) })
                }
              >
                {CAPACITY_OPTIONS.filter((n) => n >= players.length).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <Button
            variant={me.isReady ? 'secondary' : 'primary'}
            aria-pressed={me.isReady}
            disabled={setReady.isPending}
            onClick={() => setReady.mutate({ roomId: room.id, ready: !me.isReady })}
          >
            {me.isReady ? t('room.readyToggle.notReady') : t('room.readyToggle.ready')}
          </Button>
        )}

        <p role="status" className="text-fg-muted">
          {waitingText(snapshot)}
        </p>

        {me.isHost && (
          // Eligibility (start.canStart) is decided by the server; START_GAME re-validates it.
          <Button
            variant="primary"
            disabled={!start.canStart || startGame.isPending}
            onClick={() => startGame.mutate({ command: { type: 'START_GAME' } })}
          >
            {startGame.isPending ? t('room.starting') : t('room.start')}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <ConfirmButton
          label={t('room.leave')}
          confirmLabel={t('room.leave.confirm')}
          disabled={leave.isPending}
          onConfirm={() =>
            leave.mutate(room.id, { onSuccess: () => void navigate('/', { replace: true }) })
          }
        />
        <p className="text-sm text-fg-muted">{t('room.identityNote')}</p>
      </div>
    </section>
  );
}

function waitingText({ start }: LobbySnapshot): string {
  if (start.playerCount < start.minPlayers) {
    return t('room.waiting.players', { min: start.minPlayers, count: start.playerCount });
  }
  if (start.notReadyCount === 1) return t('room.waiting.ready.one');
  if (start.notReadyCount > 1) return t('room.waiting.ready.other', { count: start.notReadyCount });
  return t('room.waiting.allReady');
}
