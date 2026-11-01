// Which tools a token may see, by OAuth scope.
//
//  - business.read: the owner signed in on the sign-in page (ChatGPT / Claude).
//    Every read tool, plus the write tools when MCP_WRITES_ENABLED=true —
//    unchanged from before scopes existed.
//  - Machine scopes, for the Vapi "Atlas" phone assistant's client-credentials
//    login (no person signs in):
//      business.all   everything the owner gets (same rule for writes)
//      bookings.read  bookings / customers / schedule
//      quotes.read    quotes
//      quotes.write   create + update quotes
//    A token without business.all only sees its narrow tools; tools a token
//    can't use aren't even registered, so they don't appear in tools/list.

import { MCP_SCOPE, FULL_MACHINE_SCOPE, MACHINE_SCOPES } from './config';

type NarrowScope = Exclude<typeof MACHINE_SCOPES[number], typeof FULL_MACHINE_SCOPE>;
const NARROW_SCOPES: NarrowScope[] = ['bookings.read', 'quotes.read', 'quotes.write'];

const READ_TOOLS: Record<NarrowScope, string[]> = {
  'bookings.read': ['search_bookings', 'get_booking', 'get_customer_history', 'list_schedule'],
  'quotes.read': ['list_quotes', 'get_quote'],
  'quotes.write': [],
};
const WRITE_TOOLS: Record<NarrowScope, string[]> = {
  'bookings.read': [],
  'quotes.read': [],
  'quotes.write': ['create_quote', 'update_quote'],
};

// Owner sign-in, or a machine token granted full access.
function full(scopes: string[]): boolean {
  return scopes.includes(MCP_SCOPE) || scopes.includes(FULL_MACHINE_SCOPE);
}

export function canUseReadTool(scopes: string[], tool: string): boolean {
  if (full(scopes)) return true;
  return NARROW_SCOPES.some(s => scopes.includes(s) && READ_TOOLS[s].includes(tool));
}

export function canUseWriteTool(scopes: string[], tool: string, writesEnabled: boolean): boolean {
  if (full(scopes)) return writesEnabled;
  return NARROW_SCOPES.some(s => scopes.includes(s) && WRITE_TOOLS[s].includes(tool));
}

export function anyWriteTool(scopes: string[], writesEnabled: boolean): boolean {
  if (full(scopes)) return writesEnabled;
  return NARROW_SCOPES.some(s => scopes.includes(s) && WRITE_TOOLS[s].length > 0);
}
