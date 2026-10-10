rect1 = Rect({
  x: -740,
  y: 292,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

rect2 = Rect({
  x: -759,
  y: -139,
  width: 240,
  height: 140,
  fill: '#4f8cff',
})

rect1.move({
  x: 502,
  y: -115,
  at: 0,
  duration: 1,
})

rect2.move({
  x: 480,
  y: 201,
  at: 0,
  duration: 1,
})

rect2.rotate({
  rotation: -181.5,
  at: 1,
  duration: 1,
})
