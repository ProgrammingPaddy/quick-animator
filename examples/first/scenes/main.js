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

box2 = Rect({
  x: -677,
  y: 174,
  fill: '',
})

art = Rect({
  x: -210,
  y: -250,
  z: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
  fill: '#ffffff',
  width: 200,
  height: 120,
})
// Script: what happens, in time order. Without \`at\`, an action starts when the object's
// previous action ends.

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
  duration: 0.933,
  ease: 'bounce',
  at: 1.333,
})

title.fade({
  opacity: 0,
  at: 3,
  duration: 1,
})

box.move({
  x: -389,
  y: -206,
  at: 2.967,
  duration: 1,
})

box.move({
  x: 418,
  y: -219,
  at: 3.267,
  duration: 1,
})
