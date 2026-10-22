const base =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-60';

/** Shared Tailwind class strings (44 px minimum touch targets). */
export const buttonStyles = {
  primary: `${base} border border-slate-400/60 bg-accent text-slate-950 shadow-sm hover:brightness-110`,
  secondary: `${base} border border-border bg-surface-raised text-fg hover:border-fg-muted`,
  danger: `${base} border border-red-400/60 bg-red-950/40 text-red-200 hover:border-red-300`,
};

export const inputStyles =
  'min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-fg placeholder:text-fg-muted';
