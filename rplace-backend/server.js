const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { OAuth2Client } = require("google-auth-library");

// --- CONFIGURATION ---
// TODO: PASTE YOUR GOOGLE CLIENT ID HERE
const GOOGLE_CLIENT_ID = "338224390635-cpfurodcu459640g1s5l675bkjkho170.apps.googleusercontent.com";
const ALLOWED_DOMAIN = "bitsathy.ac.in"; 

const PORT = 3001;
const CANVAS_SIZE = 480;
const COOLDOWN_MS = 30000; 
const SNAPSHOT_FILE = path.join(__dirname, "canvas.dat");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- STATE ---
let canvasBuffer;
const lastPlaceTime = new Map(); // Key: Email (String) -> Timestamp

// Load Canvas
try {
    canvasBuffer = fs.readFileSync(SNAPSHOT_FILE);
    console.log("Loaded existing canvas.");
} catch (e) {
    canvasBuffer = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE, 255);
    console.log("Created new blank canvas.");
}

// Auto-Save
setInterval(() => {
    fs.writeFile(SNAPSHOT_FILE, canvasBuffer, () => {});
}, 30000);

// --- MIDDLEWARE: AUTHENTICATION ---
// This runs BEFORE the connection is accepted
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("Authentication error: No token provided"));

        // Verify with Google
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email;

        // Domain Check
        // Note: For testing, you can comment this 'if' block out to allow gmail.com
        if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
            return next(new Error(`Access Denied: Must use a @${ALLOWED_DOMAIN} email.`));
        }

        // Attach email to socket for later use
        socket.userEmail = email;
        next();
    } catch (err) {
        console.log("Auth Failed:", err.message);
        next(new Error("Authentication failed"));
    }
});

// --- SOCKET LOGIC ---
io.on("connection", (socket) => {
    const userId = socket.userEmail; // We now use the verified Email
    console.log(`Connected: ${socket.id} | User: ${userId}`);

    socket.emit("canvas-init", canvasBuffer);

    // Sync Cooldown
    const lastTime = lastPlaceTime.get(userId) || 0;
    const now = Date.now();
    if (now - lastTime < COOLDOWN_MS) {
        socket.emit("cooldown-sync", { remaining: Math.ceil((COOLDOWN_MS - (now - lastTime)) / 1000) });
    }

    socket.on("place-pixel", ({ x, y, color }) => {
        // Validation
        if (!Number.isInteger(x) || x < 0 || x >= CANVAS_SIZE) return;
        if (!Number.isInteger(y) || y < 0 || y >= CANVAS_SIZE) return;
        if (!Number.isInteger(color) || color < 0 || color > 255) return;

        // Cooldown Check (Using Email)
        const currentNow = Date.now();
        const currentLastTime = lastPlaceTime.get(userId) || 0;
        
        if (currentNow - currentLastTime < COOLDOWN_MS) {
            const remaining = Math.ceil((COOLDOWN_MS - (currentNow - currentLastTime)) / 1000);
            socket.emit("cooldown-error", { message: `Wait ${remaining}s`, remaining });
            return;
        }

        // Execution
        const index = (y * CANVAS_SIZE) + x;
        canvasBuffer[index] = color;
        lastPlaceTime.set(userId, currentNow);

        io.emit("pixel-update", { x, y, color });
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});