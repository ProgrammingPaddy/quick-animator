rect1 = Rect({
  x: -320,
  y: 656,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  until: 4.25,
})

rect1.move({
  x: 35,
  y: 306,
  easeIn: 0,
  ease: 'snap',
  at: 0,
  duration: 0.4,
})

rect1.path({
  shape: (p) => [0 + 105 * Math.cos(-2.763 + p * 2 * Math.PI), 0 + 105 * Math.sin(-2.763 + p * 2 * Math.PI)],
  at: 0.6667,
  duration: 1,
  ease: 'linear',
  orient: true,
})

rect1.move({
  x: 460,
  y: -61,
  at: 2.1667,
  duration: 1,
})
