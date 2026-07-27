// Shown in tiny text at the bottom of /admin/settings so the owner can
// eyeball whether their latest change has actually gone live on Vercel.
//
// Manually maintained (not derived from git) so it can never silently drift
// from what Vercel's own Deployments tab shows. WORKFLOW: bump this by
// exactly 1 every time you `git push` to main (each push = one Vercel
// deploy = one version) as part of the same commit being pushed.
export const APP_VERSION = 32;
