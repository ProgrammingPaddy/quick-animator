rect3 = Rect({
  x: -9,
  y: 225,
  width: 240,
  height: 140,
  fill: '#4f8cff',
  until: 3,
  class: 'adw',
})

circle2 = Circle({
  x: 198,
  y: 111,
  radius: 60,
  fill: '#f59e0b',
  until: 2.5,
  class: 'adw',
})

group1 = Group({
  members: 'circle2 rect3',
})

group1.move({
  x: -78,
  y: -186,
  at: 0,
  duration: 1,
})

all('adw').move({
  x: -9,
  y: 225,
  at: 0.8333,
  duration: 1,
})
