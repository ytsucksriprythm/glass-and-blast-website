import { getActiveContext } from '@/lib/auth';
import { approveBrowserRequest, listConnectorSignIns } from '@/lib/mcp/authStore';
import { getMcpConfig } from '@/lib/mcp/config';
import { getBrowserApprovalRequest, json, notConfigured } from '@/lib/mcp/oauth';

export async function GET() {
  if ((await getActiveContext())?.role !== 'admin') return json({ error: 'Access denied.' }, 403);
  if (!getMcpConfig()) return notConfigured();
  return json({ signIns: await listConnectorSignIns() });
}

export async function POST(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return json({ error: 'Access denied.' }, 403);
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  if (request.headers.get('origin') !== cfg.baseUrl ||
    !request.headers.get('content-type')?.startsWith('application/json')) {
    return json({ error: 'Open this request from CRM Settings.' }, 403);
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.request !== 'string' || !['inspect', 'approve'].includes(body.action)) {
    return json({ error: 'Invalid connection request.' }, 400);
  }
  const connection = await getBrowserApprovalRequest(cfg, body.request);
  if (!connection) return json({ error: 'Connection request expired. Restart the connection from the agent app.' }, 400);
  if (body.action === 'inspect') return json({ clientName: connection.clientName, host: connection.host, profile: ctx.profile });
  const expiresAt = await approveBrowserRequest(connection.hash, ctx.profile);
  if (!expiresAt) return json({ error: 'This approval was already used. Start a new connection to sign in again.' }, 409);
  return json({ expiresAt });
}
