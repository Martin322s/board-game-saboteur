import { useId, useState, type FormEvent } from 'react';
import { inputStyles } from '../../../components/styles.ts';
import { Button, ErrorText } from '../../../components/ui.tsx';
import { errorMessage, t } from '../../../i18n/index.ts';
import { toAppError, type AppErrorCode } from '../../../lib/errors/appError.ts';
import type { RoomRef } from '../../../lib/services/types.ts';
import { loadDisplayName, saveDisplayName } from '../../../lib/storage.ts';
import { useJoinRoom } from '../hooks.ts';
import {
  isValidDisplayName,
  isValidRoomCode,
  normalizeDisplayName,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
} from '../validation.ts';

/** Join by code. With `fixedCode` (room route) only the name is asked for. */
export function JoinRoomForm({
  fixedCode,
  heading,
  onJoined,
}: {
  fixedCode?: string;
  heading: string;
  onJoined: (room: RoomRef) => void;
}) {
  const id = useId();
  const joinRoom = useJoinRoom();
  const [name, setName] = useState(loadDisplayName);
  const [code, setCode] = useState(fixedCode ?? '');
  const [error, setError] = useState<AppErrorCode | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const displayName = normalizeDisplayName(name);
    const roomCode = normalizeRoomCode(code);
    if (!isValidRoomCode(roomCode)) {
      setError('ROOM_NOT_FOUND');
      return;
    }
    if (!isValidDisplayName(displayName)) {
      setError('INVALID_NAME');
      return;
    }
    setError(null);
    joinRoom.mutate(
      { code: roomCode, displayName },
      {
        onSuccess: (room) => {
          saveDisplayName(displayName);
          onJoined(room);
        },
        onError: (e) => setError(toAppError(e).code),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
        {heading}
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
          aria-describedby={`${id}-name-hint`}
          aria-invalid={error === 'INVALID_NAME' || error === 'NAME_TAKEN'}
          onChange={(e) => setName(e.target.value)}
        />
        <p id={`${id}-name-hint`} className="text-sm text-fg-muted">
          {t('form.displayName.hint')}
        </p>
      </div>
      {fixedCode === undefined && (
        <div className="space-y-1">
          <label htmlFor={`${id}-code`} className="block font-medium">
            {t('form.roomCode')}
          </label>
          <input
            id={`${id}-code`}
            className={`${inputStyles} font-mono uppercase tracking-[0.3em]`}
            value={code}
            maxLength={ROOM_CODE_LENGTH + 4}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-describedby={`${id}-code-hint`}
            aria-invalid={error === 'ROOM_NOT_FOUND'}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <p id={`${id}-code-hint`} className="text-sm text-fg-muted">
            {t('form.roomCode.hint')}
          </p>
        </div>
      )}
      {error && <ErrorText>{errorMessage(error)}</ErrorText>}
      <Button type="submit" variant="primary" disabled={joinRoom.isPending}>
        {joinRoom.isPending ? t('common.pleaseWait') : t('form.join.submit')}
      </Button>
    </form>
  );
}
