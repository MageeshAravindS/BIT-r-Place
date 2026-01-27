const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 7860;
const GOOGLE_CLIENT_ID = "338224390635-cpfurodcu459640g1s5l675bkjkho170.apps.googleusercontent.com";
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const DATA_FILE = path.join(__dirname, 'canvas_v4.dat');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// --- COOLDOWN SETTING (5 Seconds) ---
const COOLDOWN_SECONDS = 5;

// --- STATE ---
let canvasBuffer;
let historyLog = [];
const userCooldowns = new Map(); 

if (fs.existsSync(DATA_FILE)) {
  canvasBuffer = fs.readFileSync(DATA_FILE);
  console.log("🎨 Loaded canvas.");
} else {
  canvasBuffer = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT, 0);
  console.log("⬜ Created new canvas.");
}

if (fs.existsSync(HISTORY_FILE)) {
  try {
    historyLog = JSON.parse(fs.readFileSync(HISTORY_FILE));
  } catch (e) { historyLog = []; }
}

// --- MIDDLEWARE ---
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication token missing"));

  try {
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    socket.data.email = payload.email;
    socket.data.name = payload.name;
    next();
  } catch (err) {
    next(new Error("Invalid Google Token"));
  }
});

io.on('connection', (socket) => {
  const userEmail = socket.data.email;
  console.log(`👤 Connected: ${userEmail}`);

  // 1. SEND CANVAS
  socket.emit('canvas-init', Array.from(canvasBuffer));

  // 2. CHECK COOLDOWN ON CONNECTION
  const lastTime = userCooldowns.get(userEmail) || 0;
  const elapsed = (Date.now() - lastTime) / 1000;
  
  if (elapsed < COOLDOWN_SECONDS) {
      const remaining = Math.ceil(COOLDOWN_SECONDS - elapsed);
      socket.emit('cooldown-sync', { remaining });
  }

  socket.on('place-pixel', ({ x, y, color }) => {
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return;
    if (color < 0 || color > 15) return; 

    // 3. VALIDATE COOLDOWN
    const now = Date.now();
    const lastUserTime = userCooldowns.get(userEmail) || 0;
    const timeDiff = (now - lastUserTime) / 1000;

    if (timeDiff < COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(COOLDOWN_SECONDS - timeDiff);
        socket.emit('cooldown-error', { 
            message: `Wait ${waitTime}s!`, 
            remaining: waitTime 
        });
        return; 
    }

    // 4. PLACE PIXEL
    const index = (y * CANVAS_WIDTH) + x;
    canvasBuffer[index] = color;
    userCooldowns.set(userEmail, now);

    io.emit('pixel-update', { x, y, color });

    // 5. LOG HISTORY
    const entry = {
        who: userEmail,
        name: socket.data.name,
        x, y, color,
        time: new Date().toISOString()
    };
    historyLog.push(entry);
    if (historyLog.length > 10000) historyLog.shift();
  });
});

app.get('/api/history', (req, res) => {
    res.json(historyLog.reverse());
});

setInterval(() => {
  fs.writeFile(DATA_FILE, canvasBuffer, () => {});
  fs.writeFile(HISTORY_FILE, JSON.stringify(historyLog, null, 2), () => {});
}, 5000); 

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});