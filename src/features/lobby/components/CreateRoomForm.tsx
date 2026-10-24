import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { inputStyles } from '../../../components/styles.ts';
import { Button, ErrorText } from '../../../components/ui.tsx';
import { errorMessage, t } from '../../../i18n/index.ts';
import { toAppError, type AppErrorCode } from '../../../lib/errors/appError.ts';
import { loadDisplayName, saveDisplayName } from '../../../lib/storage.ts';
import { useCreateRoom } from '../hooks.ts';
import {
  CAPACITY_OPTIONS,
  DEFAULT_CAPACITY,
  isValidDisplayName,
  normalizeDisplayName,
} from '../validation.ts';

export function CreateRoomForm() {
  const id = useId();
  const navigate = useNavigate();
  const createRoom = useCreateRoom();
  const [name, setName] = useState(loadDisplayName);
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [error, setError] = useState<AppErrorCode | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const displayName = normalizeDisplayName(name);
    if (!isValidDisplayName(displayName)) {
      setError('INVALID_NAME');
      return;
    }
    setError(null);
    createRoom.mutate(
      { displayName, capacity },
      {
        onSuccess: (room) => {
          saveDisplayName(displayName);
          void navigate(`/r/${room.code}`);
        },
        onError: (e) => setError(toAppError(e).code),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
        {t('landing.create.heading')}
      </h2>
      <div className="space-y-1">
        <label htmlFor={`${id}-name`} className="block font-medium">
          {t('form.displayName')}
        </label>
        <input
          id={`${id}-name`}
          className={inputStyles}
          value={name}
          maxLength={40}
          autoComplete="nickname"
          aria-describedby={`${id}-name-hint${error ? ` ${id}-error` : ''}`}
          aria-invalid={error === 'INVALID_NAME'}
          onChange={(e) => setName(e.target.value)}
        />
        <p id={`${id}-name-hint`} className="text-sm text-fg-muted">
          {t('form.displayName.hint')}
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-capacity`} className="block font-medium">
          {t('form.capacity')}
        </label>
        <select
          id={`${id}-capacity`}
          className={inputStyles}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
        >
          {CAPACITY_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {error && <ErrorText id={`${id}-error`}>{errorMessage(error)}</ErrorText>}
      <Button type="submit" variant="primary" disabled={createRoom.isPending}>
        {createRoom.isPending ? t('common.pleaseWait') : t('form.create.submit')}
      </Button>
    </form>
  );
}
