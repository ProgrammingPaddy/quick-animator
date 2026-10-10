// The sample scene, kept here for the export check: node scripts/check-export.mjs

// The cast: every object, one attribute per line.
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

// Two objects in one class; all('bars') below moves both.
bar1 = Rect({
  x: -120,
  y: -400,
  width: 160,
  height: 24,
  fill: '#10b981',
  class: 'bars',
})

bar2 = Rect({
  x: 120,
  y: -400,
  width: 160,
  height: 24,
  fill: '#a855f7',
  class: 'bars',
})

pair = Group({
  members: 'bar1 bar2',
})

// The script, in time order. Without `at`, an action starts when the object's last one ends.
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

rise = all('bars').move({
  y: -250,
  at: 2,
  duration: 0.6,
  ease: 'back',
})

// bar2 goes its own way: this replaces rise for bar2 alone.
bar2.move({
  y: -200,
  at: 2.4,
  duration: 0.6,
  ease: 'back',
  overrides: rise,
})

pair.rotate({
  rotation: 90,
  at: 3,
  duration: 1,
})
