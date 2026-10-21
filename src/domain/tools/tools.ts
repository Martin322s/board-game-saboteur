import { domainError, type DomainError } from '../errors.ts';
import { TOOLS, type Tool } from '../primitives.ts';
import { err, ok, type Result } from '../result.ts';

/** Public per-player tool state (GAME_RULES §6.1). */
export type ToolStatus = 'INTACT' | 'BROKEN';
export type ToolState = Readonly<Record<Tool, ToolStatus>>;

export const ALL_TOOLS_INTACT: ToolState = { DRILL: 'INTACT', LAMP: 'INTACT', ROPE: 'INTACT' };

export function isBroken(tools: ToolState, tool: Tool): boolean {
  return tools[tool] === 'BROKEN';
}

export function brokenTools(tools: ToolState): Tool[] {
  return TOOLS.filter((t) => isBroken(tools, t));
}

/** A player with at least one broken tool cannot place path cards. */
export function isBlocked(tools: ToolState): boolean {
  return brokenTools(tools).length > 0;
}

export function breakTool(tools: ToolState, tool: Tool): Result<ToolState, DomainError> {
  if (isBroken(tools, tool)) return err(domainError('TOOL_ALREADY_BROKEN'));
  return ok({ ...tools, [tool]: 'BROKEN' });
}

export function repairTool(tools: ToolState, tool: Tool): Result<ToolState, DomainError> {
  if (!isBroken(tools, tool)) return err(domainError('TOOL_NOT_BROKEN'));
  return ok({ ...tools, [tool]: 'INTACT' });
}
