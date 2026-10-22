import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { buttonStyles } from './styles.ts';

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonStyles }) {
  return <button type={type} className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export function ErrorText({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="text-sm text-damage">
      {children}
    </p>
  );
}

/** Two-step destructive action: first click asks for confirmation inline (no modal). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="danger" disabled={disabled} onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button
        variant="danger"
        disabled={disabled}
        onClick={() => {
          setConfirming(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
    </span>
  );
}
