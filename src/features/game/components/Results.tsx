import { Dialog } from '../../../components/Dialog.tsx';
import { Button } from '../../../components/ui.tsx';
import { t } from '../../../i18n/index.ts';
import { useServerNow } from '../../../lib/hooks.ts';
import { CrownIcon, RoleEmblem } from '../art/Icons.tsx';
import type { GameModel } from '../model.ts';

/** Round results: winner, reason, revealed roles, points this round and totals, next round. */
export function RoundResults({
  model,
  offset,
  pending,
  onNext,
  onHide,
}: {
  model: GameModel;
  offset: number;
  pending: boolean;
  onNext: () => void;
  onHide: () => void;
}) {
  const { pub } = model;
  const result = pub.round.result;
  const reveal = pub.round.reveal;
  const now = useServerNow(offset);
  const waitSeconds =
    pub.round.resultsDeadline === null
      ? 0
      : Math.max(0, Math.ceil((pub.round.resultsDeadline - now) / 1000));
  // UX only: the server decides who may start the next round (host, or anyone after the deadline).
  const canAdvance = Boolean(model.me?.isHost) || waitSeconds === 0;
  const gained = new Map(
    pub.scores.filter((s) => s.roundNo === pub.round.roundNo).map((s) => [s.playerId, s.points]),
  );
  const goldSlot = reveal?.destinations.indexOf('TREASURE') ?? -1;
  const winner = result?.winner ?? 'NONE';

  return (
    <Dialog
      title={t('results.title', { round: pub.round.roundNo })}
      onClose={onHide}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-gold/50 bg-surface-raised p-3 text-center">
          <p className="text-2xl font-bold text-gold">{t(`results.${winner}`)}</p>
          {result && <p className="text-fg">{t(`results.reason.${result.endReason}`)}</p>}
          {result?.connectorPlayerId && (
            <p className="text-fg">
              {t('results.connector', { name: model.nameOf(result.connectorPlayerId) })}
            </p>
          )}
          {goldSlot >= 0 && (
            <p className="text-sm text-fg-muted">{t('results.gold', { slot: goldSlot + 1 })}</p>
          )}
        </div>

        {reveal && (
          <section>
            <h3 className="mb-2 font-semibold text-gold">{t('results.roles')}</h3>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {reveal.roles.map((r) => (
                <li key={r.playerId} className="flex items-center gap-2 rounded-lg bg-surface-raised p-2">
                  <RoleEmblem role={r.role} className="h-9 w-9 shrink-0" />
                  <span>
                    {model.nameOf(r.playerId)}: <strong>{t(`role.${r.role}`)}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-fg-muted">
              {t('results.setAside', { role: t(`role.${reveal.setAsideRole}`) })}
            </p>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-semibold text-gold">{t('results.points')}</h3>
          <table className="w-full text-left text-sm">
            <thead className="text-fg-muted">
              <tr>
                <th scope="col" className="py-1">
                  {t('final.player')}
                </th>
                <th scope="col" className="py-1 text-right">
                  {t('results.round')}
                </th>
                <th scope="col" className="py-1 text-right">
                  {t('results.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {model.standings.map((s) => (
                <tr key={s.playerId} className="border-t border-border/50">
                  <td className="py-1">{model.nameOf(s.playerId)}</td>
                  <td className="py-1 text-right text-positive">
                    +{gained.get(s.playerId) ?? 0}
                  </td>
                  <td className="py-1 text-right font-semibold">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!canAdvance || pending}
            onClick={onNext}
          >
            {t('results.next', { round: pub.round.roundNo + 1 })}
          </Button>
          <Button className="flex-1" onClick={onHide}>
            {t('results.viewBoard')}
          </Button>
        </div>
        {!canAdvance && (
          <p className="text-sm text-fg-muted">
            {t('results.waitHost')} {t('results.waitAny', { seconds: waitSeconds })}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Final leaderboard: shared ranks from the domain ranking (total, then rounds won). */
export function FinalStandings({
  model,
  pending,
  onPlayAgain,
  onExit,
}: {
  model: GameModel;
  pending: boolean;
  onPlayAgain: () => void;
  onExit: () => void;
}) {
  const winners = model.standings.filter((s) => s.rank === 1).map((s) => model.nameOf(s.playerId));
  const lastWinner = model.pub.round.result?.winner;
  return (
    <Dialog title={t('final.title')} className="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-gold/60 bg-surface-raised p-4 text-center">
          <CrownIcon className="mx-auto h-10 w-10 text-gold" />
          <p className="text-2xl font-bold text-gold">
            {t(winners.length > 1 ? 'final.winners' : 'final.winner', {
              names: winners.join(', '),
            })}
          </p>
          {lastWinner && <p className="text-sm text-fg-muted">{t(`results.${lastWinner}`)}</p>}
        </div>
        <table className="w-full text-left">
          <thead className="text-sm text-fg-muted">
            <tr>
              <th scope="col" className="py-1">
                {t('final.rank')}
              </th>
              <th scope="col" className="py-1">
                {t('final.player')}
              </th>
              <th scope="col" className="py-1 text-right">
                {t('final.points')}
              </th>
              <th scope="col" className="py-1 text-right">
                {t('final.roundsWon')}
              </th>
            </tr>
          </thead>
          <tbody>
            {model.standings.map((s) => (
              <tr
                key={s.playerId}
                className={`border-t border-border/50 ${s.rank === 1 ? 'font-bold text-gold' : ''}`}
              >
                <td className="py-1.5">
                  {s.rank === 1 && <CrownIcon className="mr-1 inline h-4 w-4" />}
                  {s.rank}.
                </td>
                <td className="py-1.5">
                  {model.nameOf(s.playerId)}
                  {s.hasLeft && (
                    <span className="text-sm font-normal text-fg-muted">
                      {' '}
                      ({t('players.left')})
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right">{s.total}</td>
                <td className="py-1.5 text-right">{s.roundsWon}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col gap-2 sm:flex-row">
          {model.me?.isHost ? (
            <Button variant="primary" className="flex-1" disabled={pending} onClick={onPlayAgain}>
              {t('final.playAgain')}
            </Button>
          ) : (
            <p className="flex-1 self-center text-sm text-fg-muted">{t('final.waitHost')}</p>
          )}
          <Button className="flex-1" disabled={pending} onClick={onExit}>
            {t('final.exit')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
