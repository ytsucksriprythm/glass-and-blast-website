import { authorizeGet, authorizePost } from '@/lib/mcp/oauth';

// Owner sign-in + consent page for the ChatGPT MCP connector.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (req: Request) => authorizeGet(req);
export const POST = (req: Request) => authorizePost(req);
