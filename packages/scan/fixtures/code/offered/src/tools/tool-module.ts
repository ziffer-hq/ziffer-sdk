// An application-local factory, found by its return type (a Zod schema and a run function).
import { z } from 'zod';

export interface ToolContext {
  storeId: number;
  actorUserId: string | null;
}

export interface ToolModule<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly requires_confirmation: boolean;
  readonly zodSchema: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext, abortSignal?: AbortSignal): Promise<Record<string, unknown>>;
}

export interface DefineToolSpec<TInput> {
  readonly name: string;
  readonly description: string;
  readonly requires_confirmation: boolean;
  readonly zodSchema: z.ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext, abortSignal?: AbortSignal): Promise<Record<string, unknown>>;
}

export function defineTool<TInput>(spec: DefineToolSpec<TInput>): ToolModule<TInput> {
  return Object.freeze({ ...spec });
}
