import { agentRepository } from '../repositories/agent.repository.js';
import { ALL_TOOLS } from './handlers/index.js';
import type { ToolModule } from './tool-module.js';

/** The tools a model may see at one location: the static list, narrowed by a table. */
export async function getToolsForLocation(locationId: number): Promise<ToolModule[]> {
  const active = await agentRepository.getActiveTools(locationId);
  const activeNames = new Set(active.map((r) => r.name));
  return ALL_TOOLS.filter((t) => activeNames.has(t.name));
}
