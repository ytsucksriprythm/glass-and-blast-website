import { revoke } from '@/lib/mcp/oauth';

// OAuth token revocation (RFC 7009).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (req: Request) => revoke(req);
