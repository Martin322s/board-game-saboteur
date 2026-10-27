import { useState } from 'react';
import { Button, ConfirmButton } from '../../../components/ui.tsx';
import { inputStyles } from '../../../components/styles.ts';
import {
  getCardDef,
  pathTopology,
  type Coord,
  type HandCard,
  type Rotation,
} from '../../../domain/index.ts';
import { t, type MessageKey } from '../../../i18n/index.ts';
import type { GameCommandInput } from '../../../lib/services/types.ts';
import { CardFace } from '../art/CardFace.tsx';
import { RoleEmblem } from '../art/Icons.tsx';
import { TunnelTile } from '../art/TunnelArt.tsx';
import { cardLabel } from '../format.ts';
import type { Selection } from '../selection.ts';
import {
  cardIssue,
  collapsibleTunnels,
  hiddenDestinationSlots,
  legalCells,
  playerTargets,
  type CardIssue,
  type GameModel,
} from '../model.ts';

const ISSUE_BADGE: Record<Exclude<CardIssue, null>, MessageKey> = {
  BLOCKED: 'hand.badge.blocked',
  NO_PLACE: 'hand.badge.noPlace',
  NO_TARGET: 'hand.badge.noTarget',
};

export function HandArea({
  model,
  selection,
  onSelect,
  onChange,
  onCommand,
  onCancel,
  pending,
  coarse,
  syncing,
}: {
  model: GameModel;
  selection: Selection | null;
  onSelect: (cardId: string) => void;
  onChange: (patch: Partial<Selection>) => void;
  onCommand: (command: GameCommandInput) => void;
  onCancel: () => void;
  pending: boolean;
  coarse: boolean;
  syncing: boolean;
}) {
  const hand = model.mine.state.hand;
  const selected = hand.find((c) => c.id === selection?.cardId) ?? null;
  const canAct = model.isMyTurn && !pending && !syncing;

  return (
    <div className="mine-panel border-t-2 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="min-h-12">
        {selected && selection && canAct ? (
          <ActionBar
            model={model}
            card={selected}
            selection={selection}
            onChange={onChange}
            onCommand={onCommand}
            onCancel={onCancel}
            coarse={coarse}
          />
        ) : (
          <p className="py-2 text-sm font-medium text-fg sm:text-base" aria-live="polite">
            {pending
              ? t('action.pending')
              : model.isMyTurn
                ? t('action.pickCard')
                : model.isActiveRound
                  ? t('action.waiting', {
                      name: model.nameOf(model.pub.round.publicState.activePlayerId),
                    })
                  : t('turn.ended')}
          </p>
        )}
      </div>
      <div className="flex items-end gap-2 sm:gap-3">
        <RoleChip role={model.mine.state.role} />
        <ul
          aria-label={t('hand.label')}
          className="scrollbar-thin flex flex-1 gap-2 overflow-x-auto px-1 pt-3 pb-1 sm:gap-3"
        >
          {hand.map((card) => (
            <HandCardButton
              key={card.id}
              card={card}
              issue={cardIssue(model, card)}
              selected={card.id === selection?.cardId}
              rotation={card.id === selection?.cardId ? selection.rotation : 0}
              disabled={!canAct}
              onSelect={() => onSelect(card.id)}
            />
          ))}
        </ul>
      </div>
      {model.mine.state.knownDestinations.length > 0 && (
        <p className="mt-1 text-xs text-focus" aria-label={t('survey.private')}>
          {model.mine.state.knownDestinations.map((d) =>
            `${t('board.slot', { slot: d.slot + 1 })}: ${t(`destination.${d.identity}`)}`,
          ).join(' · ')}
        </p>
      )}
    </div>
  );
}

function HandCardButton({
  card,
  issue,
  selected,
  rotation,
  disabled,
  onSelect,
}: {
  card: HandCard;
  issue: CardIssue;
  selected: boolean;
  rotation: Rotation;
  disabled: boolean;
  onSelect: () => void;
}) {
  const label = cardLabel(card.typeId);
  return (
    <li className="shrink-0">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={issue ? `${label} — ${t(ISSUE_BADGE[issue])}` : label}
        disabled={disabled}
        onClick={onSelect}
        className={`game-card relative flex h-[108px] w-[76px] flex-col rounded-xl border-2 shadow-lg sm:h-[124px] sm:w-[88px] ${
          selected ? 'border-focus' : 'border-border'
        } ${disabled ? 'cursor-default opacity-85' : 'cursor-pointer hover:border-focus'}`}
      >
        <CardFace typeId={card.typeId} rotation={rotation} />
        {issue && (
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-slate-700 px-1.5 text-[0.6rem] whitespace-nowrap text-slate-100 ring-1 ring-slate-400">
            {t(ISSUE_BADGE[issue])}
          </span>
        )}
      </button>
    </li>
  );
}

/** Compact, private role reminder: hidden until tapped so a neighbour cannot glance at it. */
function RoleChip({ role }: { role: 'MINER' | 'DISRUPTOR' }) {
  const [shown, setShown] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={shown}
      onClick={() => setShown((s) => !s)}
      className="flex h-[76px] w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface-raised text-center text-[0.65rem] leading-tight text-fg sm:w-[76px]"
    >
      {shown ? (
        <>
          <RoleEmblem role={role} className="h-8 w-8" />
          <span>{t('role.chipValue', { role: t(`role.${role}`) })}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="text-lg">
            ?
          </span>
          <span>{t('role.chip')}</span>
        </>
      )}
    </button>
  );
}

/**
 * Contextual "what can I do now?" controls for the selected card. Every board/player interaction
 * also has a keyboard-accessible control here (position lists, target buttons).
 */
function ActionBar({
  model,
  card,
  selection,
  onChange,
  onCommand,
  onCancel,
  coarse,
}: {
  model: GameModel;
  card: HandCard;
  selection: Selection;
  onChange: (patch: Partial<Selection>) => void;
  onCommand: (command: GameCommandInput) => void;
  onCancel: () => void;
  coarse: boolean;
}) {
  const def = getCardDef(card.typeId);
  const discard = (
    <ConfirmButton
      label={t('action.discard')}
      confirmLabel={t('action.discardConfirm')}
      onConfirm={() => onCommand({ type: 'DISCARD', cardId: card.id })}
    />
  );
  const cancel = <Button onClick={onCancel}>{t('action.cancel')}</Button>;
  const row = (instruction: string, ...controls: React.ReactNode[]) => (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <p
        className="mr-auto basis-full text-sm font-medium text-fg sm:basis-auto sm:text-base"
        aria-live="polite"
      >
        {instruction}
      </p>
      {controls}
      {discard}
      {cancel}
    </div>
  );

  switch (def.category) {
    case 'PATH': {
      if (model.blocked) return row(t('action.blocked'));
      const cells = legalCells(model, def.typeId, selection.rotation);
      const other = legalCells(model, def.typeId, selection.rotation === 0 ? 180 : 0);
      const key = (c: Coord | null) => (c ? `${c.x},${c.y}` : '');
      const rotate = (
        <Button
          key="rotate"
          aria-keyshortcuts="R"
          onClick={() => onChange({ rotation: selection.rotation === 0 ? 180 : 0, cell: null })}
        >
          <TunnelTile
            topology={pathTopology(def.typeId, selection.rotation === 0 ? 180 : 0)}
            className="mr-1 h-6 w-6"
          />
          {t('action.rotate')} ({selection.rotation === 0 ? '0°' : '180°'})
        </Button>
      );
      if (cells.length === 0) {
        return row(
          other.length > 0 ? t('action.pathNoneThis') : t('action.pathNone'),
          other.length > 0 ? rotate : null,
        );
      }
      return row(
        coarse ? t('action.pathTouch') : t('action.path'),
        rotate,
        <label key="pos" className="flex items-center gap-1 text-sm">
          <span className="sr-only sm:not-sr-only">{t('action.position')}</span>
          <select
            className={`${inputStyles} min-h-11 w-auto py-1`}
            value={key(selection.cell)}
            onChange={(e) => {
              const cell = cells.find((c) => key(c) === e.target.value) ?? null;
              onChange({ cell });
            }}
          >
            <option value="">{t('action.choose')}</option>
            {cells.map((c) => (
              <option key={key(c)} value={key(c)}>
                {t('board.cell', { x: c.x, y: c.y })}
              </option>
            ))}
          </select>
        </label>,
        <Button
          key="place"
          variant="primary"
          disabled={!selection.cell}
          onClick={() =>
            selection.cell &&
            onCommand({
              type: 'PLAY_PATH',
              cardId: card.id,
              x: selection.cell.x,
              y: selection.cell.y,
              rotation: selection.rotation,
            })
          }
        >
          {t('action.place')}
        </Button>,
      );
    }
    case 'SABOTAGE':
    case 'REPAIR': {
      const targets = playerTargets(model, def);
      if (targets.length === 0) return row(t('action.noPlayerTarget'));
      const chosen = targets.find((target) => target.playerId === selection.playerId);
      if (!chosen) {
        return row(
          def.category === 'SABOTAGE'
            ? t('action.breakPick', { tool: t(`tool.def.${def.tool}`) })
            : t('action.repairPick'),
        );
      }
      const tool = chosen.tools.length === 1 ? chosen.tools[0] : selection.tool;
      const name = model.nameOf(chosen.playerId);
      const toolChoice =
        def.category === 'REPAIR' && chosen.tools.length > 1 ? (
          <span key="tools" role="group" aria-label={t('action.repairTool')} className="flex gap-1">
            {chosen.tools.map((tl) => (
              <Button
                key={tl}
                aria-pressed={selection.tool === tl}
                variant={selection.tool === tl ? 'primary' : 'secondary'}
                onClick={() => onChange({ tool: tl })}
              >
                {t(`tool.${tl}`)}
              </Button>
            ))}
          </span>
        ) : null;
      const confirmLabel = !tool
        ? t('action.repairTool')
        : def.category === 'SABOTAGE'
          ? chosen.playerId === model.myPlayerId
            ? t('action.confirmBreakSelf', { tool: t(`tool.${tool}`) })
            : t('action.confirmBreak', { tool: t(`tool.def.${tool}`), name })
          : t('action.confirmRepair', { tool: t(`tool.def.${tool}`), name });
      return row(
        def.category === 'REPAIR' && chosen.tools.length > 1 && !tool
          ? t('action.repairTool')
          : name,
        toolChoice,
        <Button
          key="go"
          variant="primary"
          disabled={!tool}
          onClick={() =>
            tool &&
            onCommand({
              type: 'PLAY_ACTION',
              cardId: card.id,
              target:
                def.category === 'REPAIR' && def.tools.length > 1
                  ? { kind: 'PLAYER', playerId: chosen.playerId, tool }
                  : { kind: 'PLAYER', playerId: chosen.playerId },
            })
          }
        >
          {confirmLabel}
        </Button>,
      );
    }
    case 'INSPECT': {
      const slots = hiddenDestinationSlots(model);
      return row(
        t('action.surveyPick'),
        <span key="slots" role="group" aria-label={t('action.target')} className="flex gap-1">
          {slots.map((slot) => (
            <Button
              key={slot}
              aria-pressed={selection.slot === slot}
              variant={selection.slot === slot ? 'primary' : 'secondary'}
              onClick={() => onChange({ slot })}
            >
              {t('board.slot', { slot: slot + 1 })}
            </Button>
          ))}
        </span>,
        <Button
          key="go"
          variant="primary"
          disabled={selection.slot === null}
          onClick={() =>
            selection.slot !== null &&
            onCommand({
              type: 'PLAY_ACTION',
              cardId: card.id,
              target: { kind: 'DESTINATION', slot: selection.slot },
            })
          }
        >
          {selection.slot === null
            ? t('action.choose')
            : t('action.confirmSurvey', { slot: selection.slot + 1 })}
        </Button>,
      );
    }
    case 'BOARD': {
      const tunnels = collapsibleTunnels(model);
      if (tunnels.length === 0) return row(t('action.collapseNone'));
      const key = (c: Coord | null) => (c ? `${c.x},${c.y}` : '');
      return row(
        t('action.collapsePick'),
        <label key="pos" className="flex items-center gap-1 text-sm">
          <span className="sr-only sm:not-sr-only">{t('action.target')}</span>
          <select
            className={`${inputStyles} min-h-11 w-auto py-1`}
            value={key(selection.cell)}
            onChange={(e) =>
              onChange({ cell: tunnels.find((c) => key(c) === e.target.value) ?? null })
            }
          >
            <option value="">{t('action.choose')}</option>
            {tunnels.map((c) => (
              <option key={key(c)} value={key(c)}>
                {t('board.cell', { x: c.x, y: c.y })}
              </option>
            ))}
          </select>
        </label>,
        <Button
          key="go"
          variant="danger"
          disabled={!selection.cell}
          onClick={() =>
            selection.cell &&
            onCommand({
              type: 'PLAY_ACTION',
              cardId: card.id,
              target: { kind: 'CELL', x: selection.cell.x, y: selection.cell.y },
            })
          }
        >
          {t('action.confirmCollapse')}
        </Button>,
      );
    }
  }
}
