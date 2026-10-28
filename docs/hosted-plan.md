# Hosted Ownwords: engineering plan

Status: **proposal, 28 Oct 2026. Nothing is built.** It does not replace any decision in [decisions.md](decisions.md) until the owner picks the open calls at the end. Facts come from two research rounds on 28 Oct (GPT-6 Luna and Haiku workers, each question asked to both, then cross-checked). Sources are listed at the end.

## The answer

- **Do both, on one backend.** MCP Apps and WebMCP are not rivals here. Each one reaches a different chat app today.
- **Claude (Mac app and claude.ai) is reached by a remote MCP server.** Add it as a custom connector. It works on every plan, including Free (one custom connector). Its tools can also show an interactive Ownwords view inside the chat (an MCP App), inline or fullscreen.
- **ChatGPT Mac app is reached by WebMCP.** The page registers tools with `document.modelContext.registerTool()`. The ChatGPT desktop app's built-in browser finds and calls them ("site tools"). This does not work in your own Chrome, and it needs a Sol model.
- **chatgpt.com is the weak spot.** Custom MCP servers with write tools need a Business or Enterprise workspace. Pro gets read and fetch only. Free, Go and Plus are not listed.
- **Backend: Cloudflare Workers plus Durable Objects,** on the free plan. Both research models picked it on their own. It hosts the MCP server, the sign-in (OAuth), the page and live push to the page in one place. Supabase is the runner-up. Its free projects pause after 7 idle days, which would break the connector.
- **Size:** about 75 to 115 hours with agents doing the typing (my estimate). The code worker's estimate was 120 to 190 hours. Start with a 4 to 6 hour spike that proves the two risky links before building anything else.

## Who reaches what

| Chat app | Route | Works today? | Plan |
|---|---|---|---|
| Claude Mac app | Remote MCP server (custom connector) plus MCP App view | Yes, documented | Free (one connector) and up |
| claude.ai | Same server, same connector | Yes, documented | Free (one connector) and up |
| ChatGPT Mac app | WebMCP tools on the hosted page, in the app's built-in browser | Yes, documented ("site tools") | Plans not fully listed. Needs GPT-5.6 Sol or GPT-6 Sol (Luna has it off). Not Edu. Enterprise needs an admin. |
| chatgpt.com | Remote MCP server (developer mode connector) | Writes only on Business and Enterprise/Edu | Pro read-only |
| ChatGPT Mac app, MCP connector | Remote MCP server | Not documented | Treat as no |
| Claude in Chrome, Claude Cowork browser | WebMCP | No support documented | Not a route |
| Claude Code, Codex | Remote MCP server | Yes (any MCP client) | Bonus |

Two things in this table are still unproven and the spike must test them: that the ChatGPT desktop built-in browser calls tools on *our* page on the owner's plan, and that Claude renders the MCP App view from a private connector added by URL.

## The picture

```
                       Cloudflare (free plan)
  ┌──────────────────────────────────────────────────────────────┐
  │ Worker                                                       │
  │  /            hosted page (today's public/, ported)          │
  │  /mcp         remote MCP server (Streamable HTTP)            │
  │  /authorize   OAuth 2.1 (workers-oauth-provider)             │
  │  /api/*       JSON API for the page                          │
  │         │                                                    │
  │         ▼                                                    │
  │  Durable Object, one per user (SQLite inside)                │
  │   pieces, blocks, version groups, marks, ui state, history   │
  │   holds the page's WebSocket and pushes every change         │
  └──────────────────────────────────────────────────────────────┘
        ▲                     ▲                        ▲
        │ MCP + OAuth         │ HTTPS + WebSocket      │ WebMCP tools call /api
        │                     │                        │
  Claude Mac app,         you in Chrome           ChatGPT Mac app,
  claude.ai (connector    (the page)              built-in browser
  + MCP App view)                                 (site tools)
```

- **One source of truth.** Every route (MCP, WebMCP, page) calls the same functions inside the Durable Object. An edit from Claude or ChatGPT reaches the open page within a second through the WebSocket. This replaces today's 1-second polling.
- **One writer per row** replaces "one writer per file". The agent writes blocks and version groups. The page writes ui state and marks. Accept and restore run as one transaction inside the Durable Object, which also replaces today's per-piece lock.
- **The server holds the selection.** The agent reads the user's selection and marks with a tool call. This avoids depending on MCP App bridge features that Claude has not documented (see risks).

## Data model

One Durable Object per user, SQLite tables:

- `pieces(id, slug, title, rev, updated_at, deleted_at)`. The id is stable; a title change changes only the slug.
- `blocks(id, piece_id, position, kind, text, deleted_at)`. A block is one paragraph or heading.
- `version_groups(id, piece_id, seq, status open|used|dropped, original_text, pick, closed_at)` and `version_group_blocks(group_id, block_id)`.
- `version_options(group_id, n, text, note)`. `n` is never reused.
- `feedback_marks(id, piece_id, block_id, group_id, version, quote, before, start, score, note)`.
- `ui_state(piece_id, selection, picks, compare, updated_at)`.
- `snapshots(id, piece_id, taken_at, markdown, note)` and `log_entries(piece_id, at, note)`.

Groups point at block ids. The original text stays as a fallback for the stale check, using the same whitespace rules as `lib/md.js`. Markdown stays the export format: every piece can be downloaded as a `.md` file, and a folder of `.md` files can be imported.

## Tools

The same tool set is exposed three ways: as MCP tools, as WebMCP tools on the page, and as API routes. Every tool works on blocks, never the whole piece, and every write takes `expected_rev` (a mismatch means "re-read").

| Tool | What it does |
|---|---|
| `list_pieces()` | Ids, titles, last change. |
| `get_state(piece_id)` | Current selection, picks, compare, `rev`. The agent calls this first every turn. |
| `get_marks(piece_id, block_ids?)` | Likes, dislikes and notes, with quotes. |
| `get_blocks(piece_id, block_ids)` | Text and rev of the named blocks only. |
| `replace_block`, `insert_blocks`, `delete_block` | Direct edits, with `expected_rev`. Delete is soft. |
| `propose_versions(piece_id, block_ids, options)` | Opens a version group. Shows in place on the page. |
| `add_options(group_id, options)` | More drafts for an open group. |
| `accept(piece_id, group_id, pick, expected_rev)` | Uses one version, or drops them all (`pick: 0`). |
| `get_closed(piece_id, limit)` | Past groups on the same passage, so the agent does not repeat a dropped draft. |
| `open_piece(piece_id)` | MCP only. Returns the MCP App view (see below). |

The rules that `OWNWORDS.md` gives agents today move into the MCP server's instructions and the tool descriptions. Notes and marks are user text, so the descriptions say to treat them as data.

## The three front doors

**1. The hosted page.** Today's `public/` ported almost as is. Keep rendering, selection, diff, marks and timeline. Change: sign-in, WebSocket push instead of polling, ids instead of file names. Drop: Finder reveal, "Ownwords stopped", folder paths in the copy-prompt text. Chrome only for now.

**2. Remote MCP server plus MCP App (Claude).** The tools above on `/mcp`, with OAuth 2.1. Support both ways a client can register (Client ID Metadata Documents and Dynamic Client Registration). Cloudflare's `workers-oauth-provider` does both. Sign-in itself goes through GitHub or Google, so there are no passwords to store. The MCP App is one `ui://` HTML resource: a compact Ownwords view of one piece (versions in place, arrows, "Use this version", marks), inline by default, fullscreen for real editing. Build it on the shared MCP Apps bridge only, and add ChatGPT's `window.openai` extras later behind feature checks. Cloudflare's MCP handler does not mention MCP Apps and there is no official template, so the `ui://` resource is registered by hand with the MCP SDK (inference: the standard needs nothing special from the host).

**3. WebMCP on the page (ChatGPT Mac app).** About 100 to 200 lines. On load, the page registers the same tools with `document.modelContext.registerTool()`, each one calling `/api`. The tools act as the signed-in user, so the owner signs in once inside ChatGPT's built-in browser (it keeps its own browser state). If `document.modelContext` is missing, nothing changes. Plain Chrome will need the WebMCP origin trial token to expose the tools, but nothing uses them there today.

## Phases

Each phase ends with a gate. Hours are agent-assisted estimates (inference).

| Phase | What | Hours | Gate |
|---|---|---|---|
| **P0 Spike** | A throwaway Worker with OAuth and two tools (`get_state`, `replace_block`) plus a tiny `ui://` view. A throwaway page with one WebMCP tool. Test: Claude Mac app and claude.ai as a custom connector; ChatGPT Mac app built-in browser on the owner's real plan and a Sol model; CPU time per call. | 4-6 | Both chat apps call a tool and the edit shows. If either fails, stop and re-plan. |
| **P1 Backend and page** | Durable Object schema, `lib/md.js` port, API, accept and restore as transactions, snapshots, sign-in, WebSocket push, the page ported. Import a folder, export Markdown. | 25-35 | The page works end to end with no agent, on a phone-sized test too. |
| **P2 MCP tools** | All tools on `/mcp`, server instructions (from `OWNWORDS.md`), rev checks. | 12-20 | A full polish session from the Claude Mac app, from start to "take 3". |
| **P3 WebMCP** | The same tools registered on the page. | 4-8 | A full polish session from the ChatGPT Mac app. |
| **P4 MCP App view** | The `ui://` view for Claude: inline and fullscreen, select and mark inside it, buttons call tools. | 15-25 | Polish a piece without leaving the Claude chat. |
| **P5 Tests and hardening** | Port `test/` to the Worker (Miniflare or Vitest pool), rate limits, backups (export all), CPU checks. | 15-20 | All tests pass; a restore from backup works. |

Total about 75 to 115 hours. The order puts the riskiest links first (P0) and the page next, because every front door depends on it.

## Risks

- **Claude's MCP App bridge is only partly documented.** Fullscreen, tool calls from the view and size changes are named. `ui/message` and `ui/update-model-context` are not named for Claude. Design so the view never needs them: the view writes selection and marks to the server, and the agent reads them with `get_state`.
- **ChatGPT site tools are new.** OpenAI's two pages disagree on models and plans. Luna models have them off. P0 tests the owner's real setup before anything else is built.
- **chatgpt.com writes need Business.** If that matters, the fix is a Business workspace, not code.
- **10 ms CPU per request on Workers Free.** The Durable Objects free CPU limit is unclear. Block-level tools keep work small; P0 measures it. The paid plan is 5 dollars a month if needed.
- **Prompt injection.** Notes, marks and page text are user text that reaches the agent. Tool descriptions say to treat them as data. WebMCP has the same risk ("can't be fully prevented", Chrome guide).
- **Lock-in.** Durable Objects are Cloudflare-only. Keep the logic in plain modules (`lib/md.js` style) and the storage behind one small interface, so a move to Postgres later is a rewrite of one file. Markdown export means the writing is never locked in.
- **It ends KISS for the hosted version.** It needs npm dependencies (Cloudflare Agents SDK or MCP SDK, the OAuth provider), a build step, accounts and secrets. That is why it should live apart from Ownwords Lite (open call 1).

## Open calls for the owner

Each: time to decide, effort if picked (0 to 100), importance (0 to 100), my pick.

1. **Where it lives.** A new repo (for example `ownwords-cloud`) that copies `lib/md.js` and `public/`, or a folder in this repo. Decide in 2 minutes. Effort 5, importance 60. **Pick: a new repo.** This repo keeps its zero-dependency promise (D1) and stays the local version.
2. **Who uses it.** Only the owner, or friends too. Decide in 2 minutes. Effort: owner only 0, friends 15 (sign-up, per-user limits, a privacy note). Importance 70. **Pick: owner only for P0 to P3**, with an allow-list of one email, then open it up.
3. **Backend.** Cloudflare or Supabase. Decide in 5 minutes. Effort equal. Importance 50. **Pick: Cloudflare**, for the reasons above.
4. **Which ChatGPT plan.** The route depends on it: Plus or Pro means the ChatGPT Mac app via WebMCP only, and chatgpt.com read-only at best. Business adds chatgpt.com writes. Decide: just say which plan you have. Importance 80.
5. **Is the MCP App view in scope for the first release?** It is the nicest part in Claude but the biggest unknown. Decide in 2 minutes. Effort 20, importance 40. **Pick: after P3.** Tools alone already give full control from chat; the hosted page shows the result.
6. **A cheaper first step.** The Claude Mac app also runs *local* MCP servers and renders their MCP App views (Haiku read this; not tested). ChatGPT's built-in browser may call WebMCP tools on `127.0.0.1` (not checked). If both hold, Ownwords Lite could add an MCP server and WebMCP tools and stay local, with no hosting, for maybe 15 to 25 hours, but with no web access. Decide in 5 minutes. Importance 50. **Pick: test both in P0** (30 extra minutes) before committing to hosting.

## Sources

Read on 28 Oct 2026 unless noted.

- Claude custom connectors (plans, surfaces): https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Claude interactive connectors (MCP Apps, all users, fullscreen): https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude
- Claude Cowork built-in browser (no WebMCP mentioned): https://support.claude.com/en/articles/16607400-use-the-built-in-browser-in-claude-cowork
- MCP Apps spec, stable 2026-01-26: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- MCP Apps in ChatGPT: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- ChatGPT custom MCP servers (plans; updated 27 Oct 2026): https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- ChatGPT site tools (WebMCP in the desktop built-in browser): https://learn.chatgpt.com/docs/webmcp and https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app (updated 28 Oct 2026)
- WebMCP draft (dated 27 Oct 2026): https://webmachinelearning.github.io/webmcp/
- Chrome WebMCP guide and origin trial: https://developer.chrome.com/docs/ai/webmcp
- MCP authorization spec, 2026-07-28 (CIMD recommended, DCR kept): https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Cloudflare remote MCP server guide (updated 27 Oct 2026): https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- Cloudflare MCP authorization (updated 22 Oct 2026): https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
- Cloudflare workers-oauth-provider: https://github.com/cloudflare/workers-oauth-provider
- Workers pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/
- Supabase free limits and pausing: https://supabase.com/docs/guides/platform/billing-on-supabase and https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase OAuth 2.1 server for MCP: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
