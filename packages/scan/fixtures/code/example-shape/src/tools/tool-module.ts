// The application-local factory (record §2.1): the only link to a known library is
// the TYPE of `input_schema`, which is the Anthropic SDK's Tool.InputSchema.
import type { Tool } from '@anthropic-ai/sdk/resources/messages/messages.js';
import { z } from 'zod';

export interface ToolContext {
  locationId: number;
  actorUserId: string;
}

export interface ToolResult {
  result: unknown;
}

export interface ToolModule<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly requires_confirmation: boolean;
  readonly input_schema: Tool.InputSchema;
  readonly zodSchema: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext, abortSignal?: AbortSignal): Promise<ToolResult>;
}

export interface DefineToolSpec<TInput> {
  readonly name: string;
  readonly description: string;
  readonly requires_confirmation: boolean;
  readonly zodSchema: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext, abortSignal?: AbortSignal): Promise<ToolResult>;
}

export function defineTool<TInput>(spec: DefineToolSpec<TInput>): ToolModule<TInput> {
  const json = z.toJSONSchema(spec.zodSchema, { target: 'draft-7' });
  const properties = typeof json === 'object' && json !== null && 'properties' in json ? json.properties : {};
  const tool: ToolModule<TInput> = {
    name: spec.name,
    description: spec.description,
    requires_confirmation: spec.requires_confirmation,
    input_schema: { type: 'object', properties },
    zodSchema: spec.zodSchema,
    execute: spec.execute,
  };
  return Object.freeze(tool);
}
