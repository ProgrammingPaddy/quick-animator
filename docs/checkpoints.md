# Checkpoints

The build order. One checkpoint at a time. Nothing from a later checkpoint is started early,
even when it is easy. Each checkpoint ends with the owner using it by hand and a pass on feel.
Requirement numbers refer to `requirements.md`; decision numbers to `decisions.md`.

## Working agreement

- A checkpoint is done when its "Done when" list passes in the real app, not only in tests.
- Every checkpoint updates `animation-rules.md` so an agent can use what was built.
- Every functional decision made along the way is logged in `decisions.md` with its status.
- Anything not in the current checkpoint is written in the backlog, not built.
- Basic interactions get a feel pass before the checkpoint closes: latency, feedback, discoverability, and what an accidental click does.

## CP0. Shell

Goal: the main window exists, with the four panes bound to one shared state.

Status 2026-10-07: built, awaiting the owner's hands-on review. Verified by driving the app: boots without console errors, agreed layout, collapse and expand with persistence, split drags with persistence, play and pause, scrub, frame stepping, typecheck and production build. The owner's first review added the Now pane, the world view with free zoom and pan, the open-ended zoomable timeline, and line wrapping.

In: Electron, Vite, React, TypeScript app that boots on Windows 11. Fixed layout of five panes with resizable splits and collapsible panes that persist (R1). One shared store. A playback clock with play, pause, scrub, frame stepping, time in seconds and frames, over an open-ended time axis that zooms and scrolls (R24, R25, R7 partial). A preview that shows the camera frame in a world that pans and zooms freely (R10, partial). A code pane with a wrapping JavaScript editor, not yet file backed (R40, partial). An object pane and a Now pane with empty states.

Out: project files, parsing, rendering objects, selection, undo.

Done when:
- The app boots with no console errors and the five panes are in the agreed layout.
- Each split drags, each pane collapses and expands, and the layout survives a restart.
- Play, pause, scrub, and arrow keys move the playhead in the timeline and the time readout in the preview together, at display refresh rate.
- The preview pans and zooms around the cursor, fits, and returns to 100%. The timeline zooms around the cursor from minutes to frames, scrolls, and follows the playhead.
- `npm run typecheck` passes.

## CP1. The loop

Goal: the heart of the tool. Code to panes and panes to code, live, for one object and one move. This checkpoint proves the architecture. Nothing else is built until it feels right.

Status 2026-10-07, first slice built and awaiting the owner's hands-on review. Working: project folders with open, new, remember-last, save, and outside-edit reload; the evaluator with Rect, Circle, Text, the verbs `to`, `move`, `rotate`, `scale`, `resize`, `fade`, `appear`, `disappear`, timing with `at`, `delay`, `duration`, `until`, `easeIn`, `easeOut`, `ease`, time references, implicit starts, lifetimes with fades, and arrow-function links; rendering at the playhead; the object list; timeline rows with lifetime bars and clips that drag by body and edges; add by tool and click; drag to position; shift-drag to make a move; the Now pane; one undo history; errors keep the last good model; the example project in `examples/first`. Verified in the Electron window the same day: opening the example project, saving a drag to disk, and reloading an outside edit. After the owner's first hands-on review, also on 2026-10-07: fixed the app treating its own saves as outside edits, which reset the editor and snapped clips while typing or dragging; GUI edits are refused while the code has an error (D63); autocompletion with Tab expansion of classes and verbs, smart Tab indent, Ctrl+F search, and selection-match highlighting; a loop toggle that is off by default; row-header scrolling; overlapping clips in lanes; the action list under each object; right-click menus; the Selected pane name. Later the same day, after the owner's second review: one visibility system based on opacity, with an opacity lane in every row and right-click appear and disappear (D52); relative values and the rule for overlapping actions (D51, D53); the hold marker (D54); 60 fps default (D65); the snap toggle (D64); action selection marked everywhere, identifiers on clips, and color-by-kind marks in the code (D66, D67); color swatches in the code (D68); completion after a written name (D69); right-click on a track to add an action. After the third review, also 2026-10-07: Delete removes only what is highlighted (D73); duplicate (D74); rename everywhere, including naming an action (D75); a confirm dialog that resolves references before a delete (D72); pops and the fade-out edge case (D71); destination drags for absolute and relative actions (D70); error gutter mark, jump, and overview ruler (D76, D78); jump on select (D77); ghost default lines with a Defaults toggle (D35); the Help pane (D55); themed scrollbars, a timeline scrollbar, and two preview scrollbars (D78). After the fourth review, also 2026-10-07: drag modes with rotate and scale drags in every flavor (D79); classes with `class` and `all('name')`, class rows in the timeline, dashed member clips that copy on edit, and the Classes dialog (D80); Ctrl+C and Ctrl+V (D81); a stable preview scroll area (D82); the opacity lane prototype with fade handles and double-click (D83, to be judged); type groups, folding, and add-by-right-click in the object pane and the timeline (D84); the file watcher reads again when it catches a file mid-write. After the fifth review, 2026-10-08: the preview scrollbars fixed (D85); the selection gizmo with resize handles, a rotate handle, a combined Transform mode, and preview snapping (D86, D91); toolbar clicks kept off the canvas (D87); the Classes dialog (D88); marquee and Ctrl-click selection with multi-object drags, deletes, and copies (D89); selection in the undo history (D90); overrides that switch a class action off for one object, types as classes, class opacity lanes, objects listed in all their places (D80, D93); the timeline scrubbing from the ruler only, a clipped playhead, and rows that reorder by drag (D92). After the sixth review, 2026-10-08: selection drawn in white with a dark rim (D94); free corners with Alt for proportions and the far side always anchored, Shift meaning only animate (D86); arrow keys on the selection (D95); group transforms (D96); several actions selected, retimed together, by the wheel and the arrows (D97); independent folding per pane (D98); the timeline as a class tree without duplicates (D99); one naming scheme and colored menus (D100); themed number fields (D101); the Open dialog starting beside the last project. After the seventh review, 2026-10-08: drags write end states directly and show them (D102); From here and To here for new animations, with the playhead returning after a Shift gesture (D103); Edge and Center anchoring (D104); rotations past a full turn with direction (D105); ovals through width and height (D106); twins for objects in two sibling classes (D107); stable proportional resizing and larger handle hit areas. After the eighth review, 2026-10-08: the app's own top bar in place of the system menu and title bar (D108); fades folded into one menu entry (D109); one-frame pops (D110); the wheel settled: Shift for lengths only, Ctrl or sideways for time, Alt for rows (D111); a draggable pivot (D112); a proportions chip (D113); ghost lines for actions (D114); cut (D115). After the ninth review, 2026-10-08: a group's box turns with the group (D116), the pivot arms on a double-click and draws as a thin x above everything (D112), menus stay inside the window with the fade entry reading as one phrase, one-frame durations land on frame boundaries (D110), and the top bar is the window's top with the actions on the left (D108). Closed by the owner after the ninth review (D117); the drag strategy that avoids a re-parse per frame and the agent test open CP2.

In:
- Project folder format (R120) and a sample project.
- The class registry (D36) for Rect, Circle, Text, Group, with autocompletion, inline docs, and Tab expansion (R40); validation on load.
- The scene language subset: those classes with literal attributes; the verbs `to`, `move`, `rotate`, `scale`, `resize`, `fade` with `at`, `duration`, `easeIn`, `easeOut`; `appear` and `disappear` with fades, shown as lifetime bars (R50 partial, R60, R63, R64 partial); no imports (D34).
- Complete view, minimal file: ghost default lines and the preference (D35, R41).
- The Now pane showing every attribute of the selection at the playhead, display only (R46, R47).
- Navigation between an object and its actions in one step each way (R42).
- Load, watch, and save project files (R44, R122). Parse and evaluate scene code into the model (D24). Last good state on error, inline errors (R6).
- Preview renders the scene at the playhead through the single renderer with the flat camera (R10, R15, R67).
- Object pane lists the tree (R30, list only). Timeline shows rows and clips (R20, R21). Code pane is file backed and organized into blocks (R41, R42).
- Shared selection (R3). Playback and scrub render the scene.
- GUI edits that rewrite code: drag an object in the preview; drag a clip and its edges in the timeline; add an object from the toolbar by clicking in the preview (R12, R45).
- The motion gesture (R13, D27) with the default duration (D31).
- Undo and redo as one history (R5).
- Autocompletion from shipped type definitions (R40, R123).
- `animation-rules.md`, first complete version (R121).

Out: relative timing, expressions, paths, text animation, 3D, audio, video, export, inline literal controls (R43), presets (R66).

Done when:
- The five-click test passes for a move and feels right (requirements section 17).
- The round trip is stable: a GUI drag changes exactly one literal in the file and nothing else; a code edit shows in every pane within 100 ms; an external edit by an agent shows live without losing the playhead or the selection.
- A coding agent given only `animation-rules.md` writes a scene that loads without error on the first try.
- The language sketch in `architecture.md` is confirmed or replaced, and the decision is logged.

Risks to verify first: 2D edge quality and text sharpness in the WebGL renderer (D20); parse and evaluate time during a drag (the drag strategy in `architecture.md`).

## CP2. Export and headless

Goal: the tool produces video from the UI and from the terminal, so it can be used for real work and agents can render and inspect what they wrote.

First, carried over from CP1: the agent test (a coding agent given only `animation-rules.md` writes a scene that loads without error on the first try), and the drag strategy that avoids a full re-evaluate per frame.

In: frame capture from the same renderer at project resolution and frame rate; bundled ffmpeg; H.264 mp4 by default plus the cheap extras (R110); an export dialog with presets and progress; the headless render command with a one-page doc (R111); a frame exactness check (R112).

Out: audio in the export, which comes with CP7.

Done when: an exported mp4 matches the preview frame for frame on a test scene; the headless command produces the identical file; the command's doc fits on one screen and needs no explanation.

## CP3. Timing, states, and links

Goal: things happen in relation to other things, and the relations are visible and draggable.

In: named actions and relative starts with start, end, progress fraction, delay, and `until` (R61); the states picker (R62); keyframes inside actions (R63, R22); timeline connectors with ripple when an action moves (R23); parenting by drag in the object pane (R30, R54); attribute expressions with link indicators and the lock, offset, replace behavior with the per-case choice (R16, R65); link actions with a start and an end (R65); ease handles and fade handles on the timeline, and the named curve picker (R21, R64, R69); inline literal controls in the code pane (R43); editing in the Now pane (D45); presets for slide, pop, bounce, snap (R66); relationship indicators in the object pane (R31); the right-click menu (R32).

Done when: "the bullet moves once the smoke is half done" is set up in under five clicks and is one line of code, the connector is visible, and moving the smoke moves the bullet. Every link kind in the requirements exists and is visible somewhere.

## CP4. Motion paths

Goal: draw a path, make something follow it, and get it right without fiddling.

In: path drawing in the preview with corners and curves, smoothing, and cleanup (R70); follow with easing, orientation, and timed checkpoints (R71); points editable in the preview and the code, and the Path object (R72, R14); morph between the core shape kinds and their dimensions (R68, D43).

Done when: a path drawn in a few clicks looks smooth, an object follows it with no visible kinks, checkpoints can be timed from the timeline and the preview, and a circle morphs into a rectangle without a visible seam.

## CP5. Text

In: fonts from the system and the web with full styling (R80); per-character, per-word, and per-line animation with stagger presets (R81).

Done when: a title reveal takes under five clicks and looks professional with the defaults.

## CP6. 3D

In: the scene camera as an object with an animatable projection blend and an isometric preset (R91); 3D shapes and simple lighting (R92); the viewport camera with orbit and return (R17); depth sorting rules for mixed 2D and 3D (R90); a documented recipe for a flat scene that reveals into isometric.

Done when: a 2D scene transitions smoothly into an isometric reveal, and nothing in the 2D workflow got harder.

## CP7. Audio and video

In: import to assets, timeline rows, waveform, synced playback (R100, R26); reference or render per asset (R101); video as a scene object (R102); audio in the export.

Done when: an animation is timed to a voiceover by eye and ear without leaving the app, and a video clip is animated inside the scene.

## CP8. Components

In: save a group with its actions and links as a component with parameters; instantiate it; edit the definition and see every instance update; the library file (R41, R32).

Done when: a lower third is built once and reused with different text and timing in under five clicks.

## CP9. Distribution

In: installer, settings, first run, a performance pass, user docs.

## Backlog, not scheduled

An audio level drives a property (R103). SVG import. Drawn vector shapes and morphing. Text on a path and 3D text (R82). Model import. macOS and Linux. An in-app agent and an app scripting API or MCP server. Object to object snapping. Timeline rows aligned with the object tree as one panel (D28).
