const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose'); // Database driver
const { OAuth2Client } = require('google-auth-library');

// --- CONFIGURATION ---
// 👇 PASTE YOUR MONGODB CONNECTION STRING INSIDE THE QUOTES BELOW 👇
const MONGO_URI = "mongodb+srv://admin:mongoose@cluster0.c1mtouj.mongodb.net/?appName=Cluster0"; 

const PORT = process.env.PORT || 7860;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const COOLDOWN_SECONDS = 5;
const GOOGLE_CLIENT_ID = "338224390635-cpfurodcu459640g1s5l675bkjkho170.apps.googleusercontent.com";

// --- SETUP ---
const app = express();
const server = http.createServer(app);
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- MONGODB SCHEMA ---
const CanvasSchema = new mongoose.Schema({
    _id: Number, 
    data: Buffer
});
const CanvasModel = mongoose.model('Canvas', CanvasSchema);

const HistorySchema = new mongoose.Schema({
    who: String,
    name: String,
    x: Number,
    y: Number,
    color: Number,
    time: Date
});
const HistoryModel = mongoose.model('History', HistorySchema);

// --- STATE ---
let canvasBuffer = Buffer.alloc(CANVAS_WIDTH * CANVAS_HEIGHT, 0);
const userCooldowns = new Map(); 

// --- CONNECT TO DATABASE ---
mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB Connected!");
        
        // Load existing canvas or create new
        const existing = await CanvasModel.findById(1);
        if (existing) {
            canvasBuffer = existing.data;
            console.log("🎨 Loaded canvas from Database.");
        } else {
            console.log("⬜ Creating new canvas in Database...");
            await new CanvasModel({ _id: 1, data: canvasBuffer }).save();
        }
    })
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- SOCKET LOGIC ---
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
  
  // Send Canvas from RAM (Fast)
  socket.emit('canvas-init', Array.from(canvasBuffer));

  // Check Cooldown
  const lastTime = userCooldowns.get(userEmail) || 0;
  const elapsed = (Date.now() - lastTime) / 1000;
  if (elapsed < COOLDOWN_SECONDS) {
      socket.emit('cooldown-sync', { remaining: Math.ceil(COOLDOWN_SECONDS - elapsed) });
  }

  socket.on('place-pixel', async ({ x, y, color }) => {
    if (x < 0 || x >= CANVAS_WIDTH || y < 0 || y >= CANVAS_HEIGHT) return;
    if (color < 0 || color > 15) return; 

    // Validate Cooldown
    const now = Date.now();
    const lastUserTime = userCooldowns.get(userEmail) || 0;
    if ((now - lastUserTime) / 1000 < COOLDOWN_SECONDS) {
        return; 
    }

    // Update RAM
    const index = (y * CANVAS_WIDTH) + x;
    canvasBuffer[index] = color;
    userCooldowns.set(userEmail, now);
    
    // Broadcast
    io.emit('pixel-update', { x, y, color });

    // Save History to DB (Async)
    HistoryModel.create({
        who: userEmail,
        name: socket.data.name,
        x, y, color,
        time: new Date()
    });
  });
});

// --- API ENDPOINTS ---
app.get('/api/history', async (req, res) => {
    const history = await HistoryModel.find().sort({ time: -1 }).limit(1000);
    res.json(history);
});

// --- AUTO-SAVE LOOP ---
// Save the RAM buffer to MongoDB every 10 seconds
setInterval(async () => {
    try {
        await CanvasModel.updateOne({ _id: 1 }, { data: canvasBuffer });
    } catch (e) {
        console.error("Auto-save failed:", e);
    }
}, 10000);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});