# Deployment and storage plan

Status: **proposal, 2 Nov 2026. Nothing is built.** It replaces the 28 Oct hosted plan (Cloudflare Workers plus WebMCP). No decision in [decisions.md](decisions.md) changes until the owner picks the open calls at the end. Facts come from two research rounds on 2 Nov: 14 questions, each asked to both GPT-6.1 Terra and Haiku, then 8 narrow checks. Hours are guesses unless marked measured.

## The answer

- **A local, private version is doable, and it is the best first test.** Writing stays in a folder on the user's Mac. The Claude desktop Code tab and ChatGPT desktop's Codex or Work can already edit a folder. That is how Ownwords Lite works today, so a friend may need no new code.
- **It cannot be fully private or fully offline with Claude or ChatGPT.** The page and files work offline. But whatever the AI reads goes to Anthropic or OpenAI, and the AI needs internet. Only a local model, run from an agent that can edit files, keeps the text on the computer.
- **Build one core, then package it three ways.** The core is a small set of MCP tools over one storage layer. Package 1: today's local folder. Package 2: a local connector for the chat apps. Package 3: a hosted server for the websites.
- **When hosted is needed, keep today's file format.** One folder per user on a separate small server. No database and no rewrite.
- **Dropped for now:** WebMCP (reaches one app, which has a better route), Cloudflare Workers (forces a storage rewrite), sync engines (overkill), and the chat session as the main store (the vendors say not to).

## Who reaches what on a $100 or higher plan

| App | Local folder, no new code | Local MCP connector | Hosted MCP connector |
|---|---|---|---|
| Claude desktop, chat | No | **Yes, with in-chat view** | **Yes**, view likely |
| Claude desktop, Code tab | **Yes** | Tools yes, view unconfirmed | Tools likely, view unconfirmed |
| claude.ai | No | No | **Yes**, view likely |
| ChatGPT desktop, Codex | **Yes** | **Yes** (STDIO) | **Yes** (Streamable HTTP) |
| ChatGPT desktop, Work | Yes, "when enabled for your account" | Through a plugin, untested | Through a plugin, untested |
| chatgpt.com on Pro | No | No | **Read and fetch only**, per OpenAI's newest page. Needs a real test |
| chatgpt.com on Business | No | No | Yes, with writes and widgets. Two paid seats minimum |

- A hosted connector must be on the public internet, over IPv4. Claude calls it from Anthropic's cloud and rejects Tailscale's address range, even from the desktop app.
- Claude Cowork is not a local route on Max. New tasks have run in the cloud since 6 Oct 2026.
- WebMCP works only in ChatGPT desktop's built-in browser, with a Sol model. Pro eligibility and `127.0.0.1` are undocumented. Claude has no documented support. Codex's MCP screen reaches the same app with less risk.

**Best per app:** Claude users get the desktop chat with a connector, because it has the in-chat view and also works on the web once hosted. ChatGPT users get desktop Codex. The chatgpt.com website is the weak spot unless the test below passes.

## Ways to store the writing

| Method | Where the text lives | Can the AI reach it? | Verdict |
|---|---|---|---|
| Folder plus local server (today) | User's Mac, real files | Desktop agents and local connectors. Not websites | **First test** |
| Folder per user on a server | Server, same files | Every app, through hosted MCP | **Hosted default** |
| SQLite on the server | Server | Same | Later, if search or transactions matter. Loses plain files |
| Postgres | Server | Same | Overkill for 2 to 20 users |
| Hosted page with a real local folder (Chrome File System Access) | User's Mac, real files | Not on its own. Needs a relay | Possible later. Chrome only. 45 to 90 hours |
| Browser storage only (IndexedDB, OPFS) | Browser profile | Not on its own | No as main store. Can be cleared. Fine as a cache |
| Chat session (tool results, widget state) | Claude or ChatGPT | Yes | Working copy only. OpenAI: "Do not use it as the source of truth" |
| Claude Artifact storage | Anthropic, 20 MB per artifact | Claude only | A demo at most. Its API is not documented |
| User's Google Drive, Dropbox or GitHub | User's account | Chat connectors not confirmed to write raw Markdown and JSON | Backup or sync later. Google test grants expire every 7 days |
| Relay: public server stores nothing, forwards to the user's Mac | User's Mac. Relay sees text in transit | Yes, even from the web, while the Mac is awake | Only if websites plus local files becomes a real need. Pairing and security are the hard part |
| End-to-end encrypted on the server | Server, unreadable | Not by a server-side tool | Conflicts with hosted MCP. The tool needs plain text |

Also: Git and object storage suit history and backups, not live writing. Yjs, Automerge, PowerSync, Electric and Zero solve offline co-editing, which nobody here asked for.

## Where to host it

| Option | Cost a month | Verdict |
|---|---|---|
| No hosting: each user runs it on their Mac | 0 | **First test** |
| Second small Hetzner server: CAX11, ARM, 2 vCPU, 4 GB, with Caddy on port 443 | EUR 5.99 plus 0.50 for IPv4, net (measured 2 Nov) | **Pick when hosted.** A real boundary from private data |
| Same server as private data, behind a named Cloudflare Tunnel, in Docker | 0 | Fastest, but a public app and a friend's writing sit beside private files and agents. Owner's risk call |
| Tailscale Funnel | 0 | Works technically. Bandwidth limit is unspecified. Not for a box holding private data |
| Cloudflare Workers | Free tier | Node server and file storage must be rewritten |
| Fly or Railway | About $5 | Fine, but no gain over a server already managed the same way |

- Stock changes: on 2 Nov the x86 CX23 and CX33 were sold out in all three EU locations, and CAX11 was in stock in Falkenstein only.
- **Caddy over a tunnel on the second server.** Caddy flushes streams at once with no default stream timeout. Cloudflare buffers unless the response is `text/event-stream`, has a 125 s read timeout, and its Bot Fight Mode cannot be skipped by rules. A box holding only this app can safely have port 443 open.

## Sign-in for hosted

| Option | Claude | ChatGPT | Setup | Verdict |
|---|---|---|---|---|
| No sign-in, secret in the URL path | Yes | Yes | Minutes | Spike only. Anyone with the URL has full access |
| Static bearer token | Beta for "a limited set of organizations" | Codex yes. Chat no | Minutes | No |
| WorkOS AuthKit | Vendor says yes | Vendor says yes | Hours | **Pick.** Free to 1 million users. Works on any host, and the page signs in with the same identity. Untested here |
| Cloudflare Access managed OAuth | Unconfirmed | Unconfirmed | Hours | Backup. Needs Cloudflare in front. Docs name neither app |
| Self-hosted OAuth (Better Auth, MCP SDK, oidc-provider) | Should work | Should work | Hours to days | Only to avoid a vendor |

## How the code changes

Measured: `server.js` is 477 lines with 9 API routes and about 30 lines touching the filesystem, all in that one file. `lib/md.js` is 291 lines with no Node imports, so it runs unchanged in a browser as an ES module. `public/app.js` is 1,556 lines and talks only to the HTTP API.

- **Several users:** one unchanged server process per user, each with its own folder and port, behind a login proxy. Fine for a handful of users. Block `stop`, `info` and `reveal` from the public side. Turn off idle stop.
- **MCP tools:** `list_pieces`, `read_piece` (or single blocks, to save tokens), `write_block`, `propose_versions`, `accept_version`, `restore`, and a read of the current selection and marks. Pure `lib/md.js` functions work as they are. `accept` and `restore` need a small refactor. Tools can call the existing routes at first.
- **Transport:** plain JSON replies with no sessions are allowed by the 2026-07-28 MCP spec, which would keep this very small. Whether both chat apps accept that is untested.
- **Two writers:** one active agent per piece, all writes through one service, each write carrying the revision it read. Today's lock only protects one process, and it does not stop an outside program editing files.
- **Dependencies:** the local package may stay free of npm dependencies (guess). Hosted files live apart, so Lite keeps its promise (D1).

## Phases

Each phase ends with a gate. Stop at any gate if it is enough.

| Phase | What | Hours | Gate |
|---|---|---|---|
| **P0 Tests** | The hands-on tests below | 1-2 | Reach table has no unknowns that matter |
| **P1 Friend, local** | Friend installs Lite and polishes a real piece through the app that suits their plan. A short guide per app | 1-2 | Friend says what they would change |
| **P2 MCP core and local connector** | Tools, a `.mcpb` for Claude desktop, a Codex setup line | 18-36 | Polish from Claude chat and Codex with no Code tab |
| **P3 In-chat view** | One `ui://` view: versions, arrows, marks, select. Reads and writes through tools | 15-25 | Polish without leaving the Claude chat |
| **P4 Hosted** | Second server, per-user processes, Caddy, sign-in, revision checks, backups | 27-65 | Same flow from claude.ai, Claude desktop and ChatGPT Codex |

The order follows risk and value. P1 may answer whether anyone needs more. P2's tools are reused unchanged by P4.

## Tests that settle the unknowns

Documents cannot answer these. They need real accounts.

| Test | Settles |
|---|---|
| In ChatGPT desktop on Pro, attach a temp folder to a local project. Ask Codex, then Work, to edit a file. Open the page at `127.0.0.1` in the built-in browser | Is the local route real on Pro? |
| In Claude desktop, install the Excalidraw `.mcpb`. Ask for a drawing in chat, then in the Code tab | Do `.mcpb` views render, and where? |
| Run a tiny public MCP server with one write tool and one view. Add it to claude.ai, Claude desktop, ChatGPT Codex, and chatgpt.com developer mode on Pro | Does Pro write work on the web? Do views render from a private connector? Is JSON-only accepted? |
| Run that server with WorkOS | Does sign-in work in both apps? |

## Risks

- **Vendors move fast.** Cowork moved to the cloud on 6 Oct, and Pro tiers changed this autumn. The local folder route depends on the least vendor behaviour.
- **Friend's writing on the owner's server.** The owner can read it, and so can any agent on that box. The second server limits this. Say so to the friend.
- **Prompt injection.** Notes and marks reach the agent. Tool descriptions must treat them as data.
- **A public server needs upkeep:** updates, backups and a rule for deleting a user's data.
- **Mac-only launcher.** The local route assumes a Mac. Other systems run `node server.js`.

## Open calls for the owner

Each: time to decide, effort if picked (0 to 100), importance (0 to 100), and my pick.

1. **Local first, or hosted first.** 2 minutes. Effort: local 5, hosted 50. Importance 90. **Pick: local first.** It tests the writing flow with almost no cost.
2. **Hosted location.** 2 minutes. Effort: second server 15, same server 10. Importance 70. **Pick: second server.**
3. **Sign-in.** 2 minutes. Effort 15. Importance 60. **Pick: WorkOS**, after the secret-URL spike.
4. **Code location.** 2 minutes. Effort 5. Importance 40. **Pick: this repo for the local connector, a separate folder for hosted.** This replaces the 28 Oct pick of a new repo, because the code now stays shared.
5. **Later storage options.** Hosted page with local folder, relay, Drive. 5 minutes. Effort 60 or more each. Importance 30. **Pick: not now.** Revisit after P1.

## Sources

Read on 2 Nov 2026 unless noted. Most vendor pages show no date.

- Claude custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp and https://claude.com/docs/connectors/custom/add-unlisted
- Claude local MCP and `.mcpb`: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- MCP Apps in Claude, including local rendering: https://claude.com/docs/connectors/building/mcp-apps/getting-started
- Excalidraw MCP App: https://github.com/excalidraw/excalidraw-mcp
- Code tab: https://code.claude.com/docs/en/desktop
- Cowork architecture: https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview
- ChatGPT custom MCP and Pro limit (updated about 28 Oct 2026): https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- ChatGPT Pro tiers (updated 2 Nov 2026): https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
- ChatGPT desktop: https://learn.chatgpt.com/docs/pricing, https://learn.chatgpt.com/docs/projects, https://learn.chatgpt.com/docs/extend/mcp, https://learn.chatgpt.com/docs/browser
- OpenAI custom MCP guide and auth: https://developers.openai.com/api/docs/guides/custom-mcp-server and https://developers.openai.com/plugins/build/auth
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- ChatGPT site tools (WebMCP): https://learn.chatgpt.com/docs/webmcp and https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app
- Widget state: https://developers.openai.com/plugins/build/chatgpt-ui
- MCP transport spec 2026-07-28: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
- Chrome File System Access and persistent permissions: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access and https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- Storage eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Claude Artifacts: https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them
- Google test users: https://support.google.com/cloud/answer/15549945
- SQLite WAL: https://www.sqlite.org/wal.html
- Cloudflare Tunnel buffering and timeouts: https://developers.cloudflare.com/tunnel/troubleshooting/ and https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/
- Cloudflare managed OAuth: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/
- WorkOS: https://workos.com/authkit and https://workos.com/docs/authkit/mcp
