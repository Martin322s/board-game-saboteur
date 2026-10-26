import { useEffect, useRef, useState } from 'react';
import { playSfx, type Sfx } from '../../lib/audio.ts';
import type { GameModel } from './model.ts';

/**
 * Automatic RESOLVE_EXPIRED_TURN (ARCHITECTURE §8.1 client policy): one request per expired
 * turn from each client — the active player's own client after 250 ms, others after
 * 750–2250 ms (jitter spreads duplicates). The server verifies everything; losing the race
 * (TURN_ALREADY_RESOLVED / STALE_STATE) is normal and just leads to a refetch. TURN_NOT_EXPIRED
 * (local clock estimate slightly early) allows one more attempt. No scheduler involved.
 */
export function useAutoTimeout(
  model: GameModel,
  offset: number,
  resolve: (turnNumber: number) => Promise<string | null>,
) {
  const state = model.pub.round.publicState;
  const deadline = model.isActiveRound ? state.turnDeadline : null;
  const key = `${model.pub.round.id}:${state.turnNumber}`;
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const amActive = model.isMyTurn;
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  });

  useEffect(() => {
    if (deadline === null || attempted.current === key) return;
    const delay = amActive ? 250 : 750 + Math.random() * 1500;
    const wait = Math.max(0, deadline - (Date.now() + offset)) + delay;
    const turnNumber = state.turnNumber;
    const id = setTimeout(() => {
      attempted.current = key;
      void resolveRef.current(turnNumber).then((error) => {
        if (error === 'TURN_NOT_EXPIRED' && retry < 3) {
          attempted.current = null;
          setRetry((n) => n + 1);
        }
      });
    }, wait);
    return () => clearTimeout(id);
  }, [deadline, key, amActive, offset, state.turnNumber, retry]);
}

/** Sound cues for NEW public events only (never for history loaded on refresh). */
export function useGameSounds(model: GameModel, enabled: boolean) {
  const seen = useRef<{ roundId: string; seq: number } | null>(null);
  const wasMyTurn = useRef(model.isMyTurn);

  useEffect(() => {
    const roundId = model.pub.round.id;
    const events = model.pub.events;
    const latest = events.at(-1)?.seq ?? 0;
    const previous = seen.current;
    seen.current = {
      roundId,
      seq: Math.max(latest, previous?.roundId === roundId ? previous.seq : 0),
    };
    if (!enabled || !previous || previous.roundId !== roundId) return;
    for (const event of events) {
      if (event.seq <= previous.seq) continue;
      const sfx: Sfx | null =
        event.type === 'PATH_PLACED'
          ? 'place'
          : event.type === 'TOOL_BROKEN'
            ? 'break'
            : event.type === 'TOOL_REPAIRED'
              ? 'repair'
              : event.type === 'DESTINATION_REVEALED'
                ? 'reveal'
                : event.type === 'ROUND_ENDED'
                  ? event.winner === model.mine.state.role
                    ? 'win'
                    : 'lose'
                  : null;
      if (sfx) playSfx(sfx);
    }
  }, [model, enabled]);

  useEffect(() => {
    if (enabled && model.isMyTurn && !wasMyTurn.current) playSfx('yourTurn');
    wasMyTurn.current = model.isMyTurn;
  }, [model.isMyTurn, enabled]);
}
