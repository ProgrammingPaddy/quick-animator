rect3 = Rect({
  x: -226,
  y: 206,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  until: 3.4167,
  class: 'adw',
  attached: true,
  scale: 1.82,
})

circle2 = Shape({
  x: 211,
  y: 114,
  fill: '#f59e0b',
  until: 3.4167,
  class: 'adw',
  curves: `
    M 60 0
    C 60 33.14 33.14 60 0 60
    C -33.14 60 -60 33.14 -60 0
    C -60 -33.14 -33.14 -60 0 -60
    C 33.14 -60 60 -33.14 60 0
    Z
  `,
})

circle1 = Circle({
  x: -83,
  y: -47,
  radius: 60,
  fill: '#f59e0b',
  until: 4.4167,
  class: 'adw',
  attached: true,
})

camera = Camera({
  x: 67,
  y: 82,
  zoom: 1.82,
  rotation: 0,
})
 

camera.move({
  x: 598,
  y: 184,
  at: 0,
  duration: 1,
})

camera.move({
  x: -91,
  y: 124,
  at: 2.25,
  duration: 1,
})

camera.move({
  x: 265,
  y: 35,
  at: 0,
  duration: 1,
})

camera.move({
  x: -60,
  y: 54,
  at: 1,
  duration: 1,
})

camera.move({
  x: 218,
  y: -37,
  at: 0,
  duration: 1,
})

rect3.move({
  x: 345,
  y: 231,
  at: 1,
  duration: 1,
})
