import { Link } from 'react-router';
import { t } from '../i18n/index.ts';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-heading" className="mx-auto w-full max-w-2xl space-y-4">
      <h1 id="not-found-heading" className="text-2xl font-bold">
        {t('notFound.heading')}
      </h1>
      <p className="text-fg-muted">{t('notFound.body')}</p>
      <Link to="/" className="inline-block text-accent underline underline-offset-4">
        {t('notFound.back')}
      </Link>
    </section>
  );
}
