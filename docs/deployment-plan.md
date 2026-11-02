# Deployment and storage plan

Status: **plan, 2 Nov 2026. Nothing is built.** The owner chose the direction in [D10](decisions.md): a public tech demo of both interfaces on his server. It replaces the 28 Oct hosted plan (Cloudflare Workers). Facts come from two research rounds on 2 Nov: 14 questions, each asked to both GPT-6.1 Terra and Haiku, then 8 narrow checks. Hours are guesses unless marked measured.

## The answer

- **Build a tech demo of both interfaces, to see which one works best.** MCP Apps show Ownwords inside the chat. WebMCP keeps the website beside the chat. They feel very different, and only using them will tell.
- **Host it publicly on the owner's server.** Only this app goes public. Everything else on the box stays as it is.
- **One backend, one tool set.** Each interface is a thin layer over the same tools and the same folder per user, in today's file format.
- **WebMCP has one hard limit.** Only ChatGPT's desktop app can call it natively, inside its own built-in browser. Claude has no documented support. So a third, cheap layout is included: the same side-by-side page, driven by ordinary MCP tools, which works in Claude too.
- **A local, private version stays possible.** Writing stays on the user's Mac, and desktop agents can already edit that folder. The AI still sends what it reads to Anthropic or OpenAI. Only a local model keeps text on the computer. This is not the main track now, but it is the cheapest fallback for a friend.

## The interfaces to compare

| Interface | What the user sees | In Claude | In ChatGPT |
|---|---|---|---|
| **A. In chat (MCP App)** | Ownwords inside the conversation, inline or fullscreen | Desktop chat and claude.ai | chatgpt.com. On Pro, widgets and writes are unconfirmed, and OpenAI documents read and fetch only. Mac chat is unconfirmed |
| **B. Side by side, WebMCP** | The site beside the chat. The agent calls tools the page registers | No documented support. Only a community bridge (MCP-B) with a Chrome extension | Desktop app's built-in browser only, with a Sol model. Not the user's own Chrome. Pro eligibility is undocumented |
| **C. Side by side, MCP tools** | The same page in Chrome beside the chat. The agent calls hosted tools, and the page updates by itself | Desktop chat and claude.ai | Desktop Codex |

- B and C look alike but work differently. In B the tools live in the page, so the page must stay open. In C they live on the server, so the agent works with the page closed.
- C costs almost nothing extra, since A already needs the hosted tools.
- A guess to test: a view could save marks and selection straight to our API, which might work even where Pro blocks MCP write tools. The agent's own edits would still be blocked.

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
- WebMCP's limits are in the table above. `127.0.0.1` is undocumented for it, and plain Chrome needs an origin trial token.

**Best per app:** Claude users get the desktop chat with a connector, because it has the in-chat view and also works on the web once hosted. ChatGPT users get desktop Codex. The chatgpt.com website is the weak spot unless the test below passes.

## Ways to store the writing

| Method | Where the text lives | Can the AI reach it? | Verdict |
|---|---|---|---|
| Folder plus local server (today) | User's Mac, real files | Desktop agents and local connectors. Not websites | **Local fallback** |
| Folder per user on a server | Server, same files | Every app, through hosted MCP | **Demo store** |
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

**Chosen: publicly on the owner's server, for this app only.** The home page, admin tools and agents stay private as they are today.

Changes on the server:
- Allow TCP 443 in the Hetzner firewall and in `ufw`. Port 80 too, unless certificates use the DNS challenge.
- Add Caddy for HTTPS and a subdomain with a DNS-only record. Bind it to the public IP, because Tailscale Serve already uses 443 on the tailnet address (a guess to confirm).
- Run the app in Docker with its own folder, a memory limit and no access to the workspace, tokens or browser profile. The server's own notes already set this rule for public apps.
- Teach the server's setup kit and checks the new rule, or a rebuild will close the port again, and a check that expects no public ports will fail (a guess to confirm).

Measured on 2 Nov: 5.4 GB memory and 44 GB disk free, so capacity is fine. Connectors are IPv4-only, and the server has a public IPv4.

**Alternatives if this changes**

| Option | Cost a month | Note |
|---|---|---|
| Named Cloudflare Tunnel on the same server | 0 | No open port and the IP stays hidden. Cloudflare buffers unless `text/event-stream`, has a 125 s read timeout, and Bot Fight Mode cannot be skipped by rules |
| Second small server (CAX11, ARM, 2 vCPU, 4 GB) | EUR 6.49 net | A real boundary from private data. In stock in Falkenstein on 2 Nov; x86 CX23 and CX33 were sold out in the EU |
| Cloudflare Workers | Free tier | Node server and file storage must be rewritten |
| Fly or Railway | About $5 | No gain over a server already managed |

The Mac-only option (no hosting) remains the local fallback.

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
| **P0 Look spike** | Open the app publicly. One throwaway page with one WebMCP tool and one `ui://` view with one tool, on real text. No real sign-in yet (secret URL) | 3-6 | The owner sees A, B and C in real apps, on real accounts, and the Pro unknowns are answered |
| **P1 Hosted core** | Per-user processes and folders, sign-in, deploy | 19-49 | The page works publicly for the owner and the friend |
| **P2 Tools** | The full MCP tool set, used by every interface. Interface C works at this point | 16-32 | A full polish from Claude and from ChatGPT Codex |
| **P3 WebMCP** | The same tools registered on the page | 4-8 | A full polish from ChatGPT's built-in browser |
| **P4 MCP App** | The real in-chat view: versions, arrows, marks, select | 15-25 | A full polish without leaving the chat |
| **P5 Compare** | The owner and the friend use each interface on real pieces and say which stays | 2-4 | One interface is picked, or both stay |

About 60 to 125 hours in all (guess). Revision checks wait until after the demo, so one writer at a time is the rule until then. If P0 shows that one interface cannot work on the plans that matter, drop its phase.

## Tests that settle the unknowns

Documents cannot answer these. P0 covers all of them, on real accounts.

| Test | Settles |
|---|---|
| In ChatGPT desktop on Pro, open the public page in the built-in browser with a Sol model, and ask it to call the WebMCP tool | Does B work on Pro? Is an origin trial token needed? |
| Add the public server to chatgpt.com developer mode on Pro, with one write tool and one view | Does A render on Pro? Does the write run? |
| Add it to Claude desktop chat, claude.ai and ChatGPT Codex | Does A render from a private connector? Does C work? Is JSON-only accepted? |
| Run the same server with WorkOS | Does sign-in work in both apps? |
| Attach a temp folder in ChatGPT desktop, and install the Excalidraw `.mcpb` in Claude desktop | Is the local fallback real on Pro? Do local views render? |

## Risks

- **Vendors move fast.** Cowork moved to the cloud on 6 Oct, and Pro tiers changed this autumn. The local folder route depends on the least vendor behaviour.
- **Friend's writing on the owner's server.** The owner can read it, and so can any agent on that box. Say so to the friend.
- **WebMCP is a draft.** The API was renamed this year and may change again. Keep its layer thin.
- **Prompt injection.** Notes and marks reach the agent. Tool descriptions must treat them as data.
- **A public server needs upkeep:** updates, backups and a rule for deleting a user's data.
- **Mac-only launcher.** The local route assumes a Mac. Other systems run `node server.js`.

## Open calls for the owner

Each: time to decide, effort if picked (0 to 100), importance (0 to 100), and my pick.

1. **The subdomain name.** 1 minute. Effort 2. Importance 30. No pick: the owner names things.
2. **Go for P0.** 2 minutes. Effort 15. Importance 90. It opens port 443 on the server. **Pick: yes.** It shows the three looks before the larger build.
3. **Which ChatGPT account tests B and A.** 1 minute. Effort 0. Importance 80. Pro results may differ from Business. **Pick: the owner's own account first.**
4. **Sign-in after the spike.** 2 minutes. Effort 15. Importance 60. **Pick: WorkOS.**
5. **Code location.** 2 minutes. Effort 5. Importance 40. **Pick: this repo for shared code and tools, a separate folder for hosted files,** so Lite keeps its no-dependency promise (D1).
6. **Later storage options.** Hosted page with a local folder, relay, Drive. 5 minutes. Effort 60 or more each. Importance 30. **Pick: not now.** Revisit after P5.

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
