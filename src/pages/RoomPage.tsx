import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { buttonStyles } from '../components/styles.ts';
import { Button, ErrorText } from '../components/ui.tsx';
import { JoinRoomForm } from '../features/lobby/components/JoinRoomForm.tsx';
import { LobbyView } from '../features/lobby/components/LobbyView.tsx';
import { useRoomSnapshot } from '../features/lobby/hooks.ts';
import { useRoomLiveness } from '../features/lobby/useRoomLiveness.ts';
import { normalizeRoomCode } from '../features/lobby/validation.ts';
import { useAuth } from '../features/session/AuthProvider.tsx';
import { errorMessage, t } from '../i18n/index.ts';
import { queryKeys } from '../lib/query/keys.ts';
import { useOptionalServices } from '../lib/services/ServicesContext.tsx';
import type { LobbySnapshot } from '../lib/services/types.ts';

// Gameplay code (board, cards, dialogs) is split out and loaded only when a game is running.
const GameView = lazy(() => import('../features/game/GameView.tsx'));

export function RoomPage() {
  const services = useOptionalServices();
  if (!services) {
    return <ErrorText>{errorMessage('CONFIG_ERROR')}</ErrorText>;
  }
  return <RoomRoute />;
}

function RoomRoute() {
  const params = useParams();
  const code = normalizeRoomCode(params.code ?? '');
  const { state, ensureSession } = useAuth();

  // The room route needs an identity: restore it, or create one only if none exists.
  useEffect(() => {
    if (state.status === 'SIGNED_OUT') void ensureSession().catch(() => undefined);
  }, [state.status, ensureSession]);

  const ready = state.status === 'READY';
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<LobbySnapshot>(queryKeys.roomSnapshot(code));
  const liveness = useRoomLiveness(cached?.room.id, code);
  const snapshotQuery = useRoomSnapshot(code, {
    enabled: ready,
    // Polling is the fallback while realtime is down; otherwise only a slow safety refetch.
    refetchInterval: cached ? (liveness.realtimeStatus === 'SUBSCRIBED' ? 30_000 : 5_000) : false,
  });
  const snapshot = snapshotQuery.data;

  if (state.status === 'ERROR') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <ErrorText>{errorMessage(state.error.code)}</ErrorText>
        <Button onClick={() => void ensureSession().catch(() => undefined)}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (!ready || snapshotQuery.isPending) {
    return (
      <p role="status" className="mx-auto max-w-2xl text-fg-muted">
        {t('room.loading')}
      </p>
    );
  }

  if (snapshotQuery.error && !snapshot) {
    if (snapshotQuery.error.code === 'NOT_ROOM_MEMBER') {
      return (
        <div className="mx-auto max-w-md space-y-4 rounded-lg border border-border p-4">
          <p className="text-fg-muted">{t('room.notMember.body', { code })}</p>
          <JoinRoomForm
            fixedCode={code}
            heading={t('room.notMember.heading')}
            onJoined={() => void snapshotQuery.refetch()}
          />
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <ErrorText>{errorMessage(snapshotQuery.error.code)}</ErrorText>
        <div className="flex gap-2">
          <Button onClick={() => void snapshotQuery.refetch()}>{t('common.retry')}</Button>
          <Link to="/" className={buttonStyles.secondary}>
            {t('notFound.back')}
          </Link>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  if (snapshot.room.status === 'IN_GAME' || snapshot.room.status === 'FINISHED') {
    return (
      <Suspense
        fallback={
          <p role="status" className="text-center text-fg-muted">
            {t('game.loading')}
          </p>
        }
      >
        <GameView
          roomId={snapshot.room.id}
          roomCode={snapshot.room.code}
          realtimeStatus={liveness.realtimeStatus}
          online={liveness.online}
        />
      </Suspense>
    );
  }
  if (snapshot.room.status !== 'LOBBY') {
    return <p className="mx-auto max-w-2xl text-fg-muted">{t('room.closed')}</p>;
  }

  return (
    <LobbyView
      snapshot={snapshot}
      realtimeStatus={liveness.realtimeStatus}
      online={liveness.online}
    />
  );
}
