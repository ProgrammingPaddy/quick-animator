# Animation rules

The one file an agent needs to write a Quick Animator animation. Everything here works today
unless marked **coming**. The app validates the file on load and shows errors at their line.

## The project

```
my-animation/
  project.json      { "width": 1920, "height": 1080, "fps": 60, "hold": 0, "background": "#1c1c1c" }
  scenes/main.js    the scene
  assets/           images, audio, video (coming)
  lib/              shared code (coming)
```

Omitted keys take these values. The scene lasts from 0 to the end of its last action plus
`hold`, seconds kept after the last action so the final state stays for export and looping.
`background` is the color inside the frame, behind everything; exports with alpha leave it out.

## The scene file

Plain JavaScript. **Nothing is imported**: every class below is already available. The file has
two parts, in this order:

1. **The cast**: every object, one statement each, one attribute per line.
2. **The script**: what happens, in time order.

Name an object or an action by assigning it. `const` is accepted but not needed.

```js
box = Rect({
  x: -400,
  y: 0,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

slide = box.move({
  x: 400,
  at: 0.5,
  duration: 1.2,
})
```

## Coordinates and units

The origin is the center of the camera frame. `x` grows to the right, `y` grows upward. Units are
pixels at project resolution. `rotation` is in degrees, counterclockwise; a rotate to 720 turns
twice, and a negative angle turns the other way. Time is in seconds. Objects draw in cast order:
a later declaration draws on top of an earlier one.

## Classes and attributes

Every object has these attributes, with these defaults:

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `x`, `y`, `z` | 0 | center position; for text, the center of the text's box |
| `rotation` | 0 | degrees, counterclockwise |
| `scale` | 1 | size multiplier |
| `opacity` | 1 | 0 means the object does not exist; 1 is solid |
| `fill` | `'#ffffff'` | color, as `'#rrggbb'` |
| `class` | `''` | class names separated by spaces, see Classes |

| Class | Own attributes and defaults |
|-------|-----------------------------|
| `Rect` | `width` 200, `height` 120 |
| `Circle` | `radius` 60; `width` and `height`, each twice the radius unless set, for an oval |
| `Text` | `text` `'Text'`, `fontSize` 48, `font` `'Segoe UI'` |
| `Group` | only these: `members` `''`; `x`, `y` 0, how far the group has shifted its members; `rotation` 0 and `scale` 1, how far it has turned and scaled them; `pivotX`, `pivotY`, what its own rotation and scale pivot on, unset the center of the members' box at time zero. See Groups |

An omitted attribute takes its default. An unknown attribute is reported and ignored.

## Visibility is opacity

There is one visibility system. An object exists wherever its opacity is above zero, and nowhere
else: at opacity 0 it is not drawn, not clickable, and costs nothing. To make an object appear
later, give it `opacity: 0` in the cast and fade it in; to remove it, fade it to 0.

```js
dot = Circle({
  x: 0,
  y: -300,
  radius: 50,
  opacity: 0,
})

dot.fade({
  opacity: 1,
  at: 2,
  duration: 0.3,
})
```

An instant appearance is the same fade over one frame, such as `duration: 0.017` at 60 fps; `duration: 0` behaves the same.

## Actions

`object.verb({ ...the attributes that change, ...timing })`. One block per action.

| Verb | Changes |
|------|---------|
| `move` | `x`, `y`, `z` |
| `rotate` | `rotation` |
| `scale` | `scale` |
| `resize` | `width`, `height`, `radius`, `fontSize` |
| `fade` | `opacity` |
| `to` | any attributes |

Timing keys, allowed in every action block:

- `at`: the start, in seconds or a time reference. Omitted: right after the object's previous action, or 0 if there is none.
- `delay`: seconds added to the start, whatever `at` is.
- `duration`: seconds. Omitted: 1.
- `until`: an end time or time reference, instead of `duration`.
- `easeIn`, `easeOut`: seconds of easing at each end. Omitted: 30% of the duration each.
- `ease`: `'linear'`, `'bounce'` (bounces at the end), `'back'` (overshoots at the end), `'elastic'` (springs at the end), or `'snap'` (fast start, settles). Replaces `easeIn` and `easeOut`.
- `relative`: `true` makes the values changes from where the object is when the action starts. Omitted: `false`.
- `overrides`: the name of a class action this action replaces for its object. See Classes.

## Relative and overlapping actions

```js
box.move({
  x: 100,
  relative: true,
  duration: 0.5,
})
```

moves 100 pixels to the right of wherever the box is at that moment. When actions on the same
attribute overlap, an absolute action takes over from its start, blending from wherever the object
is; a relative action adds its change on top of whatever else is happening, whichever started
first. After an action ends, its attribute keeps the value it reached until another action changes
it.

## Time references

Assign an action to a name to refer to its timing: `slide.start`, `slide.end`,
`slide.progress(0.5)` for halfway. A reference must be declared above the line that uses it. A
named class action is one too: `rise.start` is when its first member starts, `rise.end` when the
last finishes, `rise.progress(0.5)` halfway through.

```js
dot.fade({
  opacity: 1,
  at: slide.end,
  duration: 0.3,
})
```

## Classes

`class` names the CSS-like classes an object belongs to, separated by spaces. `all('name')` acts
on every member declared above it, with one statement: one action per member, with the same
block.

```js
left = Circle({
  x: -200,
  class: 'dots',
})

right = Circle({
  x: 200,
  class: 'dots',
})

pulse = all('dots').scale({
  scale: 1.5,
  at: 1,
  duration: 0.5,
})
```

Classes are not exclusive: `class: 'dots accents'` puts an object in two. Every type is a class
too: `all('Rect').fade({ opacity: 0, duration: 1 })` fades every rectangle.

A member replaces a class action for itself with its own action that names it in `overrides`.
The class action is then switched off for that object, and the own action stands in its place:

```js
right.scale({
  scale: 2,
  at: 1,
  duration: 0.5,
  overrides: pulse,
})
```

A member's own action without `overrides`, written after the class statement, instead takes
over from its start while the class action still runs, like any later action (see "Relative and
overlapping actions"). A named class action is a time reference for the members it still drives:
`pulse.end` is when the last of them finishes.

## Groups

A group is an object whose body is other objects. `members` lists them by name: objects, classes
(every member of the class), or other groups. Members keep their own values; the group's own
values and its animations act on top. The group's own `rotation` and `scale` turn and scale the
members around `pivotX, pivotY`, a point in the space the members' own values live in, or, unset,
around the center of the box around them at time zero; its own `x, y` shift them. Each `rotate`
and `scale` then turns or scales the members around the center of their box at the moment that
action begins, and keeps the result; each `move` shifts them. An action too may name the point it
pivots on with `pivotX, pivotY`. The GUI writes these points, in the declaration the first time it
turns or scales a group and in every turn or scale it animates, so that moving a member later never
changes an earlier turn. A group that says nothing changes nothing.

```js
pair = Group({
  members: 'bar1 bar2',
  rotation: 10,
  pivotX: 0,
  pivotY: -400,
})

pair.rotate({
  rotation: 90,
  pivotX: 0,
  pivotY: -400,
  at: 1,
  duration: 1,
})

pair.move({
  x: 200,
  at: 1,
  duration: 1,
})
```

`move`, `rotate`, `scale`, and `to` work on a group as on any object and compose the same way: a
turn and a move at the same time make one motion, the box moving while the members turn around
its center. An object listed by several groups is carried by each in turn, in the order the
groups are declared, and a group listed by another is carried by it. A group has no opacity,
fill, or class of its own; its members keep theirs.

## Links

An attribute can follow another object's attribute with a function: `x: () => box.x + 20`. It is
evaluated at every frame with the other object's animated value. **Coming:** `link` actions with
a start and an end.

## What the GUI can edit

Literal numbers and strings in the cast and in action blocks, and the trailing number of a link.
Anything else, such as loops, helper functions, or computed values, runs and shows, but is marked
"code" and is not editable from the GUI. The app never reformats your lines; it replaces one
literal, adds one line, or removes one statement together with the comment lines directly above
it; a comment set apart by a blank line stays. While the file has an error, the GUI does not
edit it.

## Rendering

`quick-animator render <project>` writes the project as an H.264 mp4 next to it, from the
terminal and without a window; while the app runs from source, `npm run render -- <project>`.
`--preset` picks `h264`, `h265`, `webm`, `prores` (4444, with alpha), or `png` (a sequence,
with alpha); `--out` names the file; `--from` and `--to` take a part, in seconds. The frames are
the ones the app shows, at the project's size and rate, from 0 to the last action's end plus
`hold`. Progress prints on stdout, errors on stderr with exit code 1. See `docs/render.md`.

## Complete example

```js
// Cast: every object, one attribute per line.

box = Rect({
  x: -400,
  y: 0,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

dot = Circle({
  x: 0,
  y: -300,
  radius: 50,
  fill: '#f59e0b',
  opacity: 0,
})

title = Text({
  text: 'Quick Animator',
  x: 0,
  y: 320,
  fontSize: 72,
  fill: '#ffffff',
})

// Script: what happens, in time order.

slide = box.move({
  x: 400,
  at: 0.5,
  duration: 1.2,
})

box.rotate({
  rotation: 360,
  at: slide.progress(0.5),
  duration: 1,
})

dot.fade({
  opacity: 1,
  at: slide.end,
  duration: 0.3,
})

dot.move({
  y: 0,
  duration: 0.8,
  ease: 'bounce',
})

title.fade({
  opacity: 0,
  at: 3,
  duration: 1,
})
```

## Coming

orbits (a turn around a point, as its own verb), `Path` and `follow`, `morph`, `link` actions, group opacity, `Image`, `Video`, `Line`, `Polygon`,
object states such as `startsMoving`, per-character text animation, 3D, export.
