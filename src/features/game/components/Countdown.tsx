import { t } from '../../../i18n/index.ts';
import { useServerNow } from '../../../lib/hooks.ts';

/**
 * Turn countdown from the AUTHORITATIVE deadline and the measured server-clock offset.
 * Isolated so only this component rerenders every second. No flashing: the last 10 seconds
 * only change colour/weight.
 */
export function Countdown({
  deadline,
  startedAt,
  offset,
}: {
  deadline: number;
  startedAt: number;
  offset: number;
}) {
  const now = useServerNow(offset);
  const remainingMs = Math.max(0, deadline - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const total = Math.max(1, deadline - startedAt);
  const fraction = Math.min(1, remainingMs / total);
  const urgent = seconds <= 10;
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  if (remainingMs === 0) {
    return (
      <span role="status" className="text-sm font-semibold text-fg">
        {t('timer.resolving')}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={t('timer.label', { time })}
      role="timer"
    >
      <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90" aria-hidden="true">
        <circle cx={18} cy={18} r={15} fill="none" stroke="#607e92" strokeWidth={4} />
        <circle
          cx={18}
          cy={18}
          r={15}
          fill="none"
          stroke={urgent ? '#ff9a9e' : '#a8c9db'}
          strokeWidth={4}
          strokeDasharray={`${fraction * 94.25} 94.25`}
          strokeLinecap="round"
        />
      </svg>
      <span
        className={`font-mono tabular-nums ${urgent ? 'text-lg font-bold text-damage' : 'text-base text-fg'}`}
      >
        {time}
      </span>
    </span>
  );
}
