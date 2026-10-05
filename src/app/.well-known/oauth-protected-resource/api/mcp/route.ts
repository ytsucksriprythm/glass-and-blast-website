import { protectedResourceMetadata } from '@/lib/mcp/oauth';

// RFC 9728 protected resource metadata for the MCP endpoint.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = () => protectedResourceMetadata();
