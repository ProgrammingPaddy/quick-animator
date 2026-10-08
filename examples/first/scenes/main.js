// Cast: every object, one attribute per line.

box = Rect({
  x: -470,
  y: 88,
  width: 391,
  height: 223,
  fill: '#ffffff',
  rotation: -0.6,
  class: 'test',
  z: 0,
  opacity: 1,
})

title = Text({
  text: 'Quick Animator',
  x: 0,
  y: 320,
  fontSize: 72,
  fill: '#ffffff',
})

rect1 = Rect({
  x: -412,
  y: 101,
  width: 249,
  height: 171,
  fill: '#4f8cff',
  rotation: -243.3,
})

rect2 = Rect({
  x: -812,
  y: 121,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  rotation: -126.2,
})

// Two objects in one class. all('bars') below acts on both at once.

// Script: what happens, in time order. Without `at`, an action starts when the object's
// previous action ends. An object exists wherever its opacity is above zero.

slide = box.move({
  x: 260,
  at: 0.5,
  duration: 1.2,
})

title.fade({
  opacity: 0,
  at: 3,
  duration: 1,
})


// bar2 goes its own way: this replaces rise for bar2 alone.

box.to({
  width: 300,
  height: 260,
  x: -320,
  y: -140,
  at: 5,
  duration: 1,
})

box.to({
  width: 367,
  height: 235,
  x: -287,
  y: -22,
  at: 7,
  duration: 1,
})

box.to({
  width: 770,
  height: 432,
  x: -871,
  y: 287,
  at: 8,
  duration: 1.54,
})

box.to({
  width: 1154,
  height: 355,
  x: -162,
  y: 51,
  at: 9.54,
  duration: 1,
})

box.to({
  width: 1430,
  height: 355,
  x: -25,
  y: 64,
  at: 10.54,
  duration: 1,
})

box.rotate({
  rotation: -750,
  at: 11.54,
  duration: 1,
})

box.to({
  width: 1553,
  height: 355,
  x: 34,
  y: 47,
  at: 11,
  duration: 1.54,
})

box.to({
  width: 1553,
  height: 270,
  x: -115,
  y: 328,
  at: 12.54,
  duration: 1.663,
})

box.to({
  width: 391,
  height: 282,
  x: -393,
  y: -56,
  at: 0.506,
  duration: 1,
})

box.to({
  width: 391,
  height: 303,
  x: -385,
  y: -49,
  at: 1.506,
  duration: 1,
})

box.to({
  width: 391,
  height: 440,
  x: -379,
  y: 19,
  at: 2.506,
  duration: 1,
})

box.to({
  width: 892,
  height: 223,
  x: -150,
  y: 30,
  at: 0.517,
  duration: 1,
  delay: 0,
})

box.to({
  width: 410,
  height: 270,
  x: -400,
  y: 140,
  at: 0.55,
  duration: 1,
})

box.rotate({
  rotation: -90,
  at: 6,
  duration: 1,
})

box.rotate({
  rotation: 90,
  at: 5.251,
  duration: 1,
})

box.rotate({
  rotation: -750,
  at: 13.35,
  duration: 1,
})

box.to({
  width: 1710,
  height: 630,
  x: 43,
  y: 445,
  at: 13.35,
  duration: 1,
})

box.to({
  width: 2020,
  height: 630,
  x: 177,
  y: 368,
  at: 13.35,
  duration: 1,
})

box.move({
  x: -59,
  y: 60,
  at: 14.567,
  duration: 1,
})

box.rotate({
  rotation: -720,
  at: 15.567,
  duration: 1,
})

box.to({
  width: 1740,
  height: 490,
  x: -59,
  y: 59,
  at: 16.567,
  duration: 1,
})

box.move({
  x: -40,
  y: -300,
  at: 17.751,
  duration: 1,
})

box.move({
  x: -10,
  y: -260,
  at: 17.751,
  duration: 1,
})

box.resize({
  width: 1090,
  height: 490,
  at: 18.751,
  duration: 1,
  relative: false,
})

box.rotate({
  rotation: -645,
  at: 19.751,
  duration: 1,
})

box.move({
  x: 1344,
  y: -41,
  at: 20.751,
  duration: 1,
})

title.orbit({
  at: 21.75,
  duration: 1,
})

title.fade({
  opacity: 1,
  at: 18,
  duration: 2,
})

rect1.orbit({
  dx: -198,
  dy: 4,
  angle: -87.3,
  at: 20.3167,
  duration: 1,
})

rect2.orbit({
  dx: 202,
  dy: -16,
  angle: -87.3,
  at: 20.3167,
  duration: 1,
})

rect1.move({
  x: -556,
  y: -213,
  at: 20.3167,
  duration: 1,
})

rect2.move({
  x: -555,
  y: 187,
  at: 20.3167,
  duration: 1,
})

rect2.move({
  x: -53,
  y: 165,
  at: 22.5167,
  duration: 1,
})

rect1.move({
  x: -54,
  y: -235,
  at: 22.5167,
  duration: 1,
})

rect2.orbit({
  dx: 501,
  dy: -228,
  angle: -92.9,
  at: 22.5167,
  duration: 1,
})

rect1.orbit({
  dx: 502,
  dy: 172,
  angle: -92.9,
  at: 22.5167,
  duration: 1,
})
