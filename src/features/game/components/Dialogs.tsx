import { useState } from 'react';
import { Dialog } from '../../../components/Dialog.tsx';
import { Button } from '../../../components/ui.tsx';
import type { DestinationIdentity, PublicEvent, Role } from '../../../domain/index.ts';
import { t } from '../../../i18n/index.ts';
import { GoldIcon, RocksIcon, RoleEmblem } from '../art/Icons.tsx';
import { eventText } from '../format.ts';

/** Round intro → deliberate "show my role" → "ready". UI privacy only; the server is security. */
export function RoleReveal({
  role,
  roundNo,
  totalRounds,
  onDone,
}: {
  role: Role;
  roundNo: number;
  totalRounds: number;
  onDone: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Dialog title={t('reveal.round', { round: roundNo, total: totalRounds })}>
      {!shown ? (
        <div className="space-y-4">
          <p className="text-fg">{t('reveal.reshuffle')}</p>
          <p className="text-sm text-fg-muted">{t('reveal.privacy')}</p>
          <Button variant="primary" className="w-full" onClick={() => setShown(true)}>
            {t('reveal.show')}
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <RoleEmblem role={role} className="mx-auto h-28 w-28" />
          <p className={`text-2xl font-bold ${role === 'MINER' ? 'text-positive' : 'text-damage'}`}>
            {t('reveal.youAre', { role: t(`role.lower.${role}`) })}
          </p>
          <p className="text-fg">{t(`role.goal.${role}`)}</p>
          <Button variant="primary" className="w-full" onClick={onDone}>
            {t('reveal.ready')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** PRIVATE survey result for the acting player only (from their own command response). */
export function SurveyResultDialog({
  slot,
  identity,
  onClose,
}: {
  slot: number;
  identity: DestinationIdentity;
  onClose: () => void;
}) {
  return (
    <Dialog title={t('survey.title')} onClose={onClose}>
      <div className="space-y-4 text-center">
        <div className="mx-auto h-20 w-20 text-slate-300">
          {identity === 'TREASURE' ? (
            <GoldIcon className="h-full w-full" />
          ) : (
            <RocksIcon className="h-full w-full" />
          )}
        </div>
        <p className="text-sm text-fg-muted">{t('board.slot', { slot: slot + 1 })}</p>
        <p className="text-2xl font-bold text-gold">{t(`survey.${identity}`)}</p>
        <p className="text-sm text-fg-muted">{t('survey.private')}</p>
        <Button variant="primary" className="w-full" onClick={onClose}>
          {t('survey.ok')}
        </Button>
      </div>
    </Dialog>
  );
}

const HELP_SECTIONS = [
  'goal',
  'roles',
  'tunnels',
  'tools',
  'actions',
  'end',
  'score',
  'keys',
] as const;

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title={t('help.title')} onClose={onClose}>
      <div className="space-y-3">
        {HELP_SECTIONS.map((section) => (
          <section key={section}>
            <h3 className="font-semibold text-gold">{t(`help.${section}.h`)}</h3>
            <p className="text-sm text-fg">{t(`help.${section}.b`)}</p>
          </section>
        ))}
        <Button className="w-full" onClick={onClose}>
          {t('help.close')}
        </Button>
      </div>
    </Dialog>
  );
}

export function ActivityFeed({
  events,
  nameOf,
  limit = 12,
}: {
  events: readonly PublicEvent[];
  nameOf: (playerId: string | null) => string;
  limit?: number;
}) {
  const recent = [...events].reverse().slice(0, limit);
  return (
    <section aria-label={t('feed.title')} className="space-y-1">
      <h2 className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
        {t('feed.title')}
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('feed.empty')}</p>
      ) : (
        <ol className="space-y-1 text-sm" aria-live="polite">
          {recent.map((event, i) => (
            <li key={event.seq} className={i === 0 ? 'font-medium text-fg' : 'text-fg-muted'}>
              {eventText(event, nameOf)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
