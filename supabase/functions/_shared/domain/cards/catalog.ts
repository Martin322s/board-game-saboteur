import { rotateTopology, type PathTopology } from '../board/topology.ts';
import type { Rotation } from '../board/direction.ts';
import { DECK_CATALOG } from '../config/deck.ts';
import type {
  ActionCardDef,
  CardDef,
  CardKind,
  CardTypeId,
  PathCardDef,
  PathTypeId,
} from './types.ts';

const BY_TYPE_ID: ReadonlyMap<string, CardDef> = new Map(DECK_CATALOG.map((d) => [d.typeId, d]));

export function isCardTypeId(value: unknown): value is CardTypeId {
  return typeof value === 'string' && BY_TYPE_ID.has(value);
}

export function getCardDef(typeId: CardTypeId): CardDef {
  const def = BY_TYPE_ID.get(typeId);
  if (!def) throw new Error(`Unknown card type: ${typeId}`);
  return def;
}

export function isPathDef(def: CardDef): def is PathCardDef {
  return def.category === 'PATH';
}

export function isActionDef(def: CardDef): def is ActionCardDef {
  return def.category !== 'PATH';
}

export function cardKind(def: CardDef): CardKind {
  return isPathDef(def) ? 'PATH' : 'ACTION';
}

export function getPathDef(typeId: PathTypeId): PathCardDef {
  const def = getCardDef(typeId);
  if (!isPathDef(def)) throw new Error(`Not a path card: ${typeId}`);
  return def;
}

export function isPathTypeId(typeId: CardTypeId): typeId is PathTypeId {
  return getCardDef(typeId).category === 'PATH';
}

/** Topology of a path card type at the given rotation. */
export function pathTopology(typeId: PathTypeId, rotation: Rotation): PathTopology {
  return rotateTopology(getPathDef(typeId).topology, rotation);
}
