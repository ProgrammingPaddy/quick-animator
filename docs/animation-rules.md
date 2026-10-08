# Animation rules

The one file an agent needs to write a Quick Animator animation. Everything here works today
unless marked **coming**. The app validates the file on load and shows errors at their line.

## The project

```
my-animation/
  project.json      { "width": 1920, "height": 1080, "fps": 60, "hold": 0 }
  scenes/main.js    the scene
  assets/           images, audio, video (coming)
  lib/              shared code (coming)
```

`hold` is seconds kept after the last action, so the final state stays for export and looping.

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
pixels at project resolution. `rotation` is in degrees, counterclockwise. Time is in seconds.

## Classes and attributes

Every object has these attributes, with these defaults:

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `x`, `y`, `z` | 0 | center position |
| `rotation` | 0 | degrees, counterclockwise |
| `scale` | 1 | size multiplier |
| `opacity` | 1 | 0 means the object does not exist; 1 is solid |
| `fill` | `'#ffffff'` | color, as `'#rrggbb'` |
| `class` | `''` | class names separated by spaces, see Classes |

| Class | Own attributes and defaults |
|-------|-----------------------------|
| `Rect` | `width` 200, `height` 120 |
| `Circle` | `radius` 60 |
| `Text` | `text` `'Text'`, `fontSize` 48, `font` `'Segoe UI'` |

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

An instant appearance is the same fade with `duration: 0`.

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
- `delay`: seconds added to the start.
- `duration`: seconds. Omitted: 1.
- `until`: an end time or time reference, instead of `duration`.
- `easeIn`, `easeOut`: seconds of easing at each end. Omitted: 30% of the duration each.
- `ease`: `'linear'`, `'bounce'`, `'back'`, `'elastic'`, or `'snap'`. Replaces `easeIn` and `easeOut`.
- `relative`: `true` makes the values changes from where the object is when the action starts. Omitted: `false`.

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
is; a relative action adds its change on top of whatever else is happening.

## Time references

Assign an action to a name to refer to its timing: `slide.start`, `slide.end`,
`slide.progress(0.5)` for halfway. A reference must be declared above the line that uses it.

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

A member's own action written after the class statement takes over from its start, like any
later action (see "Relative and overlapping actions"). A named class action is a time reference
for all its members: `pulse.end` is when the last member finishes.

## Links

An attribute can follow another object's attribute with a function: `x: () => box.x + 20`. It is
evaluated at every frame with the other object's animated value. **Coming:** `link` actions with
a start and an end.

## What the GUI can edit

Literal numbers and strings in the cast and in action blocks, and the trailing number of a link.
Anything else, such as loops, helper functions, or computed values, runs and shows, but is marked
"code" and is not editable from the GUI. The app never reformats your lines; it replaces one
literal, adds one line, or removes one statement. While the file has an error, the GUI does not
edit it.

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

`Path` and `follow`, `morph`, `link` actions, `Group`, `Image`, `Video`, `Line`, `Polygon`,
object states such as `startsMoving`, per-character text animation, 3D, export.
