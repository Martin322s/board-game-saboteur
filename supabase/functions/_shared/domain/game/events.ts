import type { Rotation } from '../board/direction.ts';
import type { ActionTypeId, PathTypeId } from '../cards/types.ts';
import type { HandCard } from '../hands/hand.ts';
import type {
  DestinationIdentity,
  DestinationSlot,
  EpochMs,
  PlayerId,
  Seat,
  Tool,
} from '../primitives.ts';
import type { RoundEndReason, WinnerFaction } from '../scoring/scoring.ts';

/**
 * PUBLIC event log entries (GAME_RULES §11). Safe for every room member.
 * Must never contain roles, hand contents, discarded card types or hidden identities.
 */
export type PublicEventBody =
  | {
      readonly type: 'ROUND_STARTED';
      readonly roundNo: number;
      readonly startingSeat: Seat;
      readonly handSize: number;
    }
  | {
      readonly type: 'PATH_PLACED';
      readonly actorId: PlayerId;
      readonly typeId: PathTypeId;
      readonly x: number;
      readonly y: number;
      readonly rotation: Rotation;
    }
  | {
      readonly type: 'DESTINATION_REVEALED';
      readonly slot: DestinationSlot;
      readonly identity: DestinationIdentity;
    }
  | {
      readonly type: 'TOOL_BROKEN' | 'TOOL_REPAIRED';
      readonly actorId: PlayerId;
      readonly targetId: PlayerId;
      readonly tool: Tool;
      readonly typeId: ActionTypeId;
    }
  | {
      readonly type: 'DESTINATION_SCOUTED';
      readonly actorId: PlayerId;
      readonly slot: DestinationSlot;
    }
  | {
      readonly type: 'PATH_COLLAPSED';
      readonly actorId: PlayerId;
      readonly x: number;
      readonly y: number;
      readonly removedTypeId: PathTypeId;
    }
  | { readonly type: 'CARD_DISCARDED'; readonly actorId: PlayerId }
  | { readonly type: 'TURN_TIMED_OUT'; readonly playerId: PlayerId }
  | { readonly type: 'PLAYER_LEFT'; readonly playerId: PlayerId }
  | {
      readonly type: 'ROUND_ENDED';
      readonly winner: WinnerFaction;
      readonly endReason: RoundEndReason;
      readonly connectorId: PlayerId | null;
      readonly endedAt: EpochMs;
    };

export type PublicEvent = PublicEventBody & { readonly seq: number };

/** PLAYER-PRIVATE effects: delivered only to `playerId` (private state / HTTP response). */
export type PrivateEffect =
  | {
      readonly kind: 'SCOUT_RESULT';
      readonly playerId: PlayerId;
      readonly slot: DestinationSlot;
      readonly identity: DestinationIdentity;
    }
  | { readonly kind: 'CARD_DRAWN'; readonly playerId: PlayerId; readonly card: HandCard };
