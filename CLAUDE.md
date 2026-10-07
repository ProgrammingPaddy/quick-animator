# Quick Animator

A low-friction, code-based motion graphics tool for video. Read these before changing anything:

1. `docs/requirements.md`: what the tool must do and why. Principles P1 to P7, numbered requirements.
2. `docs/checkpoints.md`: the build order and what the current checkpoint includes.
3. `docs/decisions.md`: every functional decision and its status.
4. `docs/architecture.md`: how the round trip between code and panes works.
5. `docs/animation-rules.md`: the animation language, for agents writing animations.

## Rules for working here

- Build only what the current checkpoint lists. Anything else goes in the backlog in `docs/checkpoints.md`.
- Do not assume functionality. If a behavior is not decided in `docs/decisions.md`, ask the owner, propose a default, and log the answer.
- No bloat: no UI kits, no speculative options, no settings for things that have one good default.
- Interactions on basic features are polished before new features are added.
- Code is the truth: any new GUI edit must be a minimal text edit to the user's file.
- Every checkpoint updates `docs/animation-rules.md`.
- Commit only when the owner asks.

## Commands

- `npm run dev` starts the app with hot reload.
- `npm run typecheck` type-checks main, preload, and renderer.
- `npm run build` builds to `out/`.

## Verifying in the real window

Always check changes in the Electron window, not only in a browser; CSS and file access differ.
Start the app with a debugging port, then screenshot it or evaluate JavaScript in its page:

```
npx electron-vite dev -- --remote-debugging-port=9222
node scripts/inspect.mjs shot out.png
node scripts/inspect.mjs eval "window.__quickAnimator.useStore.getState().selection"
node scripts/inspect.mjs eval "window.__quickAnimator.openProject('C:/path/to/examples/first')"
```

Use forward slashes in paths passed through the shell. In development the page exposes
`window.__quickAnimator` with `useStore`, `openProject`, and `getEditor`.

Two traps: the editor is created once, so after editing anything it uses (`src/renderer/src/code/`)
reload the window (`node scripts/inspect.mjs eval "location.reload()"`) before testing; and Vite's
watcher can miss the second of two quick writes to one file, so if the served module looks stale,
`touch` the file.

## Layout

- `src/main`: Electron main process. `src/preload`: the typed bridge. `src/shared`: types used on both sides.
- `src/renderer/src`: the UI. `panes/` the five panes, `state/` the store and clock, `preview/` the Three.js viewport and scene renderer, `code/` the one shared editor, `model/` the class registry, parser, evaluator, sampler, and text edits, `project/` loading, saving, and the GUI operations that rewrite code.
- `examples/first`: a sample project to open from the app.
- `docs/`: the documents above.
