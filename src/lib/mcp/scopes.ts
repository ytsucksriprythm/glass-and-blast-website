// Which tools a token may see, by OAuth scope.
//
//  - business.read: the owner signed in on the sign-in page (ChatGPT / Claude).
//    Every read tool, plus the write tools when MCP_WRITES_ENABLED=true —
//    unchanged from before scopes existed.
//  - Narrow machine scopes, for the Vapi "Atlas" phone assistant's
//    client-credentials login (no person signs in, so it gets only what it needs):
//      bookings.read  bookings / customers / schedule
//      quotes.read    quotes
//      quotes.write   create + update quotes
//    Invoices, payments, settings, reports, activity, photos and every other
//    write stay invisible to these tokens. Tools a token can't use aren't even
//    registered, so they don't appear in tools/list.

import { MCP_SCOPE, MACHINE_SCOPES } from './config';

export type MachineScope = typeof MACHINE_SCOPES[number];

const READ_TOOLS: Record<MachineScope, string[]> = {
  'bookings.read': ['search_bookings', 'get_booking', 'get_customer_history', 'list_schedule'],
  'quotes.read': ['list_quotes', 'get_quote'],
  'quotes.write': [],
};
const WRITE_TOOLS: Record<MachineScope, string[]> = {
  'bookings.read': [],
  'quotes.read': [],
  'quotes.write': ['create_quote', 'update_quote'],
};

export function canUseReadTool(scopes: string[], tool: string): boolean {
  if (scopes.includes(MCP_SCOPE)) return true;
  return MACHINE_SCOPES.some(s => scopes.includes(s) && READ_TOOLS[s].includes(tool));
}

export function canUseWriteTool(scopes: string[], tool: string, writesEnabled: boolean): boolean {
  if (scopes.includes(MCP_SCOPE)) return writesEnabled;
  return MACHINE_SCOPES.some(s => scopes.includes(s) && WRITE_TOOLS[s].includes(tool));
}

export function anyWriteTool(scopes: string[], writesEnabled: boolean): boolean {
  if (scopes.includes(MCP_SCOPE)) return writesEnabled;
  return MACHINE_SCOPES.some(s => scopes.includes(s) && WRITE_TOOLS[s].length > 0);
}
