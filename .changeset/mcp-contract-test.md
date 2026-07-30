---
"@booboo-brain/serve": minor
---

`runMcp` accepts an optional `transport`, and the MCP face finally has tests.

The MCP server is what every desktop client and all five directory listings
actually reach, and it had **no test at all** — `runMcp` was the one exported
surface nothing exercised. That is load-bearing right now: the namespace
republish bumps `@modelcontextprotocol/sdk` from `^1.12.0` to `^1.29.0`, and
`server.tool()` is already `@deprecated` in 1.29 in favour of `registerTool`.
The day it is removed, tool registration returns nothing, every listed
directory serves a brainless server, and the whole suite still passes.

`transport` defaults to stdio, so `booboo mcp` and every existing consumer are
unchanged. It exists because the server needs a seam to be driven in-process —
and because the demo site's Streamable-HTTP `/mcp` is a *second implementation*
of these ten tools today, which is GAPS C29/C33 waiting to happen again.

Nine tests assert the contract rather than the implementation: which tools
register against the installed SDK, that the org tools appear only with an org
and the write tools only with a writer (a read-only server must stay
read-only), that every tool carries a description, and what `booboo_stats`,
`booboo_search`, `booboo_boot` and `booboo_remember` actually answer —
including that `booboo_boot` returns inherited rules **ancestors-first**, which
is the contract agents boot on, and that an unknown agent is answered rather
than thrown.

Proven by breaking it: renaming one tool failed three tests with a readable
diff (`+ booboo_find_BREAKME` / `- booboo_search`) and exit 1.
