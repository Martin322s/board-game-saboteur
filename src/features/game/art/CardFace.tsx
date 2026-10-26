import { getCardDef, pathTopology, type CardTypeId, type Rotation } from '../../../domain/index.ts';
import { cardLabel } from '../format.ts';
import { CrackMark, EyeIcon, RocksIcon, ToolIcon, WrenchMark } from './Icons.tsx';
import { TunnelArt } from './TunnelArt.tsx';

/**
 * Visual card face. Path cards draw their real topology (at the previewed rotation); action
 * cards use original iconography. The text label is always present for clarity and a11y.
 */
export function CardFace({ typeId, rotation = 0 }: { typeId: CardTypeId; rotation?: Rotation }) {
  const def = getCardDef(typeId);
  return (
    <span className="flex h-full w-full flex-col items-center justify-between gap-1 p-1.5">
      <span className="flex w-full flex-1 items-center justify-center">
        {def.category === 'PATH' ? (
          <svg viewBox="0 0 100 100" aria-hidden="true" className="h-full max-h-20 w-full">
            <TunnelArt topology={pathTopology(def.typeId, rotation)} />
          </svg>
        ) : (
          <ActionArt typeId={typeId} />
        )}
      </span>
      <span className="line-clamp-2 text-center text-[0.7rem] leading-tight font-semibold sm:text-xs">
        {cardLabel(typeId)}
      </span>
    </span>
  );
}

function ActionArt({ typeId }: { typeId: CardTypeId }) {
  const def = getCardDef(typeId);
  switch (def.category) {
    case 'SABOTAGE':
      return (
        <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-800">
          <ToolIcon tool={def.tool} className="h-9 w-9" />
          <CrackMark className="absolute h-12 w-12 text-red-600" />
        </span>
      );
    case 'REPAIR':
      return (
        <span className="relative inline-flex max-w-full items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-2 text-green-800">
          {def.tools.map((tool, i) => (
            <span key={tool} className="inline-flex items-center gap-0.5">
              {i > 0 && <span className="text-[0.6rem] text-green-800">/</span>}
              <ToolIcon tool={tool} className={def.tools.length > 1 ? 'h-5 w-5' : 'h-8 w-8'} />
            </span>
          ))}
          <WrenchMark className="absolute -right-1 -bottom-1 h-5 w-5 text-green-700" />
        </span>
      );
    case 'INSPECT':
      return (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-teal-800">
          <EyeIcon className="h-10 w-10" />
        </span>
      );
    case 'BOARD':
      return (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-300 text-slate-700">
          <RocksIcon className="h-10 w-10" />
        </span>
      );
    case 'PATH':
      return null;
  }
}
