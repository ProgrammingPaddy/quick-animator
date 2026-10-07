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
- **D50. The wheel zooms, at the cursor, in both the preview and the timeline.** Shift and the wheel pan or scroll sideways; Alt and the wheel pan the preview vertically or scroll the timeline rows; the middle button drags the preview. The timeline opens at one second per tick and has return-to-start and jump-to-end buttons, also on Home and End. (2026-10-07)

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

## Open

None.
