import { executeTool } from '../tools/tool-executor.js';

interface Req {
  body: unknown;
}
interface Res {
  status(code: number): Res;
  json(v: unknown): void;
}
type Handler = (req: Req, res: Res) => Promise<void>;
interface Router {
  post(path: string, ...handlers: Handler[]): void;
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? Object.entries(body).find(([k]) => k === key)?.[1] : undefined;
}

// Caller shape B: a route that validates a `confirmed` field before the human-path call.
export function mount(router: Router): void {
  router.post('/stores/:storeId/approved-write', async (req, res) => {
    const toolName = field(req.body, 'toolName');
    const confirmed = field(req.body, 'confirmed') === true;
    if (typeof toolName !== 'string') {
      res.status(400).json({ error: 'toolName required' });
      return;
    }
    if (!confirmed) {
      res.status(400).json({ error: 'CONFIRMATION_REQUIRED' });
      return;
    }
    const out = await executeTool(toolName, {}, { storeId: 1, actorUserId: 'u1' });
    res.json(out);
  });
}
