# Requirements

Quick Animator is a desktop tool for making motion graphics for video. An animation is a
JavaScript file with a small set of rules on top. The four panes of the app are views of that
code. The goal is ease: an object animating roughly the way you want in under five clicks, and
no step that forces trial and error.

Requirements are numbered so checkpoints and code can cite them. **Core** means required before
the tool is used for real work. **Later** means wanted, scheduled after the core. Items marked
**(proposed)** were decided by Claude with judgment and are open to veto; see `decisions.md`.

## 1. Principles

- **P1. Ease beats granularity.** Tools for granular control already exist. This tool removes friction.
- **P2. Organization of information and intuitive interaction come first.** Every feature is judged on both before anything else.
- **P3. Real time, everywhere.** Any change made anywhere is visible in every pane immediately.
- **P4. Code is the truth.** Every edit made in the GUI is an edit to the code. Nothing that defines the animation lives outside the project files.
- **P5. Agent-generatable.** An agent given the rules document and ordinary JavaScript knowledge can write a complete, valid animation.
- **P6. No bloat.** Nothing is added speculatively. A feature is added only when the basics under it are polished.
- **P7. Perfect the basic interactions before moving on.** Each checkpoint ends with a review of feel, not only of function.

## 2. Scope

**In scope:** 2D and 3D motion graphics for video. Primitives, text, motion paths, groups, timing
relationships, links between objects, reusable components, audio and video on the timeline, export
to video, headless render for agents.

**Out of scope for now:** video editing, 3D model import, photoreal rendering, physics, SVG import,
freehand vector drawing and morphing, text on a path, 3D text, macOS and Linux, an in-app agent.
See `checkpoints.md` for what is scheduled and what is backlog.

## 3. Main window

- **R1.** Five panes in a fixed layout: object pane on the left, preview top center, timeline bottom center, code pane top right, Selected pane bottom right. Splits are resizable. Each pane can be collapsed. The layout persists between runs.
- **R2.** There is no separate property inspector. Properties are edited by direct manipulation in the preview, by dragging in the timeline, and by structured editing in the code pane. (Decision D13.)
- **R3.** One selection is shared by all panes. Selecting in any pane selects in all of them.
- **R4.** An edit in any pane is reflected in every other pane within the same display frame for direct manipulation, and within 100 ms for typed code.
- **R5.** Undo and redo cover every edit from every pane as one history. A drag is one undo step.
- **R6.** Errors in user code never crash or blank the app. The last good state stays visible. The error is shown at its source line, in the gutter, on the overview ruler, and in a status line that jumps to it when clicked (D76). While the code has an error, the preview and timeline do not edit it (D63). Deleting from the preview or timeline never causes such an error: references to the deleted thing are resolved after a confirmation (D72).
- **R7.** Keyboard: space plays and pauses, arrow keys step frames, Delete removes what is highlighted (D73), Ctrl+D duplicates, F2 renames, F1 opens Help, Ctrl+Z and Ctrl+Y undo and redo. The full list is in the Help pane.

## 4. Preview pane

- **R10.** Shows the world with the camera frame drawn at project resolution. Objects exist and move outside the frame. The wheel zooms around the cursor, Shift and the wheel pan sideways, Alt and the wheel pan up and down, the middle button drags, Fit shows the frame, and the zoom readout jumps to 100%. Only what the camera sees is rendered. Transparent areas are distinguishable from black. (D40, D50)
- **R11.** Click selects, Ctrl-click adds or removes, a drag on empty space selects what its box touches, and Ctrl+A selects all (D89). Drag moves the selection. Corner and edge handles resize, a handle above rotates (D86). Snap rounds positions and sizes to a grid and angles to a step, with the grid and the step set in the preview (D91). Shift constrains. Snapping to the frame center and edges is on by default **(proposed)**. Object to object snapping is later.
- **R12.** New objects are placed by choosing a type from an add toolbar and clicking in the preview. The click sets the position. Right-click on empty space in the preview, the timeline rows, or the object pane also adds one (D84).
- **R13.** Shift and drag an object to its destination to create a move: an action from where it was to where it was dropped, starting at the playhead, with the default duration. A plain drag is positional at the playhead time (R15). (Decision D27.)
- **R14.** The selected object's motion path is drawn with editable points and keyframe marks. Dragging a point edits the code.
- **R15.** The preview renders the state at the playhead. Dragging an object edits whatever defines its position at the playhead. Dragging it while one of its actions is selected sets that action's destination instead, measured from the action's start when the action is relative (D70). Scrollbars on both axes show where the view sits in the world (D78).
- **R18.** A selected object has a mode: Transform with every handle, or Move, Rotate, or Resize alone, cycled by clicking the selected object and shown by its handles and a control above the preview (D86). The drag, the Shift-drag that makes an animation, and the destination drag all follow the handle used (D79).
- **R16.** Properties bound to expressions show a link indicator on the handle. Dragging follows the lock, offset, or replace choice (R65).
- **R17.** In 3D, the preview has a free viewport camera for orbiting while editing, separate from the scene camera, draws the scene camera's frustum, and returns to the exact render view in one click. (Core for the 3D checkpoint.)

## 5. Timeline pane

- **R20.** One row per object, nested and collapsible, following the object hierarchy. Each row shows the object's opacity over time as its own lane at the bottom, never covered by clips: where it is above zero the object exists (D52). Audio and video have rows too.
- **R21.** Each action is a clip on its object's row, colored by its kind, labelled with its identifier in a dimmer color and then its kind (D37, D66). Drag to move its start. Drag its edges to change its duration. Drag the ease handles inside its edges to set how long it eases in and out (D39). Click to select the action everywhere.
- **R22.** Keyframes inside an action are marks on the clip and can be dragged.
- **R23.** Relative timing links are drawn as connectors. Moving an action moves everything that depends on it.
- **R35.** Only the ruler moves the playhead; the playhead never draws over the row headers. Dragging a row header reorders the objects, which is the drawing order (D92).
- **R24.** Transport: return to start, play, pause, jump to the end of the content, a loop toggle that is off by default, a snap toggle, scrub, time shown in seconds and frames. Home and End do the same from the keyboard. With snapping on, drags land on whole seconds and on other actions' starts and ends; off, they land exactly (D64). The timeline has no fixed length: the content end is the last action plus the hold, drawn as a marker on the ruler that drags to set the hold; playback stops or loops there, and the export range defaults to it (D41, D54, D59).
- **R29.** Classes: a row per class with the class's actions as clips, its opacity lane with handles (D93), and the members beneath it, folding; then every object follows. A member's clip from a class action is dashed; dragging it, or Override, gives the member its own action that switches the class action off for it, shown red and crossed out (D80). Right-click on a class track adds an action or a fade for every member.
- **R28.** Right-click on empty track space adds an action of a chosen kind at that time, with the object's current values so nothing jumps, or makes the object fade in, pop in, fade out, or pop out there (D52, D62, D71). A horizontal scrollbar under the tracks shows the visible stretch of time (D78).
- **R25.** Over the tracks, the wheel zooms the time axis around the cursor, from minutes per screen down to single frames, opening at one second per tick; Shift and the wheel scroll time; Alt and the wheel scroll the rows. Over the row headers, the wheel scrolls the rows. The view pages forward while playing. Frame stepping from the keyboard. (D50)
- **R27.** Clips that overlap in time stack in lanes within the object's row, so each stays visible and grabbable (D53).
- **R26.** Audio rows show a waveform. Video rows show thumbnails. (Audio and video checkpoint.)

## 6. Object pane

- **R30.** A tree of all objects in the scene by hierarchy, with each object's actions listed under it (D61). Drag to reparent. Drag to reorder, which sets draw order.
- **R34.** Objects are grouped by type, class groups come first with their members beneath, every object folds its actions away, and one button folds or unfolds all (D84).
- **R31.** Relationships are visible: parent and child by nesting, property and timing links by an indicator with a hover list.
- **R32.** Right-click menus on objects, actions, clips, and empty preview space: Jump to code, Rename, Duplicate, Delete, Add here, and later Group, Add effect, and Save as component (D62, D74, D75). Duplicates are numbered copies with their actions; renames reach every reference.
- **R33.** A per-object hide toggle for editing only. It is UI state, not code, and does not affect export **(proposed)**.

## 7. Code pane and Now pane

- **R40.** A JavaScript editor with syntax highlighting, line wrapping, autocompletion of classes, objects, verbs, attributes, timing keys, named curves, and time references with inline documentation, and inline error display. Tab accepts a completion, otherwise indents the line to where it belongs. A class name and Tab expands a full block with every attribute at its default, also after a written `name = `, and Tab then steps through the values (D36, D69). Ctrl+F searches. Other occurrences of the selected text are highlighted. Every color literal shows a swatch that opens a picker (D68).
- **R41.** Organized by default: one file per scene, written as the cast of objects followed by the script of actions in time order (D32); a per-object view that groups an object's declaration with all of its actions; and a project library file for shared functions and components. Every attribute of every object is shown, set ones as code and unset ones as dimmed ghost lines with their defaults, switchable by a preference (D35). Blocks fold. Lines stay short: one attribute per line, one point per line.
- **R42.** Selecting an object tints its declaration and puts a left bar, in each kind's color, on its actions; selecting an action tints the action in its kind's color and puts a left bar on its object (D67). Selecting anything scrolls the code to it (D77). An overview ruler beside the code shows every mark and the error at its place in the whole file, and clicking a mark jumps there (D78). Unset attributes show as dimmed ghost lines that write themselves into the file when clicked, with a Defaults toggle (D35).
- **R43.** Every attribute line edits like a style rule in browser devtools: attribute names and values autocomplete, a number drags, a color opens a picker, an easing name opens a picker, an asset path opens a file picker. This is the enhanced editing that replaces an inspector.
- **R44.** Code edited in the pane applies live. Edits made outside the app, by an agent or another editor, are picked up by file watching and applied live. The playhead and selection survive a reload.
- **R45.** The GUI rewrites code minimally: only the literal that changed. Formatting and comments are preserved.
- **R46.** The Selected pane, below the code pane, shows every attribute of the selection as a literal value at the playhead: what the object is right now, not the code that produces it. It updates while scrubbing and playing. (D42, D60)
- **R47.** Values that are animated or linked at the playhead are marked so, with the action or link named. Display only until keyframes exist; editing then follows D45.
- **R48.** Nothing is imported in a scene file. Every class and helper is already available, and the editor knows them. Plumbing stays behind the scenes unless dev mode is on (D34, D47).

## 8. Objects and properties

- **R50.** Every object belongs to a class with a declared list of attributes, defaults, and verbs (D36). Core classes: Rect, Circle, Line, Polygon, Text, Image, Group, Path **(proposed set)**. Video is added in the audio and video checkpoint. Camera and 3D shapes in the 3D checkpoint. Visible objects are shapes with a kind, so one object can morph into another kind (D43).
- **R51.** Every object has a 3D transform as scalar attributes: `x`, `y`, `z`, rotation, scale, plus opacity and anchor (D33). A 2D object simply leaves `z` and the extra rotation axes at zero.
- **R55.** An object's `class` attribute names the CSS-like classes it belongs to, several at once; every type is a class too. `all('name').verb({ ... })` acts on every member with one statement, and a member's own action with `overrides: name` replaces it for that object (D80). The Classes dialog assigns and creates classes (D88).
- **R52.** An object is identified by its name. The variable name in code is the name. Renaming propagates to every reference. (Decision D23.)
- **R53.** Objects created by loops or functions in code appear in every pane but are marked code-driven. Their values are not GUI-editable; the GUI offers Jump to code instead. (Decision D24.)
- **R54.** A group's transform applies to its children. Groups nest.

## 9. Animation

- **R60.** The unit of animation is an action: a change of one or more attributes of one object, with a start, a duration, and an easing. "This happens, and this is how long it takes." Actions are written with verbs that say what kind of change they are: move, rotate, scale, resize, fade, and the general `to`, later also morph, follow, and link (D37). A block may be relative, so its values are changes from wherever the object is when it starts (D51).
- **R61.** A start is absolute, in seconds, or relative to a state of another object or action: its start, its end, or a fraction of its progress, plus an optional delay. An end is a duration or an `until` time reference.
- **R62.** States exposed for linking, shown in a picker when setting a start: an action starts, ends, reaches a fraction; later, an object starts moving or stops moving **(proposed vocabulary)**.
- **R63.** An action without a start follows the object's previous action. When actions on the same attribute overlap, an absolute one takes over from its start and a relative one adds on top (D53). An action can hold keyframes at times inside it **(proposed model)**.
- **R64.** Easing is a duration at each end of an action: how long it eases in and how long it eases out, dragged as handles on the clip or typed as `easeIn` and `easeOut`. Named curves such as bounce, elastic, back, snap, and linear remain for what durations cannot express (D39).
- **R65.** An attribute can be an expression of other objects' attributes and of time. It is shown as linked. Dragging a linked attribute locks by default, edits the trailing offset when the expression ends in a constant, or replaces the expression with a literal. The choice is offered in the GUI case by case. (Decision D2.) A link can also be an action in the script, running from a start to an `until`, which is how an object attaches to another mid-animation.
- **R66.** Presets for common techniques, such as fade in, slide in, pop, bounce in, and snap in, apply in at most two clicks and produce ordinary actions in code. No hidden magic **(proposed list)**.
- **R67.** Deterministic: a frame is a pure function of time. No hidden state. The same frame renders identically in the preview and in export.
- **R68.** Morph: an object changes kind and dimensions smoothly, such as a circle into a rectangle, as one action with a duration and easing (D43).
- **R69.** Visibility is opacity, and nothing else (D52). An object exists wherever its opacity is above zero and costs nothing where it is not. Fades are fade actions; the timeline shows the result as the opacity lane and offers fade in, pop in, fade out, and pop out at a time. Fading out something never yet visible first makes it visible from the start (D71).

## 10. Paths

- **R70.** Draw a motion path in the preview: click for corners, click and drag for curves. Smoothing and cleanup tools: simplify, straighten, close.
- **R71.** An object follows a path over a duration with easing. Orientation to the path is optional. Checkpoints on the path carry times and are editable in the timeline and the preview.
- **R72.** Path points are editable in the preview and the code. A path is an object and can be followed by several objects.

## 11. Text

- **R80.** Text object: string, font from the system or a web font, size, weight, color, alignment, line height, letter spacing.
- **R81.** Per-character, per-word, and per-line animation with stagger presets.
- **R82.** Later: text on a path, 3D text.

## 12. 3D

- **R90.** One scene graph holds 2D and 3D objects together in the same scene.
- **R91.** The scene camera is an object. Its position, target, and projection blend from flat to perspective are animatable. An isometric preset exists. A 2D scene can transition smoothly into a 3D reveal.
- **R92.** 3D shapes: Box, Plane, Sphere, and extruded Rect and Polygon **(proposed set)**. Simple lighting: unlit by default, with ambient and one directional light available. No model import.

## 13. Audio and video

- **R100.** Audio and video files are imported into the project's assets and appear as timeline rows. They play in sync in the preview.
- **R101.** Each asset is reference only or rendered into the export. Reference is the default.
- **R102.** Video is also a scene object: placed, transformed, animated, trimmed, and played like any other object.
- **R103.** Later: an audio level drives a property.

## 14. Export and headless

- **R110.** Export to a video file through bundled ffmpeg: H.264 mp4 by default, plus H.265 mp4, webm, ProRes 4444 with alpha, and PNG sequence when cheap to add. Presets. Project resolution and frame rate.
- **R111.** A headless command renders a project without opening the UI, through the same renderer, with the same output. It is documented concisely and works the way a user expects on first read.
- **R112.** Export is frame exact and matches the preview.

## 15. Project files and agents

- **R120.** A project is a folder: `project.json`, `scenes/*.js`, `lib/*.js`, `assets/`. Plain text, git friendly. External files are copied into `assets/` on import and referenced by name from a `src` attribute, never imported in code (D44). `project.json` holds width, height, fps (default 60, D65), and hold (D54).
- **R121.** `docs/animation-rules.md` is complete and concise. An agent with that file alone writes valid animations. It is updated as part of every checkpoint.
- **R122.** The app watches the project folder. Agent edits apply live.
- **R123.** User-facing code is JavaScript with no imports. Type definitions ship with the app for autocompletion. The app validates the file against the class registry on load and reports problems inline. (Decisions D16, D34, D36.)

## 16. Performance and reliability

- **R130.** Direct manipulation runs at display refresh rate for scenes up to a few hundred objects. Objects at opacity 0 are not sampled or drawn (D52).
- **R131.** A typed code change reaches the preview within 100 ms.
- **R132.** Playback holds project frame rate for typical scenes and skips frames rather than slowing down.
- **R133.** The app starts in under three seconds and opens a project in under one.

## 17. Acceptance: the five-click test

From the loop checkpoint on, this must hold and must feel good:

1. Choose Rect from the add toolbar and click in the preview. The object exists and its code exists.
2. Shift and drag it to another point (D27). A move action exists in the code and a clip on the timeline.
3. Drag the clip's edge to set how long it takes.
4. Pick an easing on the clip.
5. Tweak the end position by dragging the object in the preview.

Each later checkpoint adds its own scenario here: follow a path, reveal text, time to an audio cue, transition to 3D.
