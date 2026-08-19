// A personal clipboard, admin-only — free-form label/value/notes for anything
// the owner wants to copy again later (the ntfy.sh topic/subscribe URL, a
// webhook secret, an env var, a CLI one-liner, whatever). Stored in the
// database (Neon in prod, /data JSON locally), NOT in source — this repo is
// public, so real secrets belong here, never hardcoded or seeded in code.
// See "Vault" section in src/app/admin/settings/page.tsx and the CRUD
// functions in src/lib/db.ts.
export interface VaultItem {
  id: string;
  label: string;
  value: string;
  notes: string;
  createdAt: string;
}
