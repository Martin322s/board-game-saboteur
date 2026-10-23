/** Centralized TanStack Query keys. */
export const queryKeys = {
  roomSnapshot: (code: string) => ['room', code, 'snapshot'] as const,
  myActiveRoom: (userId: string) => ['session', userId, 'activeRoom'] as const,
  gameSnapshot: (roomId: string) => ['game', roomId, 'public'] as const,
  myGameState: (roomId: string) => ['game', roomId, 'private'] as const,
  /** Prefix covering both game queries of a room. */
  game: (roomId: string) => ['game', roomId] as const,
};
