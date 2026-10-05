import { token } from '@/lib/mcp/oauth';

// OAuth token endpoint (authorization_code + PKCE, refresh_token rotation).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => token(req);
