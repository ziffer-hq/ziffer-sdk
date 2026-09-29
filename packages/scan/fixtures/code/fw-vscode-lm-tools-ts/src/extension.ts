import * as vscode from 'vscode';

import { runBookshopAction } from './actions.js';

interface RefundInput {
  orderId: string;
  reason?: string;
}

export class RefundOrderTool implements vscode.LanguageModelTool<RefundInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<RefundInput>, _token: vscode.CancellationToken) {
    const out = await runBookshopAction('bookshop_refundOrder', options.input);
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(out)]);
  }

  async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RefundInput>, _token: vscode.CancellationToken) {
    return {
      invocationMessage: 'Refunding the order',
      confirmationMessages: { title: 'Refund this order?', message: new vscode.MarkdownString(`Refund ${options.input.orderId}?`) },
    };
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('bookshop_refundOrder', new RefundOrderTool()));
  context.subscriptions.push(
    vscode.lm.registerTool<{ orderId: string }>('bookshop_lookupOrder', {
      invoke: async (options, _token) => {
        const out = await runBookshopAction('bookshop_lookupOrder', options.input);
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(out)]);
      },
    }),
  );
  // Registered, never declared: VS Code refuses it at runtime, the scan lists it anyway.
  context.subscriptions.push(
    vscode.lm.registerTool<{ email: string }>('bookshop_notifyCustomer', {
      invoke: async (options, _token) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(options.input.email)]),
    }),
  );
}
