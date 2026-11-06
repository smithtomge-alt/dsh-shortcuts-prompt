# 快捷指令 · Quick Prompts

A DeepSeek Harness (DSH) plugin that keeps a strip of reusable prompts directly
above the conversation composer.

- The strip starts empty: a single dashed pill reading **快捷指令**.
- Click a chip to insert its prompt at the draft caret.
- Click the pill (or the **管理** control once chips exist) to expand the
  management panel inline, between the strip and the composer — no dialog, no
  scrim.
- The panel holds the list (name + summary + insert / edit / move up / move
  down / delete) and the form. **Both the name and the prompt body are
  required.** A successful add or save always collapses the panel; a failed
  write keeps it open and shows the error, so the draft is not lost.
- The strip itself never edits: it only inserts and opens the manager.

Everything is stored per profile through the DSH storage domain, so the list
survives restarts. Nothing is pre-seeded.

## Layout

| File | Role |
|---|---|
| `lib/index.js` | Host activation: resolves the Harness bases, mounts the service, registers one agent tool |
| `lib/service.js` | Durable list + the five Remote methods (list / create / update / **delete** / move) |
| `lib/schema.js` | zod schemas for records and wire payloads |
| `client.js` | Browser bundle: the strip, the inline panel, the draft insertion |
| `cordis.patch.yml` | Inserts the Host row |
| `locale/{en,zh}.json` | Plugin inventory title/description |
| `icon.svg` | Inventory artwork |

The model sees the same data through the `quick_prompts` tool, which calls the
same service methods as the UI.

## Install

From npm:

```bash
dsh plugin --profile <profile> add dsh-quick-prompts
```

From this repository (source install; it is plain JavaScript, so no build step):

```bash
dsh plugin --profile <profile> add github:smithtomge-alt/dsh-quick-prompts
```

In the desktop app, install it from **Plugins** (Plugin Manager) instead of the
CLI: the desktop profile is managed by the application. Restart or reload the
page after installing so the browser half joins the Client module graph.

## Publish

The package is a bundle: `dsh.bundle` points at `cordis.patch.yml`, and
`dsh.client` declares the browser artifact. Bump `version`, then:

```bash
npm publish --access public
```

Community listing: open a PR against
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
adding `data/plugins/<owner>__<repo>.yml`; the site, the market, and the
`dsh-plugin-catalog` index are generated from those files.

## Boot safety

Two guarantees keep this plugin from ever aborting the page load again:

1. **The Client entry never rejects.** `apply()` delegates to `activate()` inside
   a try/catch and reports the failure, so a broken entry degrades to "strip
   unavailable" instead of failing `web boot` (which shows up as a DSH crash).
2. **The Remote contract is validated locally.** `preview/harness.js` mounts the
   real `client.js` through a faithful subset of the API Gateway's
   `validateContribution`, so a malformed contribution fails in the preview
   instead of in the app.

The contribution must be `{ package, descriptors: [...] }`; the Gateway iterates
`contribution.descriptors`, and an object shaped as `{ package, methods }` throws
`TypeError: contribution.descriptors is not iterable` — which aborts web boot.

## Design notes

- **Placement.** The entry registers in `conversation.input.dock`, the slot for
  full-width rows directly above the composer card, at `order: 30` so it sits
  closest to the card. Its width and centering mirror
  `--dsh-composer-card-max-width`, so its left and right edges line up with the
  input box.
- **Theming.** Colors come only from `--dsw-alias-*` tokens; the stylesheet is a
  single element inserted for the Client run and removed with it.
- **Form focus.** The name field autofocuses once, when a *new* form opens. The
  focus effect deliberately tracks the open/closed transition instead of the
  draft object: a draft is replaced on every keystroke, so depending on it would
  pull the caret back into the name field while the user types the content.
- **Wire method names.** The Client Gateway's Remote namespace service reserves
  `ctx`, `empty`, `invokeRemote`, `methods`, `name`, `namespace`, plus the
  prototype members `assertMethodAvailable`, `has`, `install`, `installDirect`,
  `installScoped`, and `remove`. A Remote method with one of those names fails to
  mount with `client api: method ... conflicts with its namespace service`, so
  deleting an instruction is exposed as `quickPrompts/delete` (the UI and the
  agent tool keep calling it "delete"/"remove" in prose).
- **Host dependencies.** A profile install keeps DSH's own packages inside the
  application, so the Host half resolves `TypertRemoteService`, the storage
  domain helpers, and `zod` through `createRequire` against the running
  installation instead of importing them.
