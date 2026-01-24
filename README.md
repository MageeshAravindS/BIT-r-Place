# 🎨 BIT Place (r/place Clone)

A massive multiplayer collaborative pixel art canvas, inspired by Reddit's r/place. Built to handle real-time concurrency with a highly optimized binary storage engine and a fluid, "cyber-aesthetic" frontend.

<img width="1886" height="969" alt="image" src="https://github.com/user-attachments/assets/3553fbf8-c100-4bf2-a897-ed372d853293" />


## ✨ Features

### 🚀 Core Mechanics
- **Real-Time Collaboration:** Instant pixel updates using **Socket.io**.
- **Binary State Management:** The entire canvas is stored as a raw `Buffer` (1 byte per pixel), allowing for extremely fast initial load times (sending a 230KB binary file instead of multi-megabyte JSON).
- **Persistence:** Automatic snapshots save the canvas state to disk (`canvas.dat`) to survive server restarts.

### 🛡️ Security & Anti-Abuse
- **Google OAuth 2.0 Gate:** Restricts access to specific email domains (e.g., `@bitsathy.ac.in`).
- **Server-Side Cooldowns:** strict 30s timer enforced by User ID (not just IP), preventing refresh-spam attacks.
- **Smart Token Auth:** Uses JWT-based tokens to maintain session identity across reloads.

### 🎨 UI & UX
- **Infinite Canvas:** Google Maps-style **Zoom & Pan** navigation using `Matrix Transforms`.
- **Adaptive Grid:** An SVG-based pixel grid that automatically fades in at high zoom levels.
- **Precision Reticle:** A smart cursor that counter-scales its borders to remain 1px thick at any zoom level.
- **Advanced Color Picker:** Includes a floating Hex Color Picker (`react-colorful`) with **Nearest Neighbor Color Matching** to map millions of colors to the backend's 16-color optimized palette.
- **Aesthetic Animations:** Powered by `Framer Motion` for buttery smooth entrance and interaction effects.

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- Socket.io Client
- HTML5 Canvas API (Pixel manipulation)
- Framer Motion (Animations)
- React Hot Toast (Notifications)

**Backend:**
- Node.js & Express
- Socket.io (WebSockets)
- Google Auth Library (Verification)
- In-memory Buffer (Storage)

## 📦 Installation & Setup

### Prerequisites
- Node.js (v16+)
- A Google Cloud Project with OAuth 2.0 Client ID.

### 1. Clone the Repository
```bash
git clone [https://github.com/your-username/bit-place.git](https://github.com/your-username/bit-place.git)
cd bit-place
