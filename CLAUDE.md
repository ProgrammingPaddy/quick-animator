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

## Layout

- `src/main`: Electron main process. `src/preload`: the typed bridge. `src/shared`: types used on both sides.
- `src/renderer/src`: the UI. `panes/` the five panes, `state/` the store and clock, `preview/` the Three.js viewport and scene renderer, `code/` the one shared editor, `model/` the class registry, parser, evaluator, sampler, and text edits, `project/` loading, saving, and the GUI operations that rewrite code.
- `examples/first`: a sample project to open from the app.
- `docs/`: the documents above.
