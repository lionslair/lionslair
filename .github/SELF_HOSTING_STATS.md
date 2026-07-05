# Self-hosting github-readme-stats for a real private-commit count

The shared public instance at `github-readme-stats.vercel.app` cannot see your
private repos — it isn't authenticated as you, so `count_private=true` is
silently ignored there. To get an honest "Total Commits" number that includes
private repos, without ever exposing which repos they're in, deploy your own
copy with your own token. The token never leaves your Vercel account or
touches this repo.

## Steps

1. **Fork** https://github.com/anuraghazra/github-readme-stats to your own
   GitHub account.

2. **Create a token** at https://github.com/settings/tokens
   - Classic PAT, scope: `repo` (read access to private repos) — this is the
     scope the project's own deployment guide calls for, since it needs to
     read commit/PR/issue data across your repos.
   - Set an expiration and store it somewhere safe (password manager). Treat
     it like a password — anyone with it can read your private repos.

3. **Deploy the fork to Vercel**: https://vercel.com/new, import your fork.

4. **Add the token as an environment variable** in the Vercel project
   settings: name it `PAT_1`, value = the token from step 2. Redeploy after
   adding it (env vars only take effect on the next deploy).

5. **Swap the URL** in this repo's `README.md`: replace
   `github-readme-stats.vercel.app` with your Vercel deployment's domain in
   both the stats and top-langs `<img>` tags under "GitHub stats". Keep
   `count_private=true` and `show=reviews,prs_merged` — they now work because
   the request is authenticated as you.

## What this does and doesn't expose

- **Shows**: aggregate counts (total commits, PRs opened, PRs merged, PR
  reviews given, issues, stars) rolled up across public + private repos.
  `show=reviews` pulls `totalPullRequestReviewContributions` and
  `prs_merged` pulls merged-PR counts from GitHub's GraphQL API — both are
  single numbers, not lists.
- **Never shows**: repo names, commit messages, diffs, PR titles/bodies,
  review comment text, or which repos are private. The card only ever
  renders aggregate numbers.
- Delete/rotate the token any time from the same GitHub settings page if you
  want to revoke access.
