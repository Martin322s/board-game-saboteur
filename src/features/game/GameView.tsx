import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { buttonStyles } from '../../components/styles.ts';
import { Button, ErrorText } from '../../components/ui.tsx';
import { errorMessage, t } from '../../i18n/index.ts';
import { queryKeys } from '../../lib/query/keys.ts';
import type { GameSnapshot, MyGameState, RealtimeStatus } from '../../lib/services/types.ts';
import { GameScreen } from './GameScreen.tsx';
import { useGameSnapshot, useMyGameState } from './hooks.ts';

interface Consistent {
  readonly pub: GameSnapshot;
  readonly mine: MyGameState;
  readonly offset: number;
}

/**
 * Loads the PUBLIC and PRIVATE snapshots and only ever renders a pair that refers to the same
 * round and state version. While a newer pair is being fetched (reconnect, race between the two
 * requests) the last consistent pair stays on screen, marked as syncing, so the board never
 * blanks during a brief reconnect. Lazy-loaded (code-split) from the room route.
 */
export default function GameView({
  roomId,
  roomCode,
  realtimeStatus,
  online = true,
}: {
  roomId: string;
  roomCode: string;
  realtimeStatus: RealtimeStatus;
  online?: boolean;
}) {
  const queryClient = useQueryClient();
  const publicQuery = useGameSnapshot(roomId, realtimeStatus === 'SUBSCRIBED' ? 30_000 : 5_000);
  const privateQuery = useMyGameState(roomId);
  const pub = publicQuery.data;
  const mine = privateQuery.data;
  const consistent =
    pub !== undefined &&
    mine !== undefined &&
    pub.round.id === mine.roundId &&
    pub.round.version === mine.version;

  const [shown, setShown] = useState<Consistent | null>(null);
  if (consistent && (shown?.pub !== pub || shown.mine !== mine)) {
    // Derived state: remember the newest consistent pair (and the server clock offset with it).
    setShown({ pub, mine, offset: pub.serverNow - publicQuery.dataUpdatedAt });
  }

  useEffect(() => {
    if (pub && mine && !consistent) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.game(roomId) });
    }
  }, [pub, mine, consistent, queryClient, roomId]);

  const error = publicQuery.error ?? privateQuery.error;
  if (error?.code === 'NOT_ROOM_MEMBER') {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <p className="text-xl font-semibold">{t('gone.title')}</p>
        <Link to="/" className={buttonStyles.primary}>
          {t('gone.back')}
        </Link>
      </div>
    );
  }
  if (!shown) {
    if (error) {
      return (
        <div className="mx-auto max-w-2xl space-y-3">
          <ErrorText>{errorMessage(error.code)}</ErrorText>
          <Button
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.game(roomId) })}
          >
            {t('common.retry')}
          </Button>
        </div>
      );
    }
    return (
      <p role="status" className="text-center text-fg-muted">
        {pub && mine ? t('game.syncing') : t('game.loading')}
      </p>
    );
  }

  return (
    <GameScreen
      roomId={roomId}
      roomCode={roomCode}
      pub={shown.pub}
      mine={shown.mine}
      offset={shown.offset}
      syncing={!consistent}
      realtimeStatus={realtimeStatus}
      online={online}
    />
  );
}
