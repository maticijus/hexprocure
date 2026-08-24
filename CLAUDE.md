Read AGENTS.md first — stack, conventions, commands, definition of done.

Additional project-specific rules:
- Money is always integer minor units via src/domain/money.ts. Never floats.
- Dependency direction: app/ -> lib/ -> domain/. Domain has zero I/O.
- Every feature follows TDD: RED commit, GREEN commit, refactor commit.
- Integration tests use .env.test exclusively (hexprocure_test DB). Never point
  tests at hexprocure_dev — test truncations destroy data.
- Verify page changes with an authenticated curl render check (see git history
  for the GROUP BY incident), not just HTTP 200 on public routes.
