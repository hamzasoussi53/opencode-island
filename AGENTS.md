# AGENTS.md

OpenCode loads this file for every session in this repo.

## Ship

The release goes out in this order. Nothing skipped, nothing extra.

1. `npm run typecheck && npm run check && npm run build` — all three pass.
2. Bump `version` in `package.json`, commit, push the branch, push the tag.
3. `npm publish` (the shell is not logged in to npm: if it fails with
   `E401 Unauthorized`, ask the user to run `npm login` first).
4. `gh release create <tag> --title "<tag>" --notes "<what changed>"`.
5. `sh scripts/pages.sh` — publishes the landing page to the `gh-pages` branch.
6. Post the release on X, mirror the OpenCode profile, and post the release on
   opencode.cafe (see below).

## X

The account is **@soussi_53**. Chrome is already signed into it, so every post
goes through `browse` on `x.com`, never through a script or an API.

### Announce the release

One post, in the shape of the earlier ones:

```
opencode-island v0.6.2 🏝️ <one line on what changed>
https://hamzasoussi53.github.io/opencode-island/
```

The landing page URL, not the repo link. Type it in the composer at
`x.com/compose/post` and post it.

### Mirror the OpenCode profile

The OpenCode profile is **@opencode**. Take the 5 most recent posts from
`x.com/opencode` (Posts tab, newest first) and repost each one on @soussi_53:
click the post's "Repost" button, then "Repost" in the menu that opens. Do not
retype the text, do not quote-post.

Before reposting, open the Reposts tab on `x.com/soussi_53` and skip the ones
already there, so a second run does not post the same thing twice.

If X asks for a login, a 2FA code or a captcha, hand off to the user. Never
solve a captcha.

## opencode.cafe

The community directory for OpenCode extensions: `https://www.opencode.cafe/`.
Chrome is signed in as Hamza SOUSSI. Like X, it is posted through `browse`,
never through a script or an API.

### Submit the island

`opencode-island` is not listed there yet. Submit it once, on
`https://www.opencode.cafe/submit`:

- Type: Plugin
- Product ID: `opencode-island`
- Display Name: OpenCode Island
- Description: the `description` field of `package.json`, in one line
- Repository URL: `https://github.com/hamzasoussi53/opencode-island`
- Homepage URL: `https://hamzasoussi53.github.io/opencode-island/`
- Tags: `plugin`, `opencode`, `ui`, `macos`, `windows`
- Installation Instructions: the "With the OpenCode CLI" block of the README
  (`opencode plugin add opencode-island`) and the "From source" block

Press **Submit Extension**. The entry then lives at
`https://www.opencode.cafe/plugin/opencode-island`. The site says an
extension may still be waiting for approval, so check that the page is live
before linking to it anywhere.

### Keep it current

After a release, open `https://www.opencode.cafe/account` → My Extensions →
opencode-island. If the entry can be edited, refresh the description and the
installation instructions to what the release changed. If it cannot, leave a
comment on the entry's Discussion section instead, saying what the release
changed and linking the landing page.
