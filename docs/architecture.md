# Architecture

How the app is built so that code stays the truth and every pane stays live. D-numbers refer to
`decisions.md`. Sections marked PROPOSED are confirmed or replaced in CP1.

## Stack

- Electron with Vite and React, written in TypeScript (D18). User animation files are JavaScript (D16).
- Rendering: one Three.js renderer for 2D and 3D (D20).
- Code pane: CodeMirror 6 (D19).
- State: a zustand store in the renderer. Nothing beyond React for the UI.
- Parsing: a JavaScript parser with source positions (acorn), and minimal text edits for rewrites. The file is never reprinted.
- Export: frames from the same renderer, encoded by a bundled ffmpeg (D25).

Dependencies and their reasons:

- `electron`, `electron-vite`, `vite`, `@vitejs/plugin-react`: app shell, build, hot reload.
- `react`, `react-dom`: UI.
- `zustand`: the shared store.
- `three`: the renderer.
- `@codemirror/*`, `@lezer/highlight`: the code pane.
- CP1 adds `acorn` for parsing and `chokidar` in the main process for file watching.

## Processes

- **Main** (Node): windows, project folder access, file watching, ffmpeg, the headless render entry.
- **Preload**: a small typed bridge, `window.api`, between main and renderer.
- **Renderer** (Chromium): the five panes, the store, the parser, the evaluator, the Three.js scene.

## Data flow

```
project files on disk
   |  watch / save
   v
source text --parse--> AST with positions --evaluate--> scene model (objects, actions, resolved times)
   ^                                                          |
   |  minimal text edits                                      v
GUI edits (preview drag, timeline drag, add, delete)    panes render the model at the playhead
```

The scene model is derived. It is never saved; the source text is. Every pane reads the model and
the shared UI state (selection, playhead, zoom, collapsed panes, hide toggles). UI state is not
code and is not saved with the project.

## The round trip

1. **Parse.** The scene file is parsed into an AST with byte positions.
2. **Evaluate.** The file runs in a sandbox with the Quick Animator runtime API (see Evaluation). Running it builds the object list and the action list. Relative starts are resolved into absolute times. The result is the scene model.
3. **Map.** While evaluating, each object and action is tied back to the AST node that created it, and each literal attribute to its source range. This map is what the GUI edits.
4. **GUI edit.** A drag computes a new value, finds the literal's range in the map, and replaces exactly that span of text. The edit is applied as an editor transaction, so the code pane shows it immediately and the undo history records it.
5. **Re-evaluate.** The text change triggers parse and evaluate again, and every pane re-renders from the new model.

Anything the GUI cannot map to a literal is code-driven: it is shown, it is not GUI-editable, and
the GUI offers Jump to code (D24).

## Evaluation: no imports, no wrapper (D34)

A scene file contains only declarations and actions. Nothing is imported and nothing is exported.
The app runs the file inside a scope that already holds every class (`Rect`, `Circle`, `Text`,
and so on): a `with` block over a Proxy, so a bare `smoke = Circle({ ... })` assigns through the
scope and names the object, no `const` needed (D48). `const` and `let` are accepted; the app
blanks the keyword before running so the name still passes through the scope. Each evaluation
starts with a fresh registry, and running the file fills it with objects and actions. The library
file will be evaluated first, and what it declares will be available to every scene the same way.

Shipped type definitions declare the same names as globals, so the editor autocompletes them.
The rules document says plainly: nothing is imported.

## The class registry (D36)

Every object type is a class with a schema: its attributes, their types, defaults, ranges, and
one-line docs; which attributes animate; and which verbs apply. One registry drives everything
that has to agree:

- autocompletion and inline docs in the code pane,
- expansion: a type name and Tab inserts a full block with every attribute at its default,
- validation on load, with inline errors for unknown attributes or wrong types,
- the ghost default lines in the code pane (D35),
- the Now pane,
- the generated reference section of `animation-rules.md`.

## Classes (D80)

An object's `class` attribute lists CSS-like class names. `all('name')` returns a selector whose
verbs make one action per member declared so far, all sharing one statement: the model records
a `ClassAction` with its members, each member action points back at it, and a named class action
is a time reference over all its members (its start is the earliest, its end the latest). The
panes show the statement once, as a clip on the class's row and a row in the object pane, and
on each member as a dashed, derived clip. Membership is by `class` names and by type, so `all('Rect')` covers every rectangle. An own
action with `overrides: name` marks the class member action as overridden: it drops out of
sampling, timing, time references, and the content end, and the panes draw it switched off. GUI
edits never touch a class statement from a member: editing a derived clip first appends the
member's override, naming the class action when it has no name, and then edits the override.
"Copy as own action" appends a plain copy instead. Dragging the class clip edits the one
statement.

## The gizmo and drags (D79, D86, D89)

The renderer draws a box around every selected object and, for one selected object, the handles
of the mode: eight resize handles on the corners and edges, a rotate handle above. It reports the
handle under a world point, each object's drawn frame and axis-aligned box, and the objects a box
touches. The preview turns a pointer-down into a drag of one kind, move, rotate, or resize, from
the handle hit or the mode, and a flavor, plain, timed (Shift), or destination (a matching action
selected). Resize works in the object's own frame: the far side stays put, corners keep the
proportions, and the result is factors applied to the dimension attributes, so the same math
serves Rect, Circle, and Text. Snapping rounds the value being written. A drag on empty space is a
marquee.

## Selection in the history (D90)

The store hands every selection change to a sink; the controller turns it into an editor
transaction carrying a selection effect, which the history records through `invertedEffects`. The
editor's update listener applies the effect's new selection back to the store, flagged so it does
not become a new step. GUI edits that select something put the effect in the same transaction.

## Complete view, minimal file (D35)

The file holds only the attributes the author set. The code pane shows every attribute of every
object: the set ones as real lines, the rest as dimmed ghost lines showing their default, drawn
by the editor and absent from the file. Editing a ghost line writes it into the file as a real
line. A preference switches between "all attributes" and "set attributes only". Each block folds.

## Drags and real time

Parse and evaluate are fast for normal scenes, but a drag must never wait on them. During a drag:

- The model is patched directly for the dragged value, and the preview renders from the patched model every frame.
- The literal in the code pane is patched as text every frame, so the number visibly changes while dragging, without a full re-evaluate.
- On release, one editor transaction holds the whole drag, a full re-evaluate runs, and the result must equal the patched model. A mismatch is a bug and is logged.

Typed code is re-evaluated on a short debounce. External file changes are re-evaluated on the
watcher event. In both cases the playhead and the selection, by object name, are kept.

## Rendering

- One Three.js scene. 2D objects are flat meshes in draw order. The default scene camera is flat (orthographic). The 3D checkpoint animates the camera's projection blend toward perspective.
- Coordinates: origin at the center of the camera frame, y up, units are pixels at project resolution, rotation in degrees (D21).
- Anti-aliasing by multisampling. Text is drawn to a canvas at twice the size and shown as a texture; CP1 keeps signed distance fields in reserve if zooming shows it soft.
- An object whose opacity is zero is not sampled, drawn, or hit (D52). Visibility costs nothing.
- Rendering is on demand: when the playhead, the model, the selection, or the view changes. Playback renders once per display frame.

## World and camera (D40)

The preview shows the world, not only the output. The camera frame is drawn as a rectangle at
project resolution. Objects exist and move outside it, so things can enter from off screen or
wait there. The wheel pans, Ctrl and the wheel zoom around the cursor, the middle button drags,
Fit shows the whole frame, and the zoom readout jumps to 100%. Only what the scene camera sees is
rendered to video.

In 3D the scene camera is an object (R91): its position, target, and projection blend are
attributes and animate like any other. The preview has a second, free viewport camera for
orbiting while editing, and draws the scene camera's frustum so the shot is always visible;
"Look through camera" returns the preview to the exact render view. A 2D camera move, such as a
slow push-in, is an animation of the scene camera.

## Time (D41)

- Time in code is seconds. The timeline shows seconds and frames and snaps to frames.
- The timeline has no fixed length. The content end is the end of the last action plus the hold from `project.json`, dragged as a marker on the ruler (D54). Playback stops or loops there, and the export range defaults to it. The wheel zooms the time axis around the cursor; Shift and the wheel scroll. Drags snap to whole seconds and to other actions when snapping is on, and place exactly when it is off (D64). The view pages forward while playing.
- A frame is a pure function of time (R67). Expressions receive the time and read other objects' values at that time. There is no per-frame mutable state.
- Export samples the frame times exactly. Preview samples the display clock and may skip frames.

## Undo

The undo history is the editor's text history (D22). A GUI gesture is one grouped transaction.
Undo restores the text, the model re-derives, and every pane follows. UI state such as the
selection is not part of undo.

## Identity

The variable name is the object's name (D23). Rename is an AST aware rename of that identifier in
the scene file. Selection, the object pane, timeline rows, and the code pane all key on the name.
Objects created in loops get generated names and are code-driven.

## Errors

A parse or evaluate failure keeps the last good model on screen. The error is shown at its line
in the code pane and in a status line. An expression that throws at a given time holds its last
value for that frame and is reported once.

## Files and assets (D44)

```
my-animation/
  project.json        resolution, fps, export defaults, scene order
  scenes/main.js      one scene per file
  lib/library.js      shared functions and saved components
  assets/             images, video, audio, fonts, imported shapes
```

External material is never imported in code. A file dropped on the preview or the object pane is
copied into `assets/` and referenced by name: `Image({ src: 'logo.png' })`,
`Video({ src: 'clip.mp4' })`, `Shape({ src: 'icon.svg' })` for an imported outline, and
`font: 'Inter'` for a font in `assets/fonts` or installed on the system. The app resolves the
names, caches decoded media, and reports a missing file inline where it is referenced.

## Dev mode (D34)

Normal mode shows the scene file as it is on disk, plus the editor's ghost lines and inline
controls. Dev mode adds what the app derived: the resolved absolute time of every action, the
generated names of code-driven objects, evaluation time, and raw errors. Nothing in the file
changes between the two modes.

## Headless

`quick-animator render <project> [--scene main] [--out file]` launches the app without a visible
window, loads the project, renders every frame through the same renderer, and encodes with
ffmpeg. Progress on stdout, a non-zero exit on error, a one-page doc.

## The animation language, fourth draft

Plain JavaScript with a small API and no imports. Three rules shape it: it reads as "this
happens, and this is how long it takes"; every GUI-editable value is a literal on its own line,
like a CSS declaration; and names come from assignment. A scene file has two parts: the cast
declares every object, the script lists what happens in time order (D32). An object exists
wherever its opacity is above zero, and nowhere else (D52).

```js
// scenes/main.js

// Cast: every object, one attribute per line.

smoke = Circle({
  x: 0,
  y: 0,
  radius: 40,
  fill: '#888888',
})

bullet = Rect({
  x: -400,
  y: 0,
  width: 40,
  height: 10,
  fill: '#ffffff',
})

tag = Text({
  text: 'whoosh',
  fontSize: 24,
  fill: '#ffcc00',
  opacity: 0,
})

shadow = Circle({
  x: () => smoke.x + 10,
  y: () => smoke.y - 10,
  radius: 40,
  fill: '#000000',
  opacity: 0.3,
})

arc = Path({
  points: [
    [-400, -200],
    [0, 200],
    [400, -200],
  ],
  smooth: true,
})

// Script: what happens, in time order. Each action is one block: the attributes that change,
// then when it starts and how long it takes. Without `at`, an action starts when the object's
// previous action ends.

puff = smoke.to({
  radius: 120,
  opacity: 0,
  duration: 1.5,
  easeOut: 1,
})

fly = bullet.move({
  x: 400,
  at: puff.progress(0.5),
  duration: 0.8,
  easeIn: 0.2,
})

bullet.move({
  y: 60,
  relative: true,
  at: fly.start,
  duration: 0.8,
})

ride = bullet.follow(arc, {
  at: 3,
  duration: 2,
  orient: true,
})

tag.fade({
  opacity: 1,
  at: ride.progress(0.5),
  duration: 0.2,
})

tag.link({
  x: () => bullet.x,
  y: () => bullet.y + 40,
  until: ride.end,
})

tag.fade({
  opacity: 0,
  at: ride.end,
  duration: 0.2,
})

bullet.morph(Circle, {
  radius: 30,
  at: ride.end,
  duration: 0.6,
})
```

Vocabulary. Items marked "coming" are not built yet.

- **Classes** (D36, D43): `Rect`, `Circle`, `Text`; coming: `Line`, `Polygon`, `Image`, `Group`, `Path`, `Video`, `Camera`, and the 3D shapes. Every visible object is a shape with a kind, which is what lets one object morph into another kind.
- **Attributes.** Common: `x`, `y`, `z`, `rotation`, `scale`, `opacity`, `fill`; coming: `anchor`, `stroke`, `strokeWidth`. Per class: `width`, `height`, `radius`, `text`, `fontSize`, `font`. The registry lists them all with defaults.
- **Verbs** (D37): `move` for x, y, z; `rotate`; `scale`; `resize` for width, height, radius, fontSize; `fade` for opacity; `to` for any attributes. Coming: `follow(path, { ... })`, `morph(Class, { ... })`, `link({ ... })`. The timeline labels and colors clips by verb.
- **Timing keys**, reserved in every action block: `at`, `delay`, `duration`, `until`, `easeIn`, `easeOut`, `ease`, `relative`. `at` takes seconds or a time reference; omitted, it means right after the object's previous action, or 0. `until` is an end time or reference, as an alternative to `duration`.
- **Relative** (D51): `relative: true` makes the block's values changes from wherever the object is when the action starts. A relative action adds on top of whatever else is happening; an absolute one takes over from its start (D53).
- **Visibility** (D52): opacity is the one system. An object with opacity 0 does not exist, is not drawn, not hit, and not sampled. To appear later, the cast sets `opacity: 0` and the script fades it in; the timeline shows every object's opacity as its own lane.
- **Easing** (D39): `easeIn` and `easeOut` are seconds of easing at each end, default 30% of the duration each; `ease: 'linear'` removes them, and named curves such as `bounce`, `elastic`, `back`, `snap` cover what durations cannot express.
- **Time references:** `action.start`, `action.end`, `action.progress(f)`. Coming: object states such as `startsMoving`.
- **Links** (D33): an arrow function. `() => other.attr + number` is an offset link whose number the GUI edits. In the cast a link is permanent; coming: `link({ ... })` in the script runs from `at` to `until`.

## Rules for GUI-editable code

1. An object is a `name = Class({ ... })` at the top level of the file, one attribute per line, in the cast. `const name = ...` is accepted but not written by the app (D48). The GUI edits those literals and adds or removes attribute lines.
2. An action is a top level `name.verb({ ... })` in the script, optionally assigned to a name so other actions can reference its timing. The GUI edits its literals, adds an `at` line when a clip is dragged, and removes the whole statement on delete.
3. GUI-editable values are numbers, strings, arrays of numbers, and color strings. An arrow function of the form `() => other.attribute + number` is an offset link with an editable number. Any other function is code-driven.
4. Everything else is free JavaScript. It runs, it shows, it is not GUI-editable.
5. The GUI replaces the smallest literal span, inserts new objects at the end of the cast and new actions at the end of the script, writes one attribute per line and one point per line, and never reformats existing lines.
6. While the file has an error, the GUI does not edit it (D63): the last good model describes older text.
7. A class action is a top level `all('name').verb({ ... })`, optionally assigned. The GUI edits its literals from the class row only. A member's edit appends the member's own copy of the block after the class statement and edits that; the class statement is left alone.
