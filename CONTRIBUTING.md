# Contributing

## Workflow

Tests live next to code. Follow TDD: a failing test first, then the minimal
fix. Before a pull request run `npx tsc --noEmit`, `npm run lint` and the
relevant `npx vitest run` files. See AGENTS.md for conventions.

## Developer Certificate of Origin (DCO)

Every commit must carry a sign-off line that certifies the
[Developer Certificate of Origin](https://developercertificate.org/):

```text
Signed-off-by: Your Name <you@example.com>
```

Add it with `git commit -s`. Pull requests with unsigned commits are not merged.
Fix a missed sign-off with `git commit --amend -s` or `git rebase --signoff`.

## Licensing of contributions

Code outside `ee/` is contributed under the MIT licence in `LICENSE`.
A contribution to `ee/` is made under section 7 of the HexProcure Commercial
Licence in `ee/LICENSE`: a non-exclusive, sublicensable licence to
HEXENKRAFT s.r.o., which may also make the contribution available under
other terms. For a file in `ee/`, the "licence indicated in the file" in
the DCO text is that licence, which is not an open source licence. The DCO
sign-off certifies origin; by sending the contribution you also confirm you
hold the rights needed to grant the section 7 licence.
