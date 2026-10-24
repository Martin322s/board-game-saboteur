import { Link, useNavigate } from 'react-router';
import { buttonStyles } from '../components/styles.ts';
import { DECK_CATALOG, RULES_VERSION } from '../domain/index.ts';
import { CreateRoomForm } from '../features/lobby/components/CreateRoomForm.tsx';
import { JoinRoomForm } from '../features/lobby/components/JoinRoomForm.tsx';
import { useMyActiveRoom } from '../features/lobby/hooks.ts';
import { t } from '../i18n/index.ts';
import { useOptionalServices } from '../lib/services/ServicesContext.tsx';

const deckSize = DECK_CATALOG.reduce((sum, card) => sum + card.quantity, 0);

export function LandingPage() {
  const services = useOptionalServices();
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <section aria-labelledby="home-heading" className="space-y-3">
        <h1 id="home-heading" className="text-3xl font-bold text-gold">
          {t('app.title')}
        </h1>
        <p className="text-fg-muted">{t('home.description')}</p>
        <p className="text-sm text-fg-muted">
          {t('home.rulesInfo', { version: RULES_VERSION, cards: deckSize })}
        </p>
      </section>

      {services ? (
        <>
          <ResumeRoom />
          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <CreateRoomForm />
            </div>
            <div className="rounded-lg border border-border p-4">
              <JoinFromLanding />
            </div>
          </div>
        </>
      ) : (
        <p role="alert" className="rounded-md border border-border p-3 text-fg">
          {t('landing.configMissing')}
        </p>
      )}
    </div>
  );
}

function JoinFromLanding() {
  const navigate = useNavigate();
  return (
    <JoinRoomForm
      heading={t('landing.join.heading')}
      onJoined={(room) => void navigate(`/r/${room.code}`)}
    />
  );
}

/** Reconnect discovery for a returning browser session (never creates a session itself). */
function ResumeRoom() {
  const activeRoom = useMyActiveRoom();
  const room = activeRoom.data;
  if (!room) return null;
  return (
    <p className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised p-3">
      <span>{t('landing.resume', { code: room.code })}</span>
      <Link to={`/r/${room.code}`} className={buttonStyles.secondary}>
        {t('landing.resume.action')}
      </Link>
    </p>
  );
}
