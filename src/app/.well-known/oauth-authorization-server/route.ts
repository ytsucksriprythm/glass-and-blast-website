import { authorizationServerMetadata } from '@/lib/mcp/oauth';

// RFC 8414 authorization server metadata for the MCP connector.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = () => authorizationServerMetadata();
