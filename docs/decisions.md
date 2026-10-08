# Decisions

Every functional decision, who made it, and its status.
**Confirmed**: the owner decided, or accepted a proposal. **Proposed**: Claude decided with judgment, and the owner can veto.
**Open**: not decided, and nothing that depends on it is built.

## Confirmed by the owner

- **D1. Code is the source of truth.** Every GUI edit is a rewrite of the code. Nothing that defines the animation lives outside the project files. (2026-10-06)
- **D2. Dragging a property bound to an expression** locks the handle by default and offers break link. When the expression ends in a constant offset, the offset is edited in place. The GUI offers the choice case by case. (2026-10-06)
- **D3. The animation model is time indexed.** An action has a start, a duration, and an easing: "this happens, and this is how long it takes." There is no sequential style where times are implied by the order of statements. (2026-10-06)
- **D4. Desktop app, Windows 11 only** for now. Other platforms are out of scope. A headless render mode is included and must be concisely documented and intuitive. (2026-10-06)
- **D5. Export priority is a high quality video file.** Other formats are added only when cheap. An adjustable format is preferred. (2026-10-06)
- **D6. Audio and video are reference by default and can be rendered.** Video placed in the scene is an object that can be animated and played. Audio levels driving properties comes later. (2026-10-06)
- **D7. Full 3D for motion graphics, without overcomplication.** 2D and 3D coexist in one scene. Most work is 2D with smooth transitions into 3D, such as an isometric reveal. No model import. Not photoreal. (2026-10-06)
- **D8. Modular means groups, interactions, and relationships can be saved and reused.** Kept intuitive. (2026-10-06)
- **D9. All link kinds are core:** parenting, property links, timing links, and state links. The key is exposing object states clearly so actions can be tied to them, such as a bullet that moves once a smoke animation is half done. (2026-10-06)
- **D10. Primitives and motion paths first.** Vector drawing, SVG import, and morphing of imported shapes come after the core. Paths and path cleanup must be right. (2026-10-06)
- **D11. Text core is basic text plus per-character, per-word, and per-line animation.** Text on a path and 3D text later. (2026-10-06)
- **D12. Code pane organization:** one file per scene, a per-object view that groups an object with its actions, a project library file. Selecting an object brings its code into view by highlight and expansion, not by forced scrolling. Jump to code is explicit, from a right-click menu. Moving between an object and its actions must be one step each way. See D32 for the file order. (2026-10-06, 2026-10-07)
- **D13. No separate property inspector for editing definitions.** The code pane gets enhanced editing and organization instead. The Now pane (D42) shows evaluated values, which is a different thing. (2026-10-06, 2026-10-07)
- **D14. Fixed layout** with resizable splits and collapsible panes. No docking. Objects left, preview top center, timeline bottom center, code right, with the Now pane below it (D42). (2026-10-06)
- **D15. The agent is external.** Any animation is valid JavaScript. An agent that has the rules document writes animations with its existing knowledge of code. (2026-10-06)
- **D17. The audience is the owner** until everything is perfected. Distribution later. (2026-10-06)
- **D27. The motion gesture.** Shift makes it a timed move: shift and drag an object to its destination, and a move action is created from where it was to where it was dropped, starting at the playhead, with the default duration (D31). A plain drag is positional at that point in time: it changes the base position when no action covers the playhead, and the covering action's target values otherwise (R15). Shift and click without dragging does nothing for now. (2026-10-06, 2026-10-07)
- **D31. The default duration of a new move is 1 second.** May be tuned later. (2026-10-07)
- **D32. File order is cast, then script.** A scene file declares every object first, then the actions in time order, like a screenplay. The per-object organization of the code pane (D12) is a view on top of the file, not the file order. (2026-10-07)
- **D33. Attribute blocks.** Every object and every action is one block with one attribute per line, like a CSS rule. Positions are the scalar attributes `x`, `y`, `z`. A link is an arrow function whose body is another object's attribute plus or minus a number, and that number is the editable offset. (2026-10-07)
- **D34. Nothing is imported.** Every class and helper is already available in a scene file, and there is no wrapper. Plumbing stays behind the scenes; a dev mode shows what the app derived. (2026-10-07)
- **D40. The preview shows the world, not only the output.** The camera frame is drawn; objects exist outside it; zoom and pan are free. Only what the scene camera sees is rendered. In 3D the scene camera is an object and the preview can orbit a separate viewport camera. (2026-10-07)
- **D41. The timeline has no fixed length.** The content end is derived from the scene. The time axis zooms and scrolls freely. (2026-10-07)
- **D42. The Now pane.** A fifth pane, below the code pane, shows every attribute of the selection as a literal value at the playhead. (2026-10-07)
- **D48. Objects are named by plain assignment**, `smoke = Circle({ ... })`. `const` is accepted but never written by the app, because it is noise to a non-developer. (2026-10-07)
- **D50. The wheel zooms, at the cursor, in both the preview and the timeline.** Shift and the wheel pan or scroll sideways; Alt and the wheel pan the preview vertically or scroll the timeline rows; the middle button drags the preview. Over the timeline's row headers the wheel scrolls the rows. The timeline opens at one second per tick and has return-to-start and jump-to-end buttons, also on Home and End. (2026-10-07)
- **D59. Looping is a toggle in the transport, off by default.** Playback stops at the content end; playing from the end starts over. (2026-10-07)
- **D60. The values pane is called Selected**, not Now. (2026-10-07)
- **D61. The object pane lists each object's actions under it.** Standalone items such as paths will list on their own when they exist. (2026-10-07)
- **D62. Right-click menus** on objects, clips, and empty preview space, starting with jump to code, delete, and add here. (2026-10-07)
- **D63. GUI edits are refused while the code has an error**, because the last good model describes older text and its positions cannot be trusted. The error bar says so. (2026-10-07)

## Proposed by Claude and accepted by the owner, 2026-10-06

- **D16. User files are JavaScript. The app is TypeScript.** Type definitions ship with the app so the editor gives autocompletion and inline docs, and the user never writes a type. The app validates files on load.
- **D18. Electron with Vite and React.** One known Chromium for consistent rendering, Node in process for file watching and ffmpeg, the same renderer for headless export, and the stack agents know best. Tauri was considered and set aside for those reasons.
- **D19. CodeMirror 6 for the code pane.** It supports inline widgets on literals, which D13 depends on, and it is light. Monaco was set aside as heavier and harder to extend inline.
- **D20. One Three.js renderer for 2D and 3D.** Required by D7. CP1 verifies 2D edge and text quality and keeps Canvas2D rendered to texture as the fallback for 2D content.
- **D21. Coordinates:** origin at the camera frame center, y up, pixel units at project resolution, rotation in degrees. Time is seconds in code and frames in the timeline. Up is up, and it matches 3D.
- **D22. The undo history is the code text history.** A GUI gesture is one grouped edit. Undo restores the text and everything re-derives.
- **D23. The variable name is the object's name.** Rename is an AST aware rename of the identifier.
- **D24. GUI-editable code is a constrained subset:** top level declarations and actions with literal values. Everything else is free JavaScript, shown as code-driven and not GUI-editable. The rules are listed in `architecture.md`.
- **D25. Export through bundled ffmpeg** from frames captured by the same renderer. Headless mode is a hidden window of the same app.
- **D26. Export comes right after the loop checkpoint**, before timing and paths, so the tool is usable for real work early and agents can render and inspect their output.
- **D28. The object pane and the timeline stay separate panes for now.** Aligning the timeline rows with the object tree as one panel is revisited after CP1 is used by hand.
- **D29. Dependency policy:** small, maintained libraries for plumbing; no UI kits; nothing for the timeline, path editing, or direct manipulation, which are built and perfected here.
- **D30. CP0 ships no content security policy** in the renderer. CP1 decides how user code is sandboxed, which sets the policy.

## Proposed by Claude, awaiting the owner, 2026-10-07

Adopted provisionally for CP1 on 2026-10-07, when the owner asked to start building so the
gestures could be judged by hand. Each one is still open to veto.

- **D49. After a shift-drag, the playhead moves to the end of the new move.** The object is then seen at its destination, and the next shift-drag chains from there, so a sequence of moves is a sequence of shift-drags.
- **D35. Complete view, minimal file.** The file holds only the attributes the author set. The code pane shows every attribute of every object, the unset ones as dimmed ghost lines with their defaults; editing a ghost line writes it into the file. A preference switches between all attributes and set attributes only. The alternative, writing every attribute into the file, makes files long and agent output verbose, and was set aside.
- **D36. One class registry.** Every object type is a class with a schema of attributes, defaults, ranges, docs, and verbs. The registry drives autocompletion, Tab expansion of a full block, validation, ghost defaults, the Now pane, and the reference section of the rules document, so they can never disagree.
- **D37. Verbs.** Actions are written with verbs that say what kind of change they are: `move`, `rotate`, `scale`, `resize`, `fade`, `follow`, `morph`, `link`, `appear`, `disappear`, and the general `to`. Each is the same block form. The timeline labels and colors clips by verb. The alternative, one generic verb with the timeline inferring the kind, keeps the API smaller but reads worse.
- **D38. Lifetime as actions.** `appear({ at, fadeIn })` and `disappear({ at, fadeOut })` set when an object exists and how it fades, in the script where time lives. The timeline shows a lifetime bar per object with fade handles, like clip fades in a video editor. Without them an object exists from 0 to the end.
- **D39. Easing as durations.** `easeIn` and `easeOut` are seconds of easing at each end of an action, default 30% of the duration each, dragged as handles inside the clip edges. Named curves stay for shapes a duration cannot express: bounce, elastic, back, snap, linear.
- **D43. Shapes with a kind, and morph.** Every visible object is a shape whose kind is circle, rect, polygon, and so on; `Circle({ ... })` is the short way to make one. `morph(Class, { ... })` tweens the outline and dimensions from one kind to another as one action.
- **D44. Assets by name.** External files are copied into `assets/` on import, by drag and drop or a menu, and referenced from a `src` attribute by file name. Nothing is imported in code. Fonts come from `assets/fonts` or the system.
- **D45. The Now pane is display only until keyframes exist (CP3).** Editing a value there then changes the base value when no action covers the playhead, and inserts or adjusts a keyframe otherwise.
- **D46. Objects are written `Circle({ ... })`, without `new`.** In JavaScript a typed object with attributes is a call with an object literal; the parentheses are the price of a real class behind each object. `new Circle({ ... })` would be equally valid and is the alternative if it reads better.
- **D47. Dev mode** shows the resolved time of every action, the names of code-driven objects, evaluation time, and raw errors. It never changes the file.

## Confirmed by the owner after the first hands-on review, 2026-10-07

- **D51. Relative values.** Every action block accepts `relative: true`, meaning its attribute values are changes from wherever the object is when the action starts: `box.move({ x: 100, relative: true })` moves 100 to the right. The default is absolute. Clips and the object pane mark relative actions.
- **D52. One visibility system: opacity.** `appear`, `disappear`, `fadeIn`, and `fadeOut` are gone. An object exists wherever its opacity is above zero. It must be performant: an object at opacity 0 is not sampled, drawn, or hit. Every timeline row shows the object's opacity as its own lane, never covered by clips, and the GUI must offer click-and-drag control of it there; the first controls are right-click to appear or disappear at a time, which write a base opacity of 0 and a fade, and the fades themselves as clips. The exact drag controls are to be tested.
- **D53. Overlapping actions on the same attribute.** An absolute action takes over from its start, blending from wherever the object is at that moment. A relative action adds its change on top of whatever else is happening. Overlapping clips stack in lanes.
- **D54. A hold after the content.** `project.json` has `hold`, in seconds, added after the last action when computing the content end, so the final state stays for export and looping. Default 0. Drawn as a marker on the ruler that drags.
- **D55. A Help pane** showing the rules document and the shortcuts inside the app. Agreed; not built yet.
- **D56. An Effects pane** under the object list, with presets that drag onto an object or a timeline row, also offered in the right-click menus. Agreed; belongs with the presets of CP3.
- **D64. Snapping is a timeline toggle.** On, drags snap to whole seconds and to the starts and ends of other actions. Off, placement is exact to the millisecond. Frame snapping of drags is gone; the playhead still steps by frames. This replaces the earlier D58 proposal.
- **D65. Projects default to 60 fps**, as a project setting.
- **D66. Selecting an action** in the timeline or the object pane marks it everywhere: the clip, the row in the object pane, and its code. Clips show the action's identifier, when it has one, in a dimmer color before its kind.
- **D67. Code marks follow the colors of the UI.** The selected thing is tinted across its lines; what relates to it gets a left bar, not a tint. An object is blue; each kind of action has its own color, the same in the timeline, the object pane, and the code.
- **D68. The code pane borrows from VS Code where it helps:** a color swatch before every color literal that opens a picker, search, and highlighting of other occurrences of the selection.
- **D69. Completion knows a written name.** After `box2 = `, the class expands without adding a name.

## Confirmed by the owner after the third review, 2026-10-07

- **D70. A drag with an action selected sets that action's destination.** If the selected action changes x or y, dragging its object in the preview writes the end position, and the playhead moves to the action's end so the result is seen. For a relative action the written change is measured from where the object is when the action starts. The same rule will apply to keyframes.
- **D71. Fading out something that was never visible makes it visible first.** A fade out at a time where the object has opacity 0 sets the base opacity to 1, so the object exists until it fades. Pop in and pop out, fades with a duration of 0, sit beside fade in and fade out in the menu.
- **D72. Deleting what other code refers to asks first.** A dialog lists every reference. On confirm, a time reference such as `at: slide.end` becomes the time it resolves to now, so nothing moves, and a link falls back to the attribute's default. Deleting through the code pane is a code edit and shows the error as before.
- **D73. Delete removes exactly what is highlighted:** the selected action, or else the selected object with its actions.
- **D74. Duplicate copies an object with its actions.** Copies are numbered, `box` to `box2`, and a named action `slide` becomes `slide2`; references inside the copy point at the copy. Ctrl+D and the right-click menu.
- **D75. Rename from any pane renames every reference** in the code, by token, so strings and comments are left alone. An unnamed action can be given a name the same way. F2 and the right-click menu.
- **D76. Errors are reachable.** The error line is marked in the gutter and on the overview ruler, and clicking the message jumps to it. A "not defined" error points at the first use of the missing name.
- **D77. Selecting anything scrolls the code to it.** Supersedes the highlight-only rule in D12; the per-object grouping of D12 stands.
- **D78. Scrollbars.** Native scrollbars are themed. The code pane has an overview ruler of marks and the error, like VS Code's, without a minimap. The timeline has a horizontal scrollbar and the preview has two.
- **D35 and D55 are built:** ghost default lines, clickable, with a Defaults toggle in the code pane; the Help pane on F1 and the ? button.

## Confirmed by the owner after the fourth review, 2026-10-07

- **D79. Drag modes.** A selected object has a drag mode: move, rotate, or scale. Clicking the selected object cycles the mode; a segmented control above the preview shows and sets it; the selection outline changes with it (a box, a ring, corner handles). A plain drag applies the mode at the playhead, Shift-drag makes it an animation (`move`, `rotate`, or `scale` from the playhead), and a drag while a matching action is selected sets that action's destination, relative or absolute, under the same rules as D70. Rotation drags measure the angle around the object's center, counterclockwise positive; scale drags the distance from it.
- **D80. Classes, revised after the fifth review.** An object's `class` attribute holds space-separated names, like CSS classes; classes are not exclusive, and every type is a class too, so `all('Rect')` is every rectangle. `all('name').verb({ ... })` is one statement that makes one action per member declared above it; it is written once, reads once, and shows once. Classes are hierarchical to objects: a class action applies to every member that does not override it, and an object's own action with `overrides: name` replaces the class action for that object, switching it off there. The timeline has a row per class with the class's clips and its opacity lane, and the members beneath it, folding; then every object follows, so objects are listed in all their places (the object pane groups by class and by type the same way). Member rows show the class's actions as dashed clips; an overridden one is red and crossed out, next to the object's own override. Dragging a dashed clip, or choosing Override, writes the override: the class action is named if it has no name, and the member gets a copy of its block with `overrides: name`. "Copy as own action" instead adds a standalone copy that stacks on the class action (D53). Right-click also offers removing the object from the class, or deleting the action for every member. Classes are set in code or from the Classes dialog (D88).
- **D81. Copy and paste are Ctrl+C and Ctrl+V everywhere outside the editor.** Copying takes the selected action, or else the selected object with its own actions, as code, and puts the text on the system clipboard too. Pasting an object makes a numbered copy (D74); pasting an action appends it to the selected object, or to its own when nothing else is selected, at the same time. Ctrl+D remains duplicate.
- **D82. The preview's scrollable area is stable.** It is the camera frame with a frame's width and height around it, grown by what objects occupy and never by the view, so scrolling cannot change the scale of the bar.
- **D83. Opacity lane controls, prototype for testing.** Every fade has a handle at its start, dragging sideways to slide it in time, and at its end, dragging sideways for its length and up or down for the opacity it reaches. A double-click on the lane makes the object disappear there, or appear there when it is not visible. To be judged by hand before it is final.
- **D84. Objects are grouped by type**, in registry order (Rect, Circle, Text), in the object pane and the timeline. Each object folds its actions away; one button folds or unfolds everything. Right-click on empty space in the timeline rows or the object pane adds an object at the frame center.

## Confirmed by the owner after the fifth review, 2026-10-08

- **D85. Preview scrollbars set the view's edge directly.** Dragging a thumb or clicking the track puts the view's left or top edge at that place in the area. The earlier version panned by an offset from a stale view, which ran away to the ends.
- **D86. The selection gizmo, revised after the sixth review.** Modes are Transform, Move, Rotate, and Resize; Transform is the default and shows every handle: the body moves, corner handles resize both sides freely, edge handles resize one side, and a handle above the top edge rotates. Alt while dragging a corner keeps the proportions. Resizing always keeps the far side in place, so the center moves, in every flavor: a plain drag, a Shift-drag (which writes a `to` action with the size and the position), and a destination drag. The single modes show one kind of handle; in Rotate the whole body turns. Clicking the selected object cycles the modes. Dimensions are what change: width and height, radius, or font size, never `scale`. Shift is never anything but "make this an animation" on a preview drag.
- **D87. Toolbar buttons never reach the canvas.** A click on an add or mode button is only a click on the button; clicking the active add button again puts it away.
- **D88. The Classes dialog** lists every class with a checkbox, mixed when some of the selected objects have it, and a field with a Create button for a new one. Creating a name that exists shakes the button red, says so, and ticks the existing class; a type name is refused the same way, since every object of a type is already in it.
- **D89. Selection, revised.** A drag on empty space selects every object its box touches; Ctrl extends. Ctrl-click adds or removes an object; Ctrl+A selects all. Every drag works on the whole selection as one group (D96). Delete, Duplicate, Classes, and copy take the whole selection.
- **D90. Selection is part of the undo history.** Every change of selection from the panes is a step; an edit that changes the selection carries it in the same step, so undo restores what was selected with what was edited. Inside the code editor, Ctrl+Z skips selection-only steps so it always changes text.
- **D91. Preview snapping.** A Snap toggle above the preview, off by default, rounds dragged positions and sizes to a grid and angles to a step; the grid in pixels and the step in degrees are set beside it and remembered.
- **D92. Timeline.** Only the ruler moves the playhead; clicking a row header selects its object, and clicking empty track space selects nothing, so the arrow keys scrub again. The playhead never draws over the row headers or outside the visible range. Dragging a row header up or down reorders the objects by moving their declarations, which is also the drawing order, later on top; the drop line spans the row where the drop lands. Rows follow the class tree (D99).
- **D93. Classes have an opacity lane** showing what the class's fades do to every member, with the same handles as an object's lane, editing the class statement for every member; a double-click fades all members in or out there.

## Confirmed by the owner after the sixth review, 2026-10-08

- **D94. Selection drawn to be seen.** Outlines are a white line with a dark rim, handles white squares with a dark rim, always drawn above everything, so a blue object on a blue background still shows its selection. The outline follows the object's shape box; a circle gets the box its handles need. (Circles were also drawn at twice their written radius, which hid their gizmo inside the shape; a circle now draws at its radius.)
- **D95. Arrow keys act on the selection.** With actions selected, Left and Right move them by one frame. With objects selected, the arrows move them by one pixel at the playhead. With nothing selected, Left and Right step the playhead by a frame, ten with Shift.
- **D96. Group transforms.** Several selected objects transform as one: the gizmo is the box around them, the body moves them together, the rotate handle turns them around the box's center (positions orbit and each rotation turns), and the resize handles scale their positions and sizes from the far side. Shift makes each object its own animation of the same change.
- **D97. Several actions at once.** Ctrl-click picks several actions in the timeline or the object pane. Dragging one moves or resizes all of them by the same amount; a duration never drops under one frame. Shift and the wheel over a selected object in the preview lengthen or shorten the selected actions by a number of frames set in the transport bar. Delete removes them all in one step.
- **D98. The object pane and the timeline fold independently.** Each has its own folded set; sorting differs too: the object pane groups by class and by type with every object in all its places, the timeline shows each object once.
- **D99. The timeline is a tree.** A class nests under the smallest class that holds all its members, an object sits under the smallest class it belongs to, and objects in no class follow. Nothing appears twice.
- **D100. One naming scheme.** A class action is shown as its class, then its name if any, then its verb, the same on the class row, on every member, in the object pane, and on an override, which adds a red mark. Timeline menus read "Add" and the kind in its color, without a time.
- **D101. Number fields** have their own up and down buttons in the app's style; the snap grid, the snap angle, and the wheel step use them.

## Confirmed by the owner after the seventh review, 2026-10-08

- **D102. Drags write end states directly.** The division by progress is gone. A drag edits whatever defines the value at the playhead: a declaration directly; a running action gets the dragged value as its end state, that action is selected, and the playhead moves to its end so the end state being written is what the preview shows. With an action already selected, the same: its end state, shown at its end. Adjusting a duration never redraws to keep an end state; the preview shows the state at the playhead.
- **D103. Starts at playhead or Ends at playhead.** A toggle beside the modes says where a Shift-drag's animation sits: starting at the playhead and lasting a second, or ending at the playhead and starting a second earlier. During a Shift gesture that starts here, the playhead shows the animation's end, Shift and the wheel set its length with the playhead following the end, and releasing Shift returns the playhead to where it was. With To here, the end is pinned, the wheel moves the start, and the playhead never moves. The same toggle says which end the wheel moves on any selected action.
- **D104. Edge or Center.** A toggle beside the modes says what a resize keeps in place: the far side (the default) or the center. It applies to every resize, plain, Shift, or on a selected action. A selected `resize` asked to move its object as well becomes a `to`, since only `to` changes both the size and the position.
- **D105. Rotation counts turns and keeps direction.** A rotate drag adds up as the pointer goes around, so a full turn and more writes 360 and beyond, and the sign is the direction the pointer took: counterclockwise positive. No separate direction attribute: a signed angle already says both how far and which way, and in 3D each axis will carry its own signed angle.
- **D106. Circles are ovals when asked.** A Circle has `width` and `height`, each twice the `radius` unless set; the GUI writes width and height, so pulling one side makes an oval and Alt keeps the proportions. Derived attributes stay out of ghost lines and snippets.
- **D107. Twins in the timeline.** An object in two classes that do not nest appears under both, marked with a badge naming the other place; selecting one highlights both. Nothing else is listed twice.
- **D86 note.** Keeping the proportions follows the pointer along the diagonal from the anchor, which never flips between axes; handle hit areas are larger than the drawn squares.

## Confirmed by the owner after the eighth review, 2026-10-08

- **D108. The app owns the top of the window.** There is no system menu, so Alt does nothing, and the system title bar is gone; one slim bar of the app's own is the window's top: Open, New, Undo, Redo, and Help on the left, the app and project names in the middle, the system's window controls on the right. It drags the window.
- **D109. Menus fold the fades.** The timeline's Add list has one fade entry; hovering it opens Fade in, Pop in, Fade out, and Pop out beside it, and clicking the entry itself adds a plain fade.
- **D110. One frame is the shortest animation.** Durations never drop under a frame, and a pop is a one-frame fade: a jump from the start state to the end state. A one-frame duration is written a touch under the frame's length, 0.0166 at 60 fps, so its end lands on the next frame and never between two, where it would show two frames of change. Code may still say `duration: 0`; it behaves the same.
- **D111. The wheel.** Shift and the wheel lengthen or shorten the selected actions, anywhere in the preview or the timeline, and do nothing else; Shift never scrolls. Alt and the wheel scroll the timeline's rows and do nothing in the preview. Ctrl and the wheel, or a sideways wheel, scroll time in the timeline; a sideways wheel pans the preview. The plain wheel zooms both.
- **D112. A pivot.** In the Transform and Rotate modes a thin x, drawn above everything, marks the center rotations turn around, at the selection's center until moved. Grabbing it does nothing special: a drag from the center moves the object. A double-click on the x arms it, turning it blue; it can then be dragged, and the selection turns around the moved x, positions included. A click elsewhere disarms it. The pivot is forgotten when the selection changes and is never written to code.
- **D113. Keeping proportions shows.** While Alt is held, or a proportional drag runs, a chip beside the modes says so.
- **D114. Ghost lines for actions.** An action block shows its unset timing as ghost lines, with the values it runs with: its start, delay, duration, easing, and relativity. Clicking one writes it.
- **D115. Cut.** Ctrl+X, and Cut in a clip's menu, copy the selected actions, or objects, and delete them.

## Confirmed by the owner after the ninth review, 2026-10-08

- **D116. A group's box turns with the group.** The box around several selected objects keeps the group's own axes: a rotate drag turns the box along with the objects, and it stays turned, as the tightest box with those axes, until the selection changes. Its resize handles work in the turned axes.
- **D117. CP1 closed.** The owner closed the loop checkpoint after the ninth review. The agent test and the drag strategy that avoids a full re-evaluate per frame move to the start of CP2.

## Open

None.
