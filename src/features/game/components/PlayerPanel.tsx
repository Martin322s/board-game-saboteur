import { TOOLS } from '../../../domain/index.ts';
import { t } from '../../../i18n/index.ts';
import { CrackMark, CrownIcon, ToolIcon } from '../art/Icons.tsx';
import type { GameModel } from '../model.ts';

const CONNECTION_DOT = {
  CONNECTED: 'bg-green-600',
  AWAY: 'bg-amber-600',
  DISCONNECTED: 'bg-stone-500',
} as const;

/**
 * Public player information only: name, turn, host, hand COUNT, score, tools, connection.
 * Roles are never shown here during a round. When an action card is selected, valid targets
 * become buttons labelled with the action they perform.
 */
export function PlayerPanel({
  model,
  orientation,
  targets,
  chosenPlayerId,
  onTarget,
}: {
  model: GameModel;
  orientation: 'row' | 'column';
  targets?: ReadonlyMap<string, string> | undefined; // playerId → accessible action label
  chosenPlayerId?: string | null | undefined;
  onTarget?: ((playerId: string) => void) | undefined;
}) {
  const active = model.pub.round.publicState.activePlayerId;
  const scores = new Map(model.standings.map((s) => [s.playerId, s.total]));

  return (
    <ul
      aria-label={t('players.label')}
      className={
        orientation === 'row'
          ? 'scrollbar-thin flex gap-2 overflow-x-auto px-2 py-1.5'
          : 'flex flex-col gap-2'
      }
    >
      {model.pub.players.map((player) => {
        const view = model.publicPlayer(player.playerId);
        const broken = view ? TOOLS.filter((tool) => view.tools[tool] === 'BROKEN') : [];
        const isActive = model.isActiveRound && player.playerId === active;
        const left = player.status !== 'ACTIVE' || view?.hasLeft;
        const targetLabel = targets?.get(player.playerId);
        const chosen = chosenPlayerId === player.playerId;

        const body = (
          <>
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                  isActive
                    ? 'border-gold bg-gold/15 text-gold'
                    : 'border-border bg-slate-600 text-fg'
                }`}
              >
                {player.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {player.displayName}
                  {player.isMe && (
                    <span className="font-normal text-fg-muted"> ({t('players.you')})</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                  {isActive && <span className="font-bold text-gold">▶ {t('players.turn')}</span>}
                  <span>{t('players.cards', { count: view?.handCount ?? 0 })}</span>
                  <span>{t('players.score', { points: scores.get(player.playerId) ?? 0 })}</span>
                </span>
              </span>
              {player.isHost && (
                <span className="ml-auto text-gold" title={t('players.host')}>
                  <CrownIcon className="h-4 w-4" />
                  <span className="sr-only">{t('players.host')}</span>
                </span>
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {broken.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-red-950/50 px-1.5 py-0.5 text-red-200">
                  {broken.map((tool) => (
                    <span key={tool} className="relative inline-flex h-4 w-4">
                      <ToolIcon tool={tool} className="h-4 w-4" />
                      <CrackMark className="absolute inset-0 h-4 w-4 text-red-300" />
                    </span>
                  ))}
                  <span className="sr-only sm:not-sr-only">
                    {t('players.broken', {
                      tools: broken.map((tool) => t(`tool.${tool}`)).join(', '),
                    })}
                  </span>
                </span>
              )}
              {left ? (
                <span className="rounded bg-slate-600 px-1.5 py-0.5 text-slate-200">{t('players.left')}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-fg-muted">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${CONNECTION_DOT[player.connection]}`}
                  />
                  {t(`room.connection.${player.connection}`)}
                </span>
              )}
              {view?.isAfk && !left && (
                <span className="rounded bg-slate-600 px-1.5 py-0.5 text-slate-100">{t('players.afk')}</span>
              )}
            </span>
          </>
        );

        const base = `rounded-xl border px-2.5 py-2 text-left text-sm ${
          orientation === 'row' ? 'min-w-44 shrink-0' : ''
        } ${isActive ? 'border-gold bg-surface-raised shadow-md ring-2 ring-gold/25' : 'border-border/70 bg-surface-raised shadow-sm'} ${
          left ? 'opacity-60' : ''
        }`;

        return (
          <li key={player.playerId}>
            {targetLabel ? (
              <button
                type="button"
                aria-label={targetLabel}
                aria-pressed={chosen}
                onClick={() => onTarget?.(player.playerId)}
                className={`${base} block w-full cursor-pointer outline-2 ${
                  chosen ? 'outline outline-focus' : 'outline-dashed outline-focus/70'
                }`}
              >
                {body}
              </button>
            ) : (
              <div className={base}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
