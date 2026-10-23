import { Link, Outlet } from 'react-router';
import { t } from '../i18n/index.ts';

export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface-raised focus:px-4 focus:py-2"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="border-b border-border px-4 py-3">
        <Link to="/" className="text-lg font-semibold text-gold">
          {t('app.title')}
        </Link>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-3 text-sm text-fg-muted">
        {t('footer.notice')}
      </footer>
    </div>
  );
}
