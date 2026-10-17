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

Omitted keys take these values. The content lasts from 0 to the end of its last action or
lifetime; `hold`, seconds kept after that, holds the final frame on screen in playback and export:
an object removed at the content end stays on through the hold.
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
| `opacity` | 1 | 0 is invisible, 1 solid; see Lifetime and visibility |
| `fill` | `'#ffffff'` | color, as `'#rrggbb'` |
| `class` | `''` | class names separated by spaces, see Classes |
| `at` | 0 | when the object begins, in seconds or a time reference; before it the object does not exist |
| `until` | the end | when the object is removed; omitted, it lasts to the end of the content |

| Class | Own attributes and defaults |
|-------|-----------------------------|
| `Rect` | `width` 200, `height` 120 |
| `Circle` | `radius` 60; `width` and `height`, each twice the radius unless set, for an oval |
| `Text` | `text` `'Text'`, `fontSize` 48, `font` `'Segoe UI'` |
| `Group` | only these: `members` `''`; `x`, `y` 0, how far the group has shifted its members; `rotation` 0 and `scale` 1, how far it has turned and scaled them; `pivotX`, `pivotY`, what its own rotation and scale pivot on, unset the center of the members' box at time zero. See Groups |

An omitted attribute takes its default. An unknown attribute is reported and ignored.

## Lifetime and visibility

An object exists from `at` until `until`, both in seconds or time references, and nowhere else:
outside its life it is not drawn, not solid, and costs nothing. `at` is 0 when omitted and
`until` the end of the content. Within its life, opacity is how it looks: an object exists while
invisible at opacity 0, and a fade is a fade. An action outside the object's life does nothing
and is reported. `box.start` and `box.end` are time references to when the object begins and when
it is removed; without `until`, `box.end` is when its last action ends. An `until` at the very end
of the content is the same as none: the object stays on through the hold.

```js
title = Text({
  text: 'Hello',
  at: 1,
  until: 4,
})
```

To make an object appear or vanish within its life, change its opacity: give it `opacity: 0` in
the cast and fade it in, or fade it to 0.

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
| `resize` | `width`, `height`, `radius`, `fontSize`; or `scale`, a multiplier of the drawn size, which is how a group grows or shrinks |
| `fade` | `opacity` |
| `path` | `x`, `y`, and with `orient` `rotation`, along a `shape`; see Paths |
| `to` | any attributes |

Timing keys, allowed in every action block:

- `at`: the start, in seconds or a time reference. Omitted: right after the object's previous action, or when the object begins if there is none.
- `delay`: seconds added to the start, whatever `at` is.
- `duration`: seconds. Omitted: 1.
- `until`: an end time or time reference, instead of `duration`.
- `easeIn`, `easeOut`: seconds of easing at each end. Omitted: 30% of the duration each.
- `ease`: `'linear'`, `'bounce'` (bounces at the end), `'back'` (overshoots at the end), `'elastic'` (springs at the end), or `'snap'` (fast start, settles); or a function of the progress, `(p) => p * p`, giving the eased progress, 0 to 1. Replaces `easeIn` and `easeOut`.
- `relative`: `true` makes the values changes from where the object is when the action starts. Omitted: `false`.
- `overrides`: the name of a class action this action replaces for its object. See Classes.

## Paths

`path` takes an object along a shape over time, with the usual timing and easing: the shape says
where the object is at each point of the way, the timing and easing how fast it gets there.
`shape` is a list of points, `[[x, y], ...]`, traveled by distance, or a function of the
progress, `(p) => [x, y]`, evaluated every frame with `p` from 0 to 1, for a shape from a formula.
Points are in the scene's space. `smooth: true` makes the path a curve through its points
instead of straight lines between them; the curve is the same however long the path takes.
`orient: true` turns the object to face along the shape; `offset: [dx, dy]` shifts the whole
shape; `relative: true` makes the points changes from where the object is, added on top of
whatever else moves it, so a shape that begins at `[0, 0]` starts in place. A `move` written as
relative during a path offsets the object from the path; one written after the path, above it,
takes the object over for its span, and the path has it back after. The GUI writes one point per
line and edits the points one by one; a function is code.

```js
dot.path({
  shape: [
    [-300, 0],
    [0, 200],
    [300, 0],
  ],
  at: 1,
  duration: 2,
  smooth: true,
  orient: true,
})

moon.path({
  shape: (p) => [Math.cos(p * 2 * Math.PI) * 200, Math.sin(p * 2 * Math.PI) * 200],
  duration: 4,
  ease: 'linear',
})
```

## Relative and overlapping actions

```js
box.move({
  x: 100,
  relative: true,
  duration: 0.5,
})
```

moves 100 pixels to the right of wherever the box is at that moment. Actions on one attribute
stack in the order they are written: a later one is on top. Of the absolute actions running at a
moment, the top one has the say; when it ends, the ones below show through again, as if it had
never run; with none running, the one that ended last holds the value it reached. An absolute
action starts from where the actions below it leave the object as it begins. A relative action
adds its change on top of all that, whichever started first. In the timeline, overlapping
animations stack the same way, the top one highest; drag one up or down to change the order.

## Time references

Assign an action to a name to refer to its timing: `slide.start`, `slide.end`,
`slide.progress(0.5)` for halfway. A reference may name an object or action declared further
down the file; the times are worked out once the whole file has run. Anything else about a name,
calling it or reading a value from it, needs the declaration above. A
named class action is one too: `rise.start` is when its first member starts, `rise.end` when the
last finishes, `rise.progress(0.5)` halfway through.

```js
dot.fade({
  opacity: 1,
  at: slide.end,
  duration: 0.3,
})
```

## States

What an object is doing is a time reference too, worked out from its animations frame by frame
once the whole file has run: `box.moving.start` and `box.moving.end` are when it first starts
and stops moving; `box.moving[2].end` is when its second stretch of movement ends and
`box.moving.last.end` its last; `box.moving.progress(0.5)` is halfway through the first.
`moving` has `left`, `right`, `up`, and `down`: `box.moving.right.end`. The other states are
`still`, `turning` with `clockwise` and `counterclockwise`, `growing` and `shrinking` by the
drawn size, `visible` and `hidden` by the opacity, and `fadingIn` and `fadingOut`. Stretches are
counted from 1. A state that never happens is an error at the line, and so is an animation of
an object that waits on that object's own state.

```js
dot.fade({
  opacity: 1,
  at: box.moving.end,
  until: box.moving[2].start,
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

pulse = all('dots').resize({
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
right.resize({
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
and `resize` then turns or scales the members around the center of their box at the moment that
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

`move`, `rotate`, `resize`, and `to` work on a group as on any object and compose the same way: a
turn and a move at the same time make one motion, the box moving while the members turn around
its center. An object listed by several groups is carried by each in turn, in the order the
groups are declared, and a group listed by another is carried by it. A group's `opacity`
multiplies every member's, so `fade` on a group fades them as one; it has no fill or class of
its own, and its members keep theirs.

## Links

An attribute can follow another object's attribute with a function: `x: () => box.x + 20`. It is
evaluated at every frame with the other object's animated value. The GUI shows every link, a time
reference or a value link, as a small chain mark on the clip and the row, with the words beside it
on the clip, and marks what is referred to. Right-click an animation or an object for Edit links,
a searchable list of the objects, groups, classes, and animations, each opening to what it offers;
picking one writes a time reference or a value link, `() => box.x`, and names the target if it has
no name. The Selected pane takes code in any field and shows what a link comes to. **Coming:** `link` actions with a start and an end.

## What the GUI can edit

Literal numbers and strings in the cast and in action blocks, the points of a path's shape, and
the trailing number of a link.
Anything else, such as loops, helper functions, or computed values, runs and shows, but is marked
"code" and is not editable from the GUI. The app never reformats your lines; it replaces one
literal, adds one line, or removes one statement together with the comment lines directly above
it; a comment set apart by a blank line stays. While the file has an error, the GUI does not
edit it. Edge snapping and collision are editing aids for drags in the preview; nothing of them is
in the file; pushing moves only what a drag actually touches. An animation written or retimed from the GUI widens its object's life to hold it,
`at` earlier or `until` later, never the other way; a new object from the GUI begins at the
playhead and lasts as long as the app's preferences say. Deleting an object's last fade from the
GUI also removes the `opacity` written in its declaration, so it is back at 1. The Object tool
and the Add menus write a declaration with the kind's starting attributes, at the playhead; the
Path tool writes a path, one point per line, and moves its points as the drags say.

## Rendering

`quick-animator render <project>` writes the project as an H.264 mp4 next to it, from the
terminal and without a window; while the app runs from source, `npm run render -- <project>`.
`--preset` picks `h264`, `h265`, `webm`, `prores` (4444, with alpha), or `png` (a sequence,
with alpha); `--quality` 1 to 100 for the compressed formats, default 75; `--out` names the file;
`--from` and `--to` take a part, in seconds. The frames are
the ones the app shows, at the project's size and rate, from 0 to the end of the content plus
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

orbits (a turn around a point, as its own verb), objects attached to another's path, the motion of a drag kept as a path, curved paths, `morph`, `link` actions, `Image`, `Video`, `Line`, `Polygon`,
object states such as `startsMoving`, per-character text animation, 3D.
