orb = Circle({
  x: -342,
  y: 29,
  radius: 60,
  fill: '#f59e0b',
  until: 5.6179,
  rotation: -0.1,
  width: 268,
  height: 235,
})

box = Rect({
  x: -608,
  y: 190,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  until: 9.1667,
  opacity: 1,
  at: 2.5833,
  class: 'test',
})

text1 = Text({
  x: -576,
  y: 594,
  text: 'Text',
  fontSize: 48,
  fill: '#ffffff',
  until: 2.4167,
  opacity: 0,
})

rect1 = Rect({
  x: -251,
  y: 174,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  at: 3.7833,
  until: 6,
  class: 'test',
})

text2 = Text({
  x: -41,
  y: 600,
  text: 'Text',
  fontSize: 48,
  fill: '#ffffff',
  until: 2.4167,
  opacity: 1,
})

text3 = Text({
  x: -289,
  y: 591,
  text: 'Text',
  fontSize: 48,
  fill: '#ffffff',
  until: 2.4167,
  opacity: 0,
})

stuff = Group({
  members: 'box orb',
  opacity: 0.88,
})

text4 = Text({
  x: 120,
  y: 245,
  text: 'Text',
  fontSize: 48,
  fill: '#ffffff',
  at: 5,
  until: 7,
  rotation: -358.7,
})

orb.move({
  x: 317,
  y: 189,
  at: 0,
  duration: 1,
})

box.move({
  x: 177,
  y: -181,
  at: 3.05,
  duration: 0.6167,
})

box.move({
  x: 247,
  y: -19,
  at: 4.1833,
  duration: 0.3667,
})

orb.move({
  x: -566,
  y: 268,
  at: 1.1333,
  duration: 1,
})

orb.move({
  x: 50,
  y: -281,
  at: 2.1333,
  duration: 0.45,
})

orb.move({
  x: 24,
  y: -71,
  at: 2.5833,
  duration: 1,
})

text1.move({
  x: -555,
  y: 392,
  at: 0,
  duration: 1,
})

text3.move({
  x: -298,
  y: 408,
  at: 0.4167,
  duration: 1,
})

text2.move({
  x: -51,
  y: 403,
  at: 0.8833,
  duration: 1,
})

text3.fade({
  opacity: 1,
  at: 0.4167,
  duration: 0.3166,
})

text1.fade({
  opacity: 1,
  at: 0,
  duration: 0.3166,
})

box.fade({
  opacity: 1,
  at: 3.3166,
  duration: 0.3501,
})

stuff.move({
  x: -100,
  y: -77,
  at: 0,
  duration: 1,
})

orb.move({
  x: -229,
  y: 201,
  at: 3.3006,
  duration: 1,
})

orb.move({
  x: 0,
  y: 249,
  at: 4.3006,
  duration: 1,
})

orb.move({
  x: -221,
  y: 60,
  at: 4.3006,
  duration: 1,
})

orb.move({
  x: -371,
  y: 216,
  at: 4.3006,
  duration: 1,
})

orb.move({
  x: 81,
  y: 271,
  at: 3.3006,
  duration: 1,
})

orb.move({
  x: 164,
  y: -7,
  at: 3.3006,
  duration: 1,
})

orb.move({
  x: -139,
  y: -31,
  at: 3.3006,
  duration: 1,
})

orb.move({
  x: -138,
  y: -30,
  at: 4.3006,
  duration: 1.2171,
})

text2.fade({
  opacity: 0,
  at: 1.1167,
  duration: 0.5333,
})

orb.move({
  x: -140,
  y: -515,
  at: 4.5166,
  duration: 1,
})

box.move({
  x: 441,
  y: 83,
  at: 7.3349,
  duration: 1,
})

rect1.move({
  x: -308,
  y: 106,
  at: 3.7833,
  duration: 1,
})

box.move({
  x: 718,
  y: 83,
  at: 7.3349,
  duration: 1,
})

box.move({
  x: -465,
  y: 43,
  at: 6.3333,
  duration: 1,
})

rect1.move({
  x: -479,
  y: 173,
  at: 5,
  duration: 1,
})

text2.fade({
  opacity: 0.7,
  at: 0.4167,
  duration: 0.5167,
})
