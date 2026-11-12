#!/bin/sh
# Builds the landing page and publishes it to the gh-pages branch.
#
# The page is plain HTML, CSS and the built island, so the whole site is the
# contents of docs/ with the demo island generated into it.
set -e

npm run build
node scripts/site.mjs

branch=gh-pages
repo="https://github.com/hamzasoussi53/opencode-island.git"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git clone -q --branch "$branch" "$repo" "$tmp"
else
  git init -q "$tmp"
  git -C "$tmp" remote add origin "$repo"
  git -C "$tmp" checkout -q --orphan "$branch"
fi

# The site is docs/, without the papers that live beside it.
find "$tmp" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
cp -R docs/. "$tmp"/
rm -rf "$tmp/superpowers" "$tmp/panel.png"

git -C "$tmp" add -A
git -C "$tmp" commit -q -m "site: the landing page"
git -C "$tmp" push -q origin "$branch"

echo "published to $repo/tree/$branch"
