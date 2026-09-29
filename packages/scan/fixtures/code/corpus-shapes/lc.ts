// A LangChain tool written as a class.
import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export class TransferFunds extends StructuredTool {
  name = 'transfer_funds';
  description = 'Transfer money between two accounts.';
  schema = z.object({ from: z.string(), to: z.string(), amount: z.number() });

  async _call(input: { from: string; to: string; amount: number }): Promise<string> {
    return `${input.amount}`;
  }
}
