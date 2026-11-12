rect3 = Rect({
  x: 1,
  y: 243,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  until: 3.4167,
  class: 'adw',
  scale: 0.59,
  rotation: 0.4,
})

circle2 = Shape({
  x: -541,
  y: 172,
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

shape1 = Shape({
  x: -183,
  y: 165,
  fill: '#4f8cff',
  at: 4.75,
  until: 6.75,
  curves: `
    M 0 56.39
    L -60 -43.61
    L 60 -43.61
    Z
  `,
  smooth: false,
})

camera = Camera({
  x: -332,
  y: 204,
  zoom: 1.6,
})

camera2 = Camera({
  x: 0,
  y: 0,
  zoom: 1,
  at: 1.4167,
  until: 2.25,
})

camera3 = Camera({
  x: -349,
  y: 138,
  zoom: 2.07,
  at: 2.9167,
  until: 4.25,
})

 

rect3.move({
  x: 345,
  y: 231,
  at: 1,
  duration: 1,
})

