# Animation rules

The one file an agent needs to write a Quick Animator animation. Everything here works today
unless marked **coming**. The app validates the file on load and shows errors at their line.

## The project

```
my-animation/
  project.json      { "width": 1920, "height": 1080, "fps": 30 }
  scenes/main.js    the scene
  assets/           images, audio, video (coming)
  lib/              shared code (coming)
```

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
| `opacity` | 1 | 0 invisible, 1 solid |
| `fill` | `'#ffffff'` | color, as `'#rrggbb'` |

| Class | Own attributes and defaults |
|-------|-----------------------------|
| `Rect` | `width` 200, `height` 120 |
| `Circle` | `radius` 60 |
| `Text` | `text` `'Text'`, `fontSize` 48, `font` `'Segoe UI'` |

An omitted attribute takes its default. An unknown attribute is reported and ignored.

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
| `appear` | nothing changes; the object exists from here, fading in over `fadeIn` seconds |
| `disappear` | nothing changes; the object stops existing here, fading out over `fadeOut` seconds |

Timing keys, allowed in every action block:

- `at`: the start, in seconds or a time reference. Omitted: right after the object's previous action, or 0 if there is none.
- `delay`: seconds added to the start.
- `duration`: seconds. Omitted: 1. Always 0 for `appear` and `disappear`.
- `until`: an end time or time reference, instead of `duration`.
- `easeIn`, `easeOut`: seconds of easing at each end. Omitted: 30% of the duration each.
- `ease`: `'linear'`, `'bounce'`, `'back'`, `'elastic'`, or `'snap'`. Replaces `easeIn` and `easeOut`.
- `fadeIn` with `appear`, `fadeOut` with `disappear`: seconds.

Without `appear` and `disappear`, an object exists from 0 to the end. A later action on the same
attribute takes over from its start.

## Time references

Assign an action to a name to refer to its timing: `slide.start`, `slide.end`,
`slide.progress(0.5)` for halfway. Objects have `box.appears` and `box.disappears`. A reference
must be declared above the line that uses it.

```js
dot.appear({
  at: slide.end,
  fadeIn: 0.3,
})
```

## Links

An attribute can follow another object's attribute with a function: `x: () => box.x + 20`. It is
evaluated at every frame with the other object's animated value. **Coming:** `link` actions with
a start and an end.

## What the GUI can edit

Literal numbers and strings in the cast and in action blocks, and the trailing number of a link.
Anything else, such as loops, helper functions, or computed values, runs and shows, but is marked
"code" and is not editable from the GUI. The app never reformats your lines; it replaces one
literal, adds one line, or removes one statement.

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

dot.appear({
  at: slide.end,
  fadeIn: 0.3,
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
per-character text animation, 3D, export.
