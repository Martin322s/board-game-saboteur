import { useState } from 'react';
import { Button } from '../../../components/ui.tsx';
import { t } from '../../../i18n/index.ts';

export function RoomCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/r/${code}`;
  const canShare = typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: t('app.title'), text: t('room.share.text', { code }), url });
    } catch {
      // User cancelled or sharing failed; copying remains available.
    }
  };

  return (
    <section
      aria-label={t('room.code.label')}
      className="space-y-3 rounded-lg border border-border bg-surface-raised p-4"
    >
      <p className="text-sm text-fg-muted">{t('room.code.label')}</p>
      <p className="font-mono text-4xl font-bold tracking-[0.3em] text-accent">{code}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>{t('room.copyLink')}</Button>
        {canShare && <Button onClick={() => void share()}>{t('room.share')}</Button>}
      </div>
      <p role="status" className="min-h-5 text-sm text-fg-muted">
        {copied ? t('room.copied') : ''}
      </p>
    </section>
  );
}
