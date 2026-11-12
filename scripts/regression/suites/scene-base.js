backdrop = Rect({
  width: 1920,
  height: 1080,
  fill: '#24324a',
})

title = Text({
  text: 'Quick Animator',
  fontSize: 120,
  y: 120,
})

bar1 = Rect({
  x: -300,
  y: -150,
  width: 400,
  height: 80,
  fill: '#f59e0b',
  class: 'bar',
})

bar2 = Rect({
  x: 300,
  y: -150,
  width: 400,
  height: 80,
  fill: '#4f8cff',
  class: 'bar',
})

logo = Circle({
  x: 0,
  y: -350,
  radius: 90,
  fill: '#ec4899',
})

spot = Circle({
  x: 0,
  y: 0,
  radius: 300,
  masks: 'below except backdrop',
})

badge = Rect({
  x: 700,
  y: 400,
  width: 200,
  height: 100,
  fill: '#10b981',
})

spot.move({
  x: 400,
  duration: 2,
})
