import { handleMcp } from '@/lib/mcp/handler';

// Remote MCP endpoint for ChatGPT (Streamable HTTP, stateless, read-only).
// See docs/mcp-chatgpt.md.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = (req: Request) => handleMcp(req);
export const GET = (req: Request) => handleMcp(req);
export const DELETE = (req: Request) => handleMcp(req);
