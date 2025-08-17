let bubbles;
let score = 0;
let gameTime = 30; // seconds
let startTime;

function setup() {
  createCanvas(windowWidth, windowHeight);
  
  // Initialize bubble group
  bubbles = new Group();
  
  // Spawn some bubbles
  for (let i = 0; i < 20; i++) {
    spawnBubble();
  }
  
  startTime = millis();
}

function draw() {
  background(200, 230, 255);
  
  // Display and update bubbles
  for (let b of bubbles) {
    b.move();
    b.display();
  }
  
  // Timer
  let timeLeft = max(0, gameTime - floor((millis() - startTime) / 1000));
  
  // Display score and timer
  fill(0);
  textSize(24);
  text(`Score: ${score}`, 20, 40);
  text(`Time: ${timeLeft}`, 20, 70);
  
  // End game
  if (timeLeft <= 0) {
    noLoop();
    textSize(40);
    text("Game Over!", width / 2 - 100, height / 2);
  }
}

// Spawn a bubble at random location
function spawnBubble() {
  let b = new Sprite(random(width), random(height), random(40, 80));
  b.color = color(random(100,255), random(100,255), 255, 150);
  b.move = function() {
    this.vel.x = random(-1, 1);
    this.vel.y = random(-1, 1);
  }
  b.display = function() {
    circle(this.x, this.y, this.diameter);
  }
  bubbles.add(b);
}

// Pop bubble on tap/click
function mousePressed() {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    let b = bubbles[i];
    if (dist(mouseX, mouseY, b.x, b.y) < b.diameter / 2) {
      score++;
      b.remove();
      spawnBubble();
      break;
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function reset() {
  score = 0;
  gameTime = 30;
}