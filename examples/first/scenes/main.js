// A tour of text: each line shows one way to animate it, and the playhead walks them in turn.
// The cast: every object, one attribute per line.
title = Text({
  x: 0,
  y: 400,
  text: 'Quick Animator',
  fontSize: 120,
  weight: 700,
  fill: '#4f8cff',
})

rise = Text({
  x: -460,
  y: 220,
  text: 'Rise by word',
  fontSize: 72,
})

drop = Text({
  x: 460,
  y: 220,
  text: 'Letters drop',
  fontSize: 72,
})

lines = Text({
  x: -460,
  y: 40,
  text: 'Lines in\nslide from the left',
  fontSize: 56,
  align: 'left',
})

hop = Text({
  x: 460,
  y: 40,
  text: 'hop along a path',
  fontSize: 64,
})

typed = Text({
  x: -460,
  y: -150,
  text: 'code typing...',
  fontSize: 64,
  font: 'Consolas',
})

slot = Text({
  x: 460,
  y: -150,
  text: 'SLOT MACHINE',
  fontSize: 64,
  font: 'Consolas',
})

magic = Text({
  x: 0,
  y: -350,
  text: 'Enchanted',
  fontSize: 110,
  weight: 700,
  until: 11.6667,
  at: 0.5,
})

rect1 = Rect({
  x: 35,
  y: -126,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  at: 4.75,
  until: 9.3333,
})

text1 = Text({
  x: 50,
  y: -28,
  text: '',
  fontSize: 48,
  fill: '#ffffff',
  at: 12.6667,
  until: 14.6667,
})

text2 = Text({
  x: -74,
  y: -4,
  text: 'Text',
  fontSize: 48,
  fill: '#ffffff',
  at: 12.6667,
  until: 14.6667,
})

// The script, in time order.
title.to({
  opacity: [0, 1],
  y: [-20, 0],
  by: 'word',
  stagger: 0.1,
  at: 0,
  duration: 0.5,
})

rise.to({
  opacity: [0, 1],
  y: [-20, 0],
  by: 'word',
  stagger: 0.08,
  at: 1,
  duration: 0.4,
})

drop.to({
  opacity: [0, 1],
  y: [120, 0],
  by: 'char',
  stagger: 0.03,
  at: 1.5,
  duration: 0.5,
  ease: 'bounce',
})

lines.to({
  opacity: [0, 1],
  x: [-120, 0],
  by: 'line',
  stagger: 0.15,
  at: 2.5,
  duration: 0.5,
  easeIn: 0,
})

// A path by character is the shape as changes from each character's place: up and back.
hop.path({
  shape: [
    [0, 0],
    [0, 70],
    [0, 0],
  ],
  smooth: true,
  by: 'char',
  stagger: 0.05,
  at: 3.5,
  duration: 0.6,
})

typed.fade({
  opacity: [0, 1],
  by: 'char',
  stagger: (i) => 0.04 + ((i * 7) % 5) / 100,
  at: 5,
  duration: 0.02,
})

// Every character spins from the start and lands on its own, the first soon, the last after `settle` seconds more.
slot.to({
  text: (p, i, c, t, n, settle = 2) => (t < 0.4 + (i / n) * settle ? Text.scramble(i, t) : c),
  by: 'char',
  stagger: 0,
  at: 6,
  duration: 3,
  ease: 'linear',
})

// Each letter its own hue turning at `speed`, and a wiggle; the ramps bring it in and out, so the text ends as it began.
magic.to({
  fill: (p, i, c, t, speed = 0.5) => Color.hue(t * speed + i / 8),
  y: (p, i, c, t) => Math.sin(t * 6 + i) * 4,
  by: 'char',
  stagger: 0,
  at: 7.5,
  duration: 2.3333,
  easeIn: 0,
  easeOut: 0,
})

// The whole title follows a path, up and back, 30 frames long.
title.path({
  shape: [
    [0, 0],
    [0, 40],
    [0, 0],
  ],
  relative: true,
  smooth: true,
  at: 10.5,
  duration: frames(30), 
})

rect1.move({
  x: -66,
  y: -135,
  at: 5.1667,
  duration: 1,
})

colorChange = rect1.to({
  fill: (p, t, speed = 0.5) => Color.hue(t * speed),
  at: 5.1667,
  duration: 3.1666,
  ease: 'linear',
})
