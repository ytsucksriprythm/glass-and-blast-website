import { register } from '@/lib/mcp/oauth';

// OAuth dynamic client registration for the ChatGPT MCP connector.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => register(req);
