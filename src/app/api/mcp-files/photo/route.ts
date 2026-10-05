import { handlePhoto } from '@/lib/mcp/files';

// Short-lived signed photo links handed out by the MCP connector.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (req: Request) => handlePhoto(req);
