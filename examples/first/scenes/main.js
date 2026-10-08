// Cast: every object, one attribute per line.

box = Rect({
  x: -470,
  y: 88,
  width: 391,
  height: 223,
  fill: '#599a47',
  rotation: -0.6,
  class: 'test',
  z: 0,
})

title = Text({
  text: 'Quick Animator',
  x: 0,
  y: 320,
  fontSize: 72,
  fill: '#ffffff',
})

// Two objects in one class. all('bars') below acts on both at once.

dot = Circle({
  x: 0,
  y: -300,
  radius: 95,
  fill: '#f59e0b',
  opacity: 0,
  height: 440,
  width: 440,
})

bar2 = Rect({
  x: 130,
  y: -400,
  width: 160,
  height: 24,
  fill: '#a855f7',
  class: 'bars',
  rotation: 0,
})

bar1 = Rect({
  x: 84,
  y: -400,
  width: 160,
  height: 24,
  fill: '#10b981',
  class: 'bars test',
})

rect1 = Rect({
  x: 582,
  y: 265,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  rotation: -0.5,
})

rect2 = Rect({
  x: -805,
  y: 408,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  rotation: -0.1,
})

rect3 = Rect({
  x: -901,
  y: 448,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

// Script: what happens, in time order. Without `at`, an action starts when the object's
// previous action ends. An object exists wherever its opacity is above zero.

slide = box.move({
  x: 260,
  at: 0.5,
  duration: 1.2,
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
  y: -100,
  at: 2.4,
  duration: 0.6,
  ease: 'back',
  overrides: rise,
})

dot.move({
  x: -30,
  y: 110,
  at: 2,
  duration: 1,
})

dot.rotate({
  rotation: -315,
  at: 3,
  duration: 1,
})

dot.move({
  x: 125,
  y: -132,
  at: 4,
  duration: 1,
})

box.to({
  width: 300,
  height: 260,
  x: -320,
  y: -140,
  at: 5,
  duration: 1,
})

dot.to({
  radius: 105,
  x: 61,
  y: -78,
  at: 6,
  duration: 1,
})

bar1.move({
  y: -335,
  at: 2,
  duration: 0.6,
  ease: 'back',
  overrides: rise,
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

bar2.rotate({
  rotation: 0,
  at: 5.251,
  duration: 1,
})

dot.rotate({
  rotation: -390,
  at: 7.587,
  duration: 0.017,
})

rect1.move({
  x: 180,
  y: -150,
  at: 0.55,
  duration: 0.857,
})

rect1.move({
  x: 520,
  y: 160,
  at: 2,
  duration: 1,
})

rect1.move({
  x: 540,
  y: 70,
  at: 6.518,
  duration: 1,
})

rect1.move({
  x: 440,
  y: 14,
  at: 6.888,
  duration: 0.969,
})

rect1.move({
  x: 510,
  y: 20,
  at: 6.857,
  duration: 1,
})

rect1.rotate({
  rotation: 105,
  at: 6.721,
  duration: 1.136,
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
})

box.rotate({
  rotation: -645,
  at: 19.751,
  duration: 1,
})

box.move({
  x: -390,
  y: 90,
  at: 20.751,
  duration: 1,
})

bar1.move({
  x: 765,
  y: 361,
  at: 18.767,
  duration: 1,
})

rect2.move({
  x: 702,
  y: 19,
  at: 7.84,
  duration: 0.017,
})

rect1.to({
  x: 703,
  y: 87,
  rotation: -43.8,
  at: 21.917,
  duration: 1,
})

rect2.to({
  x: 481,
  y: -52,
  rotation: -148.9,
  at: 22,
  duration: 1,
})

rect1.move({
  x: 715,
  y: -158,
  at: 23.283,
  duration: 1,
})

rect2.move({
  x: 493,
  y: -297,
  at: 24.283,
  duration: 1,
})

rect1.move({
  x: 699,
  y: 73,
  at: 27.267,
  duration: 1,
})

rect2.move({
  x: 477,
  y: -66,
  at: 27.267,
  duration: 1,
})

rect3.move({
  x: 864,
  y: 458,
  at: 28.967,
  duration: 0.627,
})
