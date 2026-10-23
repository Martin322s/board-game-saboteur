import { t } from '../i18n/index.ts';

/** Route-level error boundary UI. Error reporting is wired up in a later iteration. */
export function RouteErrorPage() {
  return (
    <main
      role="alert"
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 px-4"
    >
      <h1 className="text-2xl font-bold">{t('error.heading')}</h1>
      <p className="text-fg-muted">{t('error.body')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="self-start rounded-md border border-border bg-surface-raised px-4 py-2"
      >
        {t('error.reload')}
      </button>
    </main>
  );
}
