# Deploying Glass & Blast to Vercel

The site is ready for Vercel. Bookings are stored in **Neon Postgres** in production
(and a local `data/bookings.json` file during `npm run dev`, so local dev needs no database).

## One-time setup

### 1. Push to GitHub
- Create a new repo on github.com.
- Push this project to it.

### 2. Import into Vercel
- Go to vercel.com → sign up with GitHub (free).
- **Add New → Project** → import the repo → **Deploy**.
- You'll get a live URL like `glass-and-blast.vercel.app`.

### 3. Add the database (Neon)
- In the Vercel project → **Storage → Create Database → Neon** (Postgres) → connect.
- This automatically adds the `DATABASE_URL` environment variable.
- The `bookings` table is created automatically on the first booking.

### 4. Add environment variables
Vercel project → **Settings → Environment Variables** → add:

| Name | Value |
|------|-------|
| `SMTP_HOST` | e.g. `smtp-relay.brevo.com` (Brevo) or `smtp.zoho.com.au` (Zoho) |
| `SMTP_PORT` | `587` (or `465` for Zoho SSL) |
| `SMTP_USER` | SMTP login from your provider |
| `SMTP_PASS` | SMTP key / mailbox password |
| `EMAIL_FROM` | `"Glass & Blast Window Cleaning <info@glassandblast.com.au>"` |
| `EMAIL_REPLY_TO` | `info@glassandblast.com.au` |
| `OWNER1_EMAIL` | lincolnblu@icloud.com |
| `OWNER2_EMAIL` | wardliam232@gmail.com |
| `NTFY_TOPIC` | your secret ntfy topic for iPhone push (optional) |
| `ADMIN_PASSWORD` | glass26 |
| `ADMIN_SECRET` | any long random string |
| `NEXT_PUBLIC_URL` | https://yourdomain.com.au |
| `DATABASE_URL` | (added automatically by the Neon step) |

Then **redeploy** (Deployments → ⋯ → Redeploy) so the vars take effect.

### 5. Connect your domain (from Crazy Domains)
- Vercel project → **Settings → Domains** → add `glassandblast.com.au` and `www.glassandblast.com.au`.
- In Crazy Domains → **My Domains → Manage → DNS**:
  - **A record:** `@` → `76.76.21.21`
  - **CNAME:** `www` → `cname.vercel-dns.com`
- Save. HTTPS is issued automatically within a few minutes.

## After launch
- Any `git push` to the repo auto-redeploys.
- Admin dashboard: `https://yourdomain.com.au/admin` (password `glass26`).
- Every booking emails both owners + sends the customer a confirmation.

## Email setup (info@glassandblast.com.au)

You need SMTP credentials so the site can send as your domain address.

**Free option — Brevo (send) + Zoho free (inbox):**
1. **Zoho Mail Free** → add domain `glassandblast.com.au` → create `info@` mailbox (add MX + TXT records at Crazy Domains). This is your inbox.
2. **Brevo** (free, 300/day) → add + verify the domain (add the SPF/DKIM TXT records it gives you) → **SMTP & API → SMTP keys** → copy login + key.
3. Set `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`/`SMTP_PASS` from Brevo.

**Simplest option — Zoho Mail Lite (~$1/mo):** does inbox + SMTP.
- `SMTP_HOST=smtp.zoho.com.au`, `SMTP_PORT=465`, `SMTP_USER=info@glassandblast.com.au`, `SMTP_PASS=` mailbox/app password.

Either way, `EMAIL_FROM` and `EMAIL_REPLY_TO` stay set to `info@glassandblast.com.au`.
