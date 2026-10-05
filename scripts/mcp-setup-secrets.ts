// Generates the secrets the ChatGPT MCP connector needs. Run it yourself in a
// terminal — the values are printed ONLY to your screen, never written to a
// file, and should be pasted straight into Vercel / Neon:
//
//   npx tsx scripts/mcp-setup-secrets.ts
//
// To hash a password you chose yourself instead of a generated one (at least
// 16 characters), pipe it in on stdin so it never appears in shell history:
//
//   npx tsx scripts/mcp-setup-secrets.ts --hash-only < my-password.txt

import { randomBytes } from 'crypto';
import { hashOwnerPassword } from '../src/lib/mcp/crypto';

function passphrase(): string {
  // 6 groups of 5 from an unambiguous alphabet ≈ 150 bits.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(30);
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]);
  return Array.from({ length: 6 }, (_, i) => chars.slice(i * 5, i * 5 + 5).join('')).join('-');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  if (process.argv.includes('--hash-only')) {
    const pw = await readStdin();
    if (pw.length < 16) { console.error('Password must be at least 16 characters.'); process.exit(1); }
    console.log(`MCP_OWNER_PASSWORD_HASH=${hashOwnerPassword(pw)}`);
    return;
  }
  const ownerPassword = passphrase();
  console.log('\n=== Glass & Blast MCP connector secrets — copy these now, they are not saved anywhere ===\n');
  console.log('1) Your connector sign-in password (save it in your password manager):');
  console.log(`   ${ownerPassword}\n`);
  console.log('2) Vercel → Project → Settings → Environment Variables (Production), mark each Sensitive:');
  console.log(`   MCP_OWNER_PASSWORD_HASH=${hashOwnerPassword(ownerPassword)}`);
  console.log(`   MCP_TOKEN_SECRET=${randomBytes(48).toString('base64url')}`);
  console.log('');
  console.log('3) Password for the read-only database role (paste into scripts/mcp-readonly-role.sql in the Neon SQL editor,');
  console.log('   then build MCP_DATABASE_URL from it — see docs/mcp-chatgpt.md):');
  console.log(`   ${randomBytes(24).toString('base64url')}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
