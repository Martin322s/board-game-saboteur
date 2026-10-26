import {
  getCardDef,
  type CardTypeId,
  type PathTopology,
  type PublicEvent,
} from '../../domain/index.ts';
import { t, type MessageKey } from '../../i18n/index.ts';

export function describeTopology(topology: PathTopology): string {
  const dirs = topology.openings.map((d) => t(`dir.${d}`)).join(', ');
  const deadEnd = topology.segments.every((s) => s.length === 1);
  return t(deadEnd ? 'tunnel.describeDead' : 'tunnel.describe', { dirs });
}

export function cardLabel(typeId: CardTypeId): string {
  const def = getCardDef(typeId);
  if (def.category === 'PATH') {
    const deadEnd = def.topology.segments.every((s) => s.length === 1);
    return deadEnd ? t('card.deadEnd') : t('card.path');
  }
  return t(`card.${def.typeId}` as MessageKey);
}

/**
 * Player-facing activity line. Only PUBLIC event data is used: scouting never says what was
 * seen and discards never say which card.
 */
export function eventText(event: PublicEvent, nameOf: (playerId: string | null) => string): string {
  switch (event.type) {
    case 'ROUND_STARTED':
      return t('feed.ROUND_STARTED', { round: event.roundNo });
    case 'PATH_PLACED':
      return t('feed.PATH_PLACED', { name: nameOf(event.actorId) });
    case 'DESTINATION_REVEALED':
      return t(event.identity === 'TREASURE' ? 'feed.REVEAL_TREASURE' : 'feed.REVEAL_EMPTY');
    case 'TOOL_BROKEN':
    case 'TOOL_REPAIRED': {
      const self = event.actorId === event.targetId;
      const key = `feed.${event.type}${self ? '_SELF' : ''}` as MessageKey;
      return t(key, {
        name: nameOf(event.actorId),
        target: nameOf(event.targetId),
        tool: t(`tool.def.${event.tool}`),
      });
    }
    case 'DESTINATION_SCOUTED':
      return t('feed.DESTINATION_SCOUTED', { name: nameOf(event.actorId) });
    case 'PATH_COLLAPSED':
      return t('feed.PATH_COLLAPSED', { name: nameOf(event.actorId) });
    case 'CARD_DISCARDED':
      return t('feed.CARD_DISCARDED', { name: nameOf(event.actorId) });
    case 'TURN_TIMED_OUT':
      return t('feed.TURN_TIMED_OUT', { name: nameOf(event.playerId) });
    case 'PLAYER_LEFT':
      return t('feed.PLAYER_LEFT', { name: nameOf(event.playerId) });
    case 'ROUND_ENDED':
      return t('feed.ROUND_ENDED');
  }
}
