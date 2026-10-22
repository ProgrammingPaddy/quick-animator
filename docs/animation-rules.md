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
| `Text` | `text` `'Text'`, lines broken by `\n`; `fontSize` 48; `font` `'Segoe UI'`, an installed family or a file in `assets/fonts` by its name; `weight` 400; `italic` false; `align` `'center'`; `lineHeight` 1.2; `letterSpacing` 0. See Text |
| `Shape` | `points` `[]`, the corners around `x, y`; `curves` `''`, SVG path data, drawn instead of the points when set; `closed` true; `smooth` false; `stroke` `'#ffffff'`, `strokeWidth` 0. See Shapes |
| `Group` | only these: `members` `''`; `x`, `y` 0, how far the group has shifted its members; `rotation` 0 and `scale` 1, how far it has turned and scaled them; `pivotX`, `pivotY`, what its own rotation and scale pivot on, unset the center of the members' box at time zero. See Groups |

An omitted attribute takes its default. An unknown attribute is reported and ignored.

## Shapes

A `Shape` is what SVG draws: a polygon or a line through `points` of its own, or any curve as
`curves`. Only where its points lie against each other counts: the shape draws with the center of
their box at its `x, y`, and turns and scales about that center, so it moves, turns, scales, and
groups as any object and a list written anywhere means the same shape. `closed`, true unless
written false, joins the last point to the first and fills it with `fill`; false draws an open
line, which needs a `stroke` and a `strokeWidth` to be seen. `smooth` makes a curve through the
points, as paths have, round and back for a closed shape. Words on the class give lists of
points: `Shape.rect(width, height)`, `Shape.polygon(sides, radius)`, and `Shape.star(points,
outer, inner)`; `Shape.circle(radius)` gives curves, an exact circle, and `Shape.blob(radius,
wobble)` curves too, a soft blob whose radius wavers by the share given, 0.2 unless said. A
point written `at(x, y)` is tied to the scene: that corner is drawn at that place whatever the
shape's `x, y`, rotation, scale, or group, while the other points stay the shape's own, centered
on their own box; `points: () => [[-120, -40], [120, -40], at(c.x, c.y)]` is a band that reaches
to wherever `c` goes. A morph's target may hold such points too.

`curves` is SVG path data, the full form: `'M 0 -60 C 60 -140 160 -60 0 60 Z'`, with every
command SVG has, absolute or relative, arcs included. Set, it is drawn instead of the points, and
it is its own in the same way, the center of the box around its line at `x, y`. Its pieces fill
as SVG fills a path, one inside another cut out as a hole, open pieces included; `fill: 'none'`
draws no fill, so curves with a stroke alone are a line. The word is `curves`, not path, because
a path here is an animation; SVG calls the same string `d`. The app writes curves as a template
string, one command per line, which the code pane folds like a list of points; a string on one
line reads the same.

```js
flag = Shape({
  x: -200,
  y: 0,
  points: [
    [-100, -60],
    [100, -60],
    [60, 60],
    [-60, 60],
  ],
  smooth: true,
  fill: '#4f8cff',
})

wire = Shape({
  x: 200,
  y: 0,
  points: [[-100, -50], [0, 50], [100, -50]],
  closed: false,
  stroke: '#ffffff',
  strokeWidth: 4,
})

badge = Shape({
  points: Shape.star(5, 100, 50),
  fill: '#f59e0b',
})

heart = Shape({
  y: -200,
  curves: `
    M 0 -60
    C 60 -140 160 -60 0 60
    C -160 -60 -60 -140 0 -60
    Z
  `,
  fill: '#ef4444',
})
```

The Shape tool draws curves and nothing else: a click adds a corner, a drawn stroke a smooth run
with handles, the first corner or Enter closes it into a filled polygon, Escape leaves a line, a
stroke with `fill: 'none'`. Its Edit mode shows the points, round when smooth and square
otherwise, and the handles of a clicked one, which drag: a smooth point keeps its handles in
line, except while Alt is held, when the dragged one moves alone; a corner's move alone; an end
of a line has one; and a box dragged on empty space picks several. Right-click a point for
Smooth point, Corner point, or Straighten point; the line for Curve segment or Straighten
segment; Shape for Smooth shape, Straighten shape, and, on a line, Close line or Open line, which
change the outline and nothing else, a closed line staying hollow until it is given a fill. A
points shape becomes curves when a point or a segment of it is edited. The Shape tool opens in
Edit when a shape is selected. The GUI turns a Rect or a Circle into a
Shape with the same look. A point edit writes that point and moves `x, y` by where the center of the box went, to a
hundredth of a pixel, so the other points stay exactly where they are drawn; a resize scales
them all and keeps its far side. The app writes points one per line, and the code pane folds
them from the start, as it folds curves. Dragged things stop at the convex hull of a Shape. An SVG file
imported, by the Import button or dropped on the preview, becomes Rects, Circles, Texts, and
Shapes, grouped as the file groups them, named after the file and their kind, `logoRect1`, with
ids kept, and each, groups included, with `imported: 'logo.svg'`, the file it came from, which
the object pane shows as an I.

A Shape morphs: `blob.morph({ to: Shape.star(5, 100, 50), duration: 1 })` takes its outline to
the target's over the span, with the usual timing and easing, and holds it after, like any
animation. `to` is curves, `'M ...'`, points, `[[x, y], ...]`, one of the Shape's words, or a
link such as `() => other.curves`, drawn where it is written about the shape's `x, y`. Both
outlines are cubics; the one with fewer segments is split until the counts match, a closed
target is turned to where the anchors travel least, and every anchor and control goes straight
across, so two states of one shape tween point by point and the morph lands on the target
exactly. Only a Shape morphs: a Rect or a Circle becomes one first, by Convert to shape. In the
GUI, Add on a Shape offers Morph, whose target starts as the outline then; the Shape tool shows
the outline at the playhead, before, during, or after, and a drag edits the target of the morph
in force there, the top one running, through its last frame; in the middle of a morph a point
edit first writes a morph from the morph's start to the playhead and shapes that; Shift with a point
in the Shape tool, or with the resize handles in Select, writes a morph whose target is the
outline as dragged. A target written as a word or as points becomes curves when a point of it
is dragged.

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
| `morph` | a Shape's outline, to the curves or points in `to`; see Shapes |
| `to` | any attributes |

Timing keys, allowed in every action block:

- `at`: the start, in seconds or a time reference. Omitted: right after the object's previous action, or when the object begins if there is none.
- `delay`: seconds added to the start, whatever `at` is.
- `duration`: seconds. Omitted: 1.
- `until`: an end time or time reference, instead of `duration`.
- `easeIn`, `easeOut`: seconds of easing at each end. Omitted: 30% of the duration each.
- `ease`: `'linear'`, `'bounce'` (bounces at the end), `'back'` (overshoots at the end), `'elastic'` (springs at the end), or `'snap'` (fast start, settles); or a function of the progress, `(p) => p * p`, giving the eased progress, 0 to 1; or one of the `Ease` curves: `Ease.ramps(easeIn, easeOut, duration)`, the ramps as a curve; `Ease.part(ease, from, to)`, the part of a curve between two points of its progress, stretched to a whole curve; `Ease.share(ease, from, to)`, the share of the change the curve covers there, which stops part of the way; `ease` a name, a function, or another `Ease` curve. These are what a sliced animation runs on, and go beyond 0 and 1 where `'bounce'` or `'back'` does; a function of your own is kept within 0 and 1. Replaces `easeIn` and `easeOut`.
- `relative`: `true` makes the values changes from where the object is when the action starts. Omitted: `false`.
- `overrides`: the name of a class action this action replaces for its object. See Classes.

An action never dictates its start. It begins from the state the object is in when its first
frame is active, whatever other animations and edits made that state, in time order, whichever
way the actions are written; all an action writes is its end. Two actions that begin at the
same moment both begin from what came before them. Overlapping actions stack as written: the
top one running has the say, through its last frame, and the one below shows through from its
own course when the top one ends.

A value written as a function with a parameter is a function of the progress: `x: (p, t) =>
Math.sin(t * 40) * 12` is called with the plain progress, 0 to 1 with nothing eased, and the
seconds since the action began, and what it gives is the value, relative or not, so a shake or
a blink is one line; a plain number at the top of the function is a rate of its own, `fill:
(p, t, speed = 0.5) => Color.hue(t * speed)`. The ease is the function's envelope: `'linear'`,
or ramps of nothing, apply it in full throughout; ramps bring it in over `easeIn` and out over
`easeOut`, the speed the ramps give, so the thing ends as it began; a named curve weighs it by
what the curve gives. A function without a parameter, `() => other.x`, stays a link, sampled
as a value and interpolated to.

Any time can be written as frames at the project's rate: `at: frames(15)`, `duration:
frames(5)`, `until: frames(240)`; it is the same as the seconds, and stays frames when the GUI
retimes it. The code pane notes every time's frames, and frames' seconds, beside the line.

An action can be cut in two at a time, which the timeline's razor does: the first piece, the
statement itself, ends at the cut and goes to the state its course reaches there; the second,
written right after it, starts at the cut, goes to the end, and begins from the state the first
leaves, as any action begins. Together they run as the whole did. Plain ramps stay ramps where
those say the same, written out in seconds; elsewhere, and on a named curve or a function, a
piece runs on `Ease.part`. A written number or color is cut into the value reached; a relative
change into the change so far and the rest; a range stays on the first piece, and the second
begins from where the first leaves it; a change that is a function stays a function on both
pieces, the first stopping part of the way on `Ease.share`. A path's line is cut where the object
is then, a smooth one as the curves it is; a morph's first piece gets the outline reached as its
target. The name stays on the first piece, so `name.start` still names the start and what
followed `name.end` now follows the cut; a linked end becomes the cut on the first piece. A
class action is not cut, nor a path from a formula.

A number can be written as a range, `[from, to]`: the one exception, which sets the state at the
first frame itself. The action begins from the first number
instead of from where the object is, and goes to the second; an action on the same attribute
that runs before it begins from that held start, since that is what the object shows. The start holds before the action
as the end holds after it: an absolute action holds its start from the object's beginning until
it begins, so long as no other action on that attribute has the say, and a relative one adds its
start until it begins. With `relative: true` both numbers are changes from where the object is,
which is how something arrives from off the frame at its own place without naming a place: it
waits there until it comes. A path's pairs are points, never ranges.

```js
title.fade({
  opacity: [0, 1],
  duration: 0.3,
})

title.move({
  x: [-1060, 0],
  relative: true,
  duration: 0.6,
  easeIn: 0,
})
```

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
line and edits the points one by one; a function is code. `shape` may also be curves, SVG path
data in the scene's space, `'M -300 0 C -200 200 200 200 300 0'`: the Path tool then shows the
anchors with the controls of a clicked one, and the words a shape has: Smooth path, or a drawn
stroke, writes a points path as curves, Straighten path makes every segment a line, and a point
or a segment is right-clicked for Smooth, Corner, Straighten, or Curve; `smooth` means nothing
to curves. A group's path moves its members as one, its line
drawn from the middle of them; a class's path, `all('bars').path({ ..., relative: true })`,
takes every member from its own place, and the Path tool edits it for all of them at once.

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

A shape relative to the object follows the object wherever it is put. An orbit, with its
center and radius in one place:

```js
orbit = moon.path({
  shape: (p, center = [-200, 0], radius = 200) => [center[0] + radius * Math.cos(p * 2 * Math.PI), center[1] + radius * Math.sin(p * 2 * Math.PI)],
  relative: true,
  duration: 3,
  ease: 'linear',
  orient: true,
})
```

Code the app writes declares nothing it need not: no `const` or `let` where a plain assignment or
a parameter with a default does, as above, where the numbers to tune are the parameters.

A straight arrival from off the frame is a move, not a path: see the range under Actions.

The preview draws every path as the line the object actually travels: a relative path from
where the object is, a move under a path in the line, a relative change over a path in the line,
and a path on a member of a group where the group puts it. Its points sit where the object is as
it reaches each, and dragging one writes the change against whatever else moves the object at
that moment. A path whose shape is code is drawn dashed and has no points to drag; Move path
carries it by writing its `offset`. A path started from the GUI begins where the absolute actions
put the object, so a relative change running then, an orbit say, goes on adding and the object
stays put.

An easing that rises and falls makes one action go and come back: `ease: (p) => Math.sin(p * Math.PI)`
on `resize({ scale: 0.2, relative: true })` is a pulse. After an action ends, its attribute holds
the value the easing reached at the end: the target for the usual easings, and for one that
falls back, where it fell back to.

## Text

A `Text` is one line or several: a line break in `text` starts a new line, written as `\n`
inside the quotes, `'Quick\nAnimator'`, which is how the app writes it, or as a template string
with real line breaks between its backticks, which reads the same. `align` sets the lines left,
center, or right in the block, which is the widest line by the lines' height, centered at
`x, y`. `fontSize` is in pixels; `lineHeight` is a multiple of it; `letterSpacing` is pixels
between letters; `weight` is 100 to 900, 700 bold; `italic` slants. `font` names a family
installed on the system, or a font file in the project's `assets/fonts` folder by its file
name without the extension, `'Inter'` for `assets/fonts/Inter.ttf`, loaded when the project
opens; a font from the web is such a file put there.

An action of a Text can run on its units instead of the whole: `by: 'char'`, `'word'`, or
`'line'`, each unit in turn, `stagger` seconds after the one before, 0.05 unless written, or
the seconds a function of the unit's index gives, `stagger: (i) => 0.04 + (i % 3) / 100`; a
space is no character. A unit's natural state is no offset, full size, solid, the text's fill,
and its own text: `x`, `y`, and `rotation` are offsets from where it sits, `scale` and
`opacity` factors on what it is, `fill` its own color, `text` what it shows. Unit actions stack
as an object's do: the latest begun has the say and begins from what the earlier ones left, or
from the natural state; a range names where the unit begins, and before any action begins the
first's range start holds, so `opacity: [0, 1]` keeps every character unseen until it fades in,
while a later fade to 0 runs the text out from what it was. A word's or a line's action goes to
each of its characters. A value written as a function with a parameter is a function of the
unit's turn: it is called with the plain progress of the turn, the unit's index, the unit's own
text, the seconds since the turn began, and how many units there are, `(p, i, c, t, n) =>
...`, and what it returns is the value, the ease its envelope as on an object, so `fill: (p, i,
c, t, speed = 0.5) => Color.hue(t * speed + i / 8)` colors every letter its own hue turning at
`speed` and `text: (p, i, c, t, n, settle = 2) => (t < 0.4 + (i / n) * settle ?
Text.scramble(i, t) : c)` spins every character from the start and lands them one after
another. `Color.hue(hue, saturation, lightness)` is a color a fraction of the way round the
wheel, as `'#rrggbb'`; `Text.scramble(index, seconds, alphabet)` a letter or digit that
changes as the seconds go, the same for the same index and moment. A `path` by unit is its
shape as changes from the unit's place, `orient` turning the unit. The action lasts until the
last unit is done, `duration + the gaps`, which is its `end`; the text's own attributes are
untouched. A `morph` has no `by`, nor has any object but a Text.

Right-click a Text for Shape, Convert to shape: its letters become `curves`, the outlines of
its glyphs read from its font's file, the project's or the installed one, where the text was;
what ran on the text alone, by unit or on a size or a word a shape has not, is listed and
removed first, since a shape cannot run it.

```js
title = Text({
  text: 'Quick\nAnimator',
  fontSize: 150,
  weight: 700,
  font: 'Inter',
})

title.to({
  opacity: [0, 1],
  y: [-20, 0],
  by: 'word',
  stagger: 0.08,
  duration: 0.4,
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

Literal numbers and strings in the cast and in action blocks, the two numbers of a range, the
points of a path's shape, and the trailing number of a link.
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
Path tool writes a path, one point per line, and moves its points as the drags say. A preset
writes one named animation at the end of the file, an arrival as a relative move written as a
range and a fade in as an opacity range, and touches nothing else; a morph preset writes a
morph to a word, `Shape.circle(r)`, `Shape.rect(2r, 2r)`, `Shape.polygon(sides, r)`,
`Shape.star(points, r, r/2)`, or `Shape.blob(r)`, `r` half the larger side of the object, and
turns a Rect or a Circle into a Shape first, as Convert to shape does; a text preset writes a
fade or a `to` by character, word, or line with its stagger, on a Text alone, some with
functions of the progress; the miscellaneous ones, a color change, a shake, a blink, a grow, and
a shrink, write a `to`, a relative move or resize, or a fade for any object. A preset of the user's own,
saved by right-click, is an animation's block without its place in time, an object's declaration
and animations without its place and its life, a group with everything it carries, or a class's
statements, written back as they were and named after the preset. A drag of an object puts it where the pointer is whatever is placed on it: a move's
end, a path's point, the start an action was given, or the declaration, whichever has the say at
that moment. In the middle of an action, more than half a frame from either end, a drag, a
nudge, or a value typed in the Selected pane first writes an action of its own from that action's
start to the playhead, with the values as they are, and then edits that one, so it meets the new
state; the playhead stays; the original is untouched and runs on from the state at its own
first frame, so the object snaps back to its course when the new one ends, and placed after it
instead, the new one's end is where the original begins. The new action is a plain one, the verb
of the attributes and the default ramps; it has its say at the playhead, its last frame, so a
further edit there goes to it. A point of a Shape dragged, added, or removed in the middle of a
morph writes a morph from the morph's start to the playhead the same way, its target the
outline at the playhead, and edits that target. The timeline's razor cuts an action in two, as
Actions says. A value that is code of its own, a shape from a formula or a custom ease, is marked
with a small ƒ in the timeline and the objects pane, and a path drawn from code is dashed; the
code pane is where they change.

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

orbits (a turn around a point, as its own verb), objects attached to another's path, the motion of a drag kept as a path, `link` actions, `Image`, `Video`, `Line`, `Polygon`,
object states such as `startsMoving`, per-character text animation, 3D.
