// Cast: every object, one attribute per line.

box = Rect({
  x: -400,
  y: 667,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

dot = Circle({
  x: -2,
  y: -300,
  radius: 50,
  fill: '#f59e0b',
  opacity: 1,
})

// Script: what happens, in time order. Without `at`, an action starts when the object's
// previous action ends. An object exists wherever its opacity is above zero.

box.rotate({
  rotation: 360,
  at: slide.progress(0.5),
  duration: 1,
})

dot.move({
  y: -669,
  duration: 0.8,
  ease: 'bounce',
  at: 0.598,
})

box2 = Rect({
  x: -337,
  y: 655,
  z: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
  fill: '#ffffff',
  width: 200,
  height: 120,
})

box2.move({
  x: -357,
  y: 205,
  at: 2.25,
  duration: 1,
})

box.move({
  x: 336,
  y: 179,
  at: 2.25,
  duration: 1,
})
