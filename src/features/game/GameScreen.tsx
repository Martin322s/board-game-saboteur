import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '../../components/Dialog.tsx';
import { Button, ConfirmButton } from '../../components/ui.tsx';
import { getCardDef, pathTopology, type DestinationIdentity } from '../../domain/index.ts';
import { errorMessage, t } from '../../i18n/index.ts';
import { loadSoundEnabled, saveSoundEnabled, unlockAudio } from '../../lib/audio.ts';
import { toAppError, type AppErrorCode } from '../../lib/errors/appError.ts';
import { useCoarsePointer } from '../../lib/hooks.ts';
import type {
  GameCommandInput,
  GameSnapshot,
  MyGameState,
  RealtimeStatus,
} from '../../lib/services/types.ts';
import { useLeaveRoom, useResetRoom } from '../lobby/hooks.ts';
import { BoardView, type BoardInteraction } from './board/BoardView.tsx';
import { Countdown } from './components/Countdown.tsx';
import { ActivityFeed, HelpDialog, RoleReveal, SurveyResultDialog } from './components/Dialogs.tsx';
import { HandArea } from './components/HandArea.tsx';
import { PlayerPanel } from './components/PlayerPanel.tsx';
import { FinalStandings, RoundResults } from './components/Results.tsx';
import { eventText } from './format.ts';
import { useGameCommand } from './hooks.ts';
import {
  buildModel,
  collapsibleTunnels,
  hiddenDestinationSlots,
  legalCells,
  playerTargets,
} from './model.ts';
import { newSelection, type Selection } from './selection.ts';
import { useAutoTimeout, useGameSounds } from './useGameEffects.ts';

/** Expected concurrency outcomes: refetch quietly instead of showing an error. */
const QUIET: ReadonlySet<AppErrorCode> = new Set([
  'STALE_STATE',
  'TURN_ALREADY_RESOLVED',
  'TURN_NOT_EXPIRED',
  'COMMAND_ID_REUSED',
]);
const GONE: ReadonlySet<AppErrorCode> = new Set(['NOT_ROOM_MEMBER', 'PLAYER_LEFT', 'NOT_A_PLAYER']);
const ROLE_SEEN_KEY = 'tunnels.roleSeen';

function roleSeen(roundId: string): boolean {
  try {
    return sessionStorage.getItem(ROLE_SEEN_KEY) === roundId;
  } catch {
    return false;
  }
}

export function GameScreen({
  roomId,
  roomCode,
  pub,
  mine,
  offset,
  syncing,
  realtimeStatus,
  online,
}: {
  roomId: string;
  roomCode: string;
  pub: GameSnapshot;
  mine: MyGameState;
  offset: number;
  syncing: boolean;
  realtimeStatus: RealtimeStatus;
  online: boolean;
}) {
  const navigate = useNavigate();
  const model = useMemo(() => buildModel(pub, mine), [pub, mine]);
  const coarse = useCoarsePointer();
  const command = useGameCommand(roomId, roomCode);
  const quiet = useGameCommand(roomId, roomCode);
  const reset = useResetRoom(roomCode);
  const leaveRoom = useLeaveRoom(roomCode);

  const [rawSelection, setSelection] = useState<Selection | null>(null);
  const [survey, setSurvey] = useState<{ slot: number; identity: DestinationIdentity } | null>(
    null,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hiddenResults, setHiddenResults] = useState<string | null>(null);
  const [revealedRound, setRevealedRound] = useState(() =>
    roleSeen(pub.round.id) ? pub.round.id : null,
  );
  const [soundOn, setSoundOn] = useState(loadSoundEnabled);
  const [toast, setToast] = useState<string | null>(null);
  const [fatal, setFatal] = useState<'OUTDATED' | 'GONE' | null>(null);
  const versionRef = useRef(pub.round.version);
  useEffect(() => {
    versionRef.current = pub.round.version;
  });

  const canAct = model.isMyTurn && !command.isPending && !syncing;
  // A selection only counts for the state version it was made at (derived, no effect needed).
  const candidate = mine.state.hand.find((c) => c.id === rawSelection?.cardId) ?? null;
  const selection =
    rawSelection && candidate && canAct && rawSelection.version === pub.round.version
      ? rawSelection
      : null;
  const card = selection ? candidate : null;
  const def = card ? getCardDef(card.typeId) : null;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleError = useCallback((error: unknown) => {
    const code = toAppError(error).code;
    if (code === 'CLIENT_OUTDATED') setFatal('OUTDATED');
    else if (GONE.has(code)) setFatal('GONE');
    else if (!QUIET.has(code)) setToast(errorMessage(code));
    return code;
  }, []);

  const send = (input: GameCommandInput, versioned = true) => {
    command.mutate(
      { command: input, ...(versioned ? { expectedVersion: pub.round.version } : {}) },
      {
        onSuccess: (response) => {
          const scout = response.private?.find((e) => e.kind === 'SCOUT_RESULT');
          if (scout?.kind === 'SCOUT_RESULT')
            setSurvey({ slot: scout.slot, identity: scout.identity });
          setSelection(null);
          if (input.type === 'LEAVE') void navigate('/', { replace: true });
        },
        onError: handleError,
      },
    );
  };

  useAutoTimeout(model, offset, async (turnNumber) => {
    try {
      await quiet.mutateAsync({
        command: { type: 'RESOLVE_EXPIRED_TURN', expectedTurnNumber: turnNumber },
        expectedVersion: versionRef.current,
      });
      return null;
    } catch (error) {
      const code = toAppError(error).code;
      if (code === 'CLIENT_OUTDATED') setFatal('OUTDATED');
      return code;
    }
  });
  useGameSounds(model, soundOn);

  // Keyboard: Esc cancels, R rotates (physical key, so it works with Cyrillic layouts).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        (target.closest('input, select, textarea, [contenteditable="true"]') ||
          target.closest('[role="dialog"]'))
      ) {
        return;
      }
      if (event.key === 'Escape') setSelection(null);
      if (event.code === 'KeyR' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        setSelection((s) =>
          s && def?.category === 'PATH'
            ? { ...s, rotation: s.rotation === 0 ? 180 : 0, cell: null }
            : s,
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [def]);

  const patch = (p: Partial<Selection>) => setSelection((s) => (s ? { ...s, ...p } : s));

  // Board interaction for the selected card (UX preview; the server validates everything).
  const interaction = useMemo<BoardInteraction>(() => {
    if (!canAct || !card || !def || !selection) return {};
    switch (def.category) {
      case 'PATH':
        if (model.blocked) return {};
        return {
          legalCells: legalCells(model, def.typeId, selection.rotation),
          ghost: pathTopology(def.typeId, selection.rotation),
          chosenCell: selection.cell,
          onCell: (cell) => {
            if (coarse) setSelection((s) => (s ? { ...s, cell } : s));
            else
              send({
                type: 'PLAY_PATH',
                cardId: card.id,
                x: cell.x,
                y: cell.y,
                rotation: selection.rotation,
              });
          },
        };
      case 'INSPECT':
        return {
          surveySlots: hiddenDestinationSlots(model),
          chosenSlot: selection.slot,
          onSlot: (slot) => setSelection((s) => (s ? { ...s, slot } : s)),
        };
      case 'BOARD':
        return {
          collapseCells: collapsibleTunnels(model),
          chosenCell: selection.cell,
          onCollapse: (cell) => setSelection((s) => (s ? { ...s, cell } : s)),
        };
      default:
        return {};
    }
    // `send` is recreated each render but only used inside the click handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAct, card, def, selection, model, coarse]);

  const playerTargetLabels = useMemo(() => {
    if (!canAct || !def || (def.category !== 'SABOTAGE' && def.category !== 'REPAIR'))
      return undefined;
    return new Map(
      playerTargets(model, def).map(
        (target) =>
          [
            target.playerId,
            t('action.pickPlayer', { name: model.nameOf(target.playerId) }),
          ] as const,
      ),
    );
  }, [canAct, def, model]);

  const state = pub.round.publicState;
  const connection = !online
    ? 'offline'
    : realtimeStatus === 'SUBSCRIBED'
      ? 'online'
      : 'reconnecting';
  const finished = pub.game.status !== 'IN_PROGRESS';
  const showRoleReveal = model.isActiveRound && revealedRound !== pub.round.id && !fatal;
  const showResults = !model.isActiveRound && !finished && hiddenResults !== pub.round.id;
  const lastEvent = pub.events.at(-1);

  const toggleSound = () => {
    const next = !soundOn;
    if (next) unlockAudio();
    saveSoundEnabled(next);
    setSoundOn(next);
  };

  return (
    <div className="mine-bg fixed inset-0 z-30 flex flex-col text-fg">
      <header className="mine-panel flex items-center gap-2 border-b-2 px-2 py-1.5 sm:gap-3 sm:px-4">
        <span className="hidden text-lg font-bold text-gold sm:inline">{t('app.title')}</span>
        <span className="hidden text-sm text-fg-muted md:inline">
          {t('top.room', { code: roomCode })}
        </span>
        <span className="rounded-md border border-border/60 bg-surface-raised px-2 py-0.5 text-sm whitespace-nowrap">
          {t('top.round', { round: pub.round.roundNo, total: pub.game.totalRounds })}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3" aria-live="polite">
          {model.isActiveRound ? (
            model.isMyTurn ? (
              <span className="rounded-lg border border-gold/60 bg-surface-raised px-2 py-1 text-sm font-extrabold tracking-wide whitespace-nowrap text-gold sm:px-3 sm:text-lg">
                {t('turn.mine')}
              </span>
            ) : (
              <span className="truncate text-sm font-semibold sm:text-base">
                {t('turn.other', { name: model.nameOf(state.activePlayerId) })}
              </span>
            )
          ) : (
            <span className="text-sm font-semibold">{t('turn.ended')}</span>
          )}
          {model.isActiveRound && state.turnDeadline !== null && (
            <Countdown
              deadline={state.turnDeadline}
              startedAt={state.turnStartedAt}
              offset={offset}
            />
          )}
        </div>
        <span className="inline-flex items-center gap-1 text-xs" role="status">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${connection === 'online' ? 'bg-green-600' : connection === 'offline' ? 'bg-red-600' : 'bg-amber-600'}`}
          />
          <span className={connection === 'online' ? 'sr-only' : ''}>
            {t(`conn.${connection}`)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          aria-label={t('top.help')}
          className="hidden h-10 w-10 rounded-full border border-border text-lg font-bold sm:block"
        >
          ?
        </button>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? t('top.soundOn') : t('top.soundOff')}
          className="hidden h-10 w-10 rounded-full border border-border sm:block"
        >
          <span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span>
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={t('top.events')}
          className="h-10 w-10 rounded-full border border-border"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>

      <div className="border-b border-border bg-surface/80 lg:hidden">
        <PlayerPanel
          model={model}
          orientation="row"
          targets={playerTargetLabels}
          chosenPlayerId={selection?.playerId}
          onTarget={(playerId) => patch({ playerId, tool: null })}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-surface/80 p-3 lg:flex">
          <PlayerPanel
            model={model}
            orientation="column"
            targets={playerTargetLabels}
            chosenPlayerId={selection?.playerId}
            onTarget={(playerId) => patch({ playerId, tool: null })}
          />
          <ActivityFeed events={pub.events} nameOf={model.nameOf} />
        </aside>
        <main className="relative min-w-0 flex-1">
          <BoardView
            board={state.board}
            known={mine.state.knownDestinations}
            interaction={interaction}
          />
          {lastEvent && (
            <p className="pointer-events-none absolute top-2 left-2 max-w-[70%] rounded-md bg-surface-raised/95 px-2 py-1 text-xs text-fg shadow-sm lg:hidden">
              {eventText(lastEvent, model.nameOf)}
            </p>
          )}
          {(syncing || command.isPending) && (
            <p
              role="status"
              className="absolute top-2 right-2 rounded-md bg-surface-raised/95 px-2 py-1 text-xs text-fg"
            >
              {command.isPending ? t('action.pending') : t('game.syncing')}
            </p>
          )}
          {toast && (
            <p
              role="alert"
              className="absolute inset-x-4 top-10 mx-auto max-w-md rounded-lg border border-red-400 bg-red-950/95 p-2 text-center text-sm text-red-200"
            >
              {toast}
            </p>
          )}
          {!model.isActiveRound && !finished && hiddenResults === pub.round.id && (
            <Button
              variant="primary"
              className="absolute bottom-3 left-3"
              onClick={() => setHiddenResults(null)}
            >
              {t('results.show')}
            </Button>
          )}
          <p className="sr-only">{t('action.shortcuts')}</p>
        </main>
      </div>

      {model.isActiveRound && (
        <HandArea
          model={model}
          selection={selection}
          onSelect={(cardId) =>
            setSelection(
              selection?.cardId === cardId ? null : newSelection(cardId, pub.round.version),
            )
          }
          onChange={patch}
          onCommand={(input) => send(input)}
          onCancel={() => setSelection(null)}
          pending={command.isPending}
          coarse={coarse}
          syncing={syncing}
        />
      )}

      {showRoleReveal && (
        <RoleReveal
          role={mine.state.role}
          roundNo={pub.round.roundNo}
          totalRounds={pub.game.totalRounds}
          onDone={() => {
            try {
              sessionStorage.setItem(ROLE_SEEN_KEY, pub.round.id);
            } catch {
              // Only a convenience.
            }
            setRevealedRound(pub.round.id);
          }}
        />
      )}
      {survey && (
        <SurveyResultDialog
          slot={survey.slot}
          identity={survey.identity}
          onClose={() => setSurvey(null)}
        />
      )}
      {showResults && (
        <RoundResults
          model={model}
          offset={offset}
          pending={command.isPending}
          onNext={() => send({ type: 'START_NEXT_ROUND' }, false)}
          onHide={() => setHiddenResults(pub.round.id)}
        />
      )}
      {finished && !fatal && (
        <FinalStandings
          model={model}
          pending={reset.isPending || leaveRoom.isPending}
          onPlayAgain={() => reset.mutate(roomId, { onError: handleError })}
          onExit={() =>
            leaveRoom.mutate(roomId, { onSuccess: () => void navigate('/', { replace: true }) })
          }
        />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {menuOpen && (
        <Dialog title={t('top.events')} onClose={() => setMenuOpen(false)}>
          <div className="space-y-4">
            <div className="flex gap-2 sm:hidden">
              <Button
                className="flex-1"
                onClick={() => {
                  setMenuOpen(false);
                  setHelpOpen(true);
                }}
              >
                {t('top.help')}
              </Button>
              <Button className="flex-1" aria-pressed={soundOn} onClick={toggleSound}>
                {soundOn ? t('top.soundOn') : t('top.soundOff')}
              </Button>
            </div>
            <ActivityFeed events={pub.events} nameOf={model.nameOf} limit={30} />
            {!finished && (
              <ConfirmButton
                label={t('top.leave')}
                confirmLabel={t('top.leaveConfirm')}
                onConfirm={() => send({ type: 'LEAVE' }, false)}
              />
            )}
            <Button className="w-full" onClick={() => setMenuOpen(false)}>
              {t('help.close')}
            </Button>
          </div>
        </Dialog>
      )}
      {fatal === 'OUTDATED' && (
        <Dialog title={t('outdated.title')}>
          <p className="mb-4">{t('outdated.body')}</p>
          <Button variant="primary" className="w-full" onClick={() => window.location.reload()}>
            {t('outdated.reload')}
          </Button>
        </Dialog>
      )}
      {fatal === 'GONE' && (
        <Dialog title={t('gone.title')}>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => void navigate('/', { replace: true })}
          >
            {t('gone.back')}
          </Button>
        </Dialog>
      )}
    </div>
  );
}
