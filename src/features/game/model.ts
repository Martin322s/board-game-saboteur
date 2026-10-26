import {
  computeStandings,
  getCardDef,
  isBlocked,
  legalPlacements,
  type ActionCardDef,
  type Coord,
  type HandCard,
  type PathTypeId,
  type PlacedPath,
  type PublicPlayerView,
  type Rotation,
  type Standing,
  type Tool,
} from '../../domain/index.ts';
import type { GamePlayer, GameSnapshot, MyGameState } from '../../lib/services/types.ts';

/**
 * UI view model derived from the two safe snapshots. Everything here is a UX helper; the server
 * re-validates every command.
 */
export interface GameModel {
  readonly pub: GameSnapshot;
  readonly mine: MyGameState;
  readonly myPlayerId: string;
  readonly me: GamePlayer | undefined;
  readonly isActiveRound: boolean;
  readonly isMyTurn: boolean;
  readonly blocked: boolean;
  readonly standings: readonly Standing[];
  readonly publicPlayer: (playerId: string) => PublicPlayerView | undefined;
  readonly nameOf: (playerId: string | null) => string;
}

export function buildModel(pub: GameSnapshot, mine: MyGameState): GameModel {
  const publicPlayers = new Map(pub.round.publicState.players.map((p) => [p.playerId, p]));
  const isActiveRound = pub.round.phase === 'ROUND_ACTIVE';
  const meView = publicPlayers.get(mine.playerId);
  const roundScores = [...new Set(pub.scores.map((s) => s.roundNo))].map((roundNo) =>
    pub.scores.filter((s) => s.roundNo === roundNo),
  );
  return {
    pub,
    mine,
    myPlayerId: mine.playerId,
    me: pub.players.find((p) => p.isMe),
    isActiveRound,
    isMyTurn: isActiveRound && pub.round.publicState.activePlayerId === mine.playerId,
    blocked: meView ? isBlocked(meView.tools) : false,
    standings: computeStandings(
      pub.players.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        hasLeft: p.status !== 'ACTIVE',
      })),
      roundScores,
    ),
    publicPlayer: (playerId) => publicPlayers.get(playerId),
    nameOf: (playerId) => pub.players.find((p) => p.playerId === playerId)?.displayName ?? '—',
  };
}

export interface PlayerTarget {
  readonly playerId: string;
  /** Tools of this card that can be affected on this player. */
  readonly tools: readonly Tool[];
}

/** Valid player targets for a sabotage/repair card from PUBLIC tool state (GAME_RULES §8.2). */
export function playerTargets(model: GameModel, def: ActionCardDef): PlayerTarget[] {
  if (def.category !== 'SABOTAGE' && def.category !== 'REPAIR') return [];
  return model.pub.round.publicState.players
    .filter((p) => !p.hasLeft)
    .map((p) => ({
      playerId: p.playerId,
      tools:
        def.category === 'SABOTAGE'
          ? p.tools[def.tool] === 'INTACT'
            ? [def.tool]
            : []
          : def.tools.filter((tool) => p.tools[tool] === 'BROKEN'),
    }))
    .filter((target) => target.tools.length > 0);
}

export const hiddenDestinationSlots = (model: GameModel): number[] =>
  model.pub.round.publicState.board.destinations
    .filter((d) => d.revealed === null)
    .map((d) => d.slot);

export const collapsibleTunnels = (model: GameModel): PlacedPath[] =>
  Object.values(model.pub.round.publicState.board.paths);

export const legalCells = (model: GameModel, typeId: PathTypeId, rotation: Rotation): Coord[] =>
  legalPlacements(model.pub.round.publicState.board, typeId, rotation);

export type CardIssue = 'BLOCKED' | 'NO_PLACE' | 'NO_TARGET' | null;

/** Why a card cannot be played right now (it can always be discarded on your turn). */
export function cardIssue(model: GameModel, card: HandCard): CardIssue {
  const def = getCardDef(card.typeId);
  switch (def.category) {
    case 'PATH':
      if (model.blocked) return 'BLOCKED';
      return legalCells(model, def.typeId, 0).length + legalCells(model, def.typeId, 180).length > 0
        ? null
        : 'NO_PLACE';
    case 'SABOTAGE':
    case 'REPAIR':
      return playerTargets(model, def).length > 0 ? null : 'NO_TARGET';
    case 'INSPECT':
      return hiddenDestinationSlots(model).length > 0 ? null : 'NO_TARGET';
    case 'BOARD':
      return collapsibleTunnels(model).length > 0 ? null : 'NO_TARGET';
  }
}
