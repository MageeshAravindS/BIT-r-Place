import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { GoogleLogin } from '@react-oauth/google';
import { motion, AnimatePresence } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import { HexColorPicker } from "react-colorful";

// --- CONFIGURATION ---
const SOCKET_URL = "https://azinw-bit-place-backend.hf.space";
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 450;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 30;

const PALETTE = [
  '#FFFFFF', '#000000', '#FF4500', '#FFA800', '#FFD635', '#00A368', '#7EED56', '#2450A4',
  '#3690EA', '#51E9F4', '#811E9F', '#B44AC0', '#FF99AA', '#9C6926', '#898D90', '#D4D7D9',
];

// --- HELPERS ---
const hexToRgbObj = (hex) => {
  const bigint = parseInt(hex.slice(1), 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
};

const PALETTE_RGB = PALETTE.map(hex => {
  const rgb = hexToRgbObj(hex);
  return [rgb.r, rgb.g, rgb.b];
});

const findClosestPaletteIndex = (hex) => {
  const { r, g, b } = hexToRgbObj(hex);
  let minDistance = Infinity;
  let closestIndex = 0;

  for (let i = 0; i < PALETTE_RGB.length; i++) {
    const [pr, pg, pb] = PALETTE_RGB[i];
    const distance = Math.sqrt(
      Math.pow(r - pr, 2) + Math.pow(g - pg, 2) + Math.pow(b - pb, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  return closestIndex;
};

function App() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [socket, setSocket] = useState(null);

  // --- STATE ---
  const [authToken, setAuthToken] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [showIntro, setShowIntro] = useState(true); // Default to TRUE to show guide

  // UI State
  const [currentColorHex, setCurrentColorHex] = useState(PALETTE[1]);
  const [showPicker, setShowPicker] = useState(false);
  const [cooldownTimer, setCooldownTimer] = useState(0);
  const [pendingPixel, setPendingPixel] = useState(null); 

  // Interaction State
  const [hoverCoords, setHoverCoords] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [showGrid, setShowGrid] = useState(false);
  
  // Mouse Dragging
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  
  // Touch Long Press
  const longPressTimer = useRef(null);
  const isTouchInteraction = useRef(false);

  // --- SOCKET ---
  useEffect(() => {
    if (!authToken) return;
    if (socket) socket.close();

    const newSocket = io(SOCKET_URL, {
        auth: { token: authToken },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 5,
    });

    newSocket.on("connect_error", (err) => {
      if (err.message !== "xhr poll error") {
          setLoginError(err.message);
          toast.error(`Connection failed: ${err.message}`);
      }
    });

    newSocket.on("connect", () => console.log("✅ Connected!"));

    setSocket(newSocket);

    newSocket.on("canvas-init", (buffer) => {
      const ctx = canvasRef.current.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      const pixelData = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
      const imageData = ctx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
      const data = imageData.data;

      for (let i = 0; i < pixelData.length; i++) {
        const colorId = pixelData[i] < 0 || pixelData[i] >= PALETTE_RGB.length ? 0 : pixelData[i];
        const [r, g, b] = PALETTE_RGB[colorId];
        const idx = i * 4;
        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      toast.success("Canvas Synced!", { icon: '🔄', style: { background: '#333', color: '#fff' } });
    });

    newSocket.on("pixel-update", ({ x, y, color }) => {
      const ctx = canvasRef.current.getContext("2d");
      ctx.fillStyle = PALETTE[color];
      ctx.fillRect(x, y, 1, 1);
    });

    newSocket.on("cooldown-sync", ({ remaining }) => setCooldownTimer(remaining));
    newSocket.on("cooldown-error", (data) => {
        toast.error(data.message);
        setCooldownTimer(data.remaining);
    });

    return () => { newSocket.close(); setSocket(null); };
  }, [authToken]);

  useEffect(() => {
    if (cooldownTimer <= 0) return;
    const interval = setInterval(() => setCooldownTimer(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(interval);
  }, [cooldownTimer]);

  // --- CONTROLS ---

  // 1. IMPROVED WHEEL (Trackpad Pinch Support)
  const handleWheel = (e) => {
    e.preventDefault();
    // Trackpads usually trigger Ctrl+Wheel for pinch gestures
    // We adjust sensitivity based on that
    const isPinch = e.ctrlKey;
    const scaleFactor = isPinch ? 0.01 : 0.001;
    
    const scaleAmount = -e.deltaY * scaleFactor;
    const newScale = Math.min(Math.max(transform.k * (1 + scaleAmount), MIN_ZOOM), MAX_ZOOM);
    setTransform(prev => ({ ...prev, k: newScale }));
  };

  // 2. MOUSE DOWN (Left Click Check)
  const handleMouseDown = (e) => {
    // Ignore Right Click (2) or Middle Click (1)
    if (e.button !== 0) return; 

    if (e.target.closest('.react-colorful') || e.target.closest('button') || e.target.closest('.modal-overlay')) return;
    
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    isTouchInteraction.current = false;
  };

  // 3. MOUSE UP (Click vs Drag)
  const handleMouseUp = (e) => {
    // Strict Left Click Only
    if (e.button !== 0) return;

    if (isDragging) {
        setIsDragging(false);
        const dist = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
        // If moved less than 5px, it's a click. 
        // We only allow this if it wasn't a touch interaction (handled separately)
        if (dist < 5 && !isTouchInteraction.current) {
             initiatePixelPlacement(e);
        }
    }
  };

  // 4. MOUSE MOVE (Panning)
  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });

    if (isDragging) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        dragStart.current = { x: e.clientX, y: e.clientY };
        return;
    }

    // Hover Calculation
    if(!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    if (x >= 0 && x < CANVAS_WIDTH && y >= 0 && y < CANVAS_HEIGHT) {
        setHoverCoords({ x, y });
    } else {
        setHoverCoords(null);
    }
  };

  // 5. TOUCH CONTROLS (Long Press Logic)
  const handleTouchStart = (e) => {
      if (e.touches.length > 1) return; // Ignore multi-touch (pinch)
      isTouchInteraction.current = true;
      setIsDragging(true); // Allow panning immediately
      
      const touch = e.touches[0];
      dragStart.current = { x: touch.clientX, y: touch.clientY };

      // Update hover coords immediately for the long press target
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const x = Math.floor((touch.clientX - rect.left) * scaleX);
      const y = Math.floor((touch.clientY - rect.top) * scaleY);

      if (x >= 0 && x < CANVAS_WIDTH && y >= 0 && y < CANVAS_HEIGHT) {
        setHoverCoords({ x, y });
        // Start Long Press Timer (500ms)
        longPressTimer.current = setTimeout(() => {
            setIsDragging(false); // Stop panning
            initiatePixelPlacement(); // Trigger placement
            if(navigator.vibrate) navigator.vibrate(50); // Haptic feedback
        }, 500);
      }
  };

  const handleTouchMove = (e) => {
      // If user moves finger > 10px, cancel the long press (it's a pan)
      const touch = e.touches[0];
      const dist = Math.hypot(touch.clientX - dragStart.current.x, touch.clientY - dragStart.current.y);
      
      if (dist > 10) {
          clearTimeout(longPressTimer.current);
          handleMouseMove(e.touches[0]); // Delegate to standard pan logic
      }
  };

  const handleTouchEnd = () => {
      clearTimeout(longPressTimer.current); // Cancel timer on release
      setIsDragging(false);
  };

  // --- ACTIONS ---
  const initiatePixelPlacement = () => {
    if (!socket || !hoverCoords) return;
    if (cooldownTimer > 0) {
        toast.error(`Cooldown! Wait ${cooldownTimer}s`, { id: 'cooldown-toast' });
        return;
    }
    const colorIdx = findClosestPaletteIndex(currentColorHex);
    setPendingPixel({ x: hoverCoords.x, y: hoverCoords.y, colorIdx, colorHex: currentColorHex });
  };

  const confirmPlacement = () => {
      if (!pendingPixel || !socket) return;
      const { x, y, colorIdx, colorHex } = pendingPixel;

      const ctx = canvasRef.current.getContext("2d");
      ctx.fillStyle = colorHex;
      ctx.fillRect(x, y, 1, 1);

      socket.emit("place-pixel", { x, y, color: colorIdx });
      setCooldownTimer(30);
      toast.success("Pixel Placed!", { duration: 1000, icon: '🎨' });
      setPendingPixel(null);
  };

  // --- RENDER ---
  const handleLoginSuccess = (res) => { setAuthToken(res.credential); setLoginError(null); };

  if (!authToken) {
    return (
        <div style={styles.loginContainer}>
            <Toaster position="bottom-center" toastOptions={styles.toastOptions} />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={styles.loginCard}>
                <h1 style={styles.title}>BIT PLACE</h1>
                <p style={styles.subtitle}>Collaborative Canvas for BIT Sathy</p>
                <div style={styles.googleBtnWrapper}>
                    <GoogleLogin onSuccess={handleLoginSuccess} onError={() => setLoginError("Login Failed")} theme="filled_black" shape="pill" />
                </div>
                {loginError && <div style={styles.errorBox}>{loginError}</div>}
            </motion.div>
            <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 90, 0] }} transition={{ duration: 20, repeat: Infinity }} style={styles.blob} />
        </div>
    );
  }

  const aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;

  return (
    <div style={styles.appContainer}>
      <Toaster position="bottom-center" toastOptions={styles.toastOptions} />

      {/* HEADER */}
      <motion.div initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} style={styles.header}>
        <div style={styles.logoGroup}>
            <h2 style={styles.logoText}>BIT PLACE</h2>
            <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                <button onClick={() => setShowPicker(!showPicker)} style={{...styles.btn, background: showPicker ? '#3b82f6' : '#333', color: showPicker ? 'white' : '#888'}}># COLOR</button>
                <button onClick={() => setShowGrid(!showGrid)} style={{...styles.btn, background: showGrid ? '#3b82f6' : '#333', color: showGrid ? 'white' : '#888'}}># GRID</button>
                <button onClick={() => setTransform({x:0, y:0, k:1})} style={styles.btn}>↺ RESET VIEW</button>
                <button onClick={() => setShowIntro(true)} style={styles.btn}>?</button> 
            </div>
        </div>

        <div style={styles.palette}>
          {PALETTE.slice(0, 10).map((hex, idx) => (
            <motion.div key={idx} onClick={() => setCurrentColorHex(hex)}
              whileHover={{ scale: 1.2, y: -2 }} whileTap={{ scale: 0.9 }}
              style={{ ...styles.colorSwatch, backgroundColor: hex, border: currentColorHex.toUpperCase() === hex ? '2px solid white' : '1px solid rgba(255,255,255,0.1)', boxShadow: currentColorHex.toUpperCase() === hex ? `0 0 10px ${hex}` : 'none' }}
            />
          ))}
        </div>

        <motion.div animate={{ backgroundColor: cooldownTimer > 0 ? '#450a0a' : '#052e16', color: cooldownTimer > 0 ? '#fca5a5' : '#4ade80', scale: cooldownTimer > 0 ? 1 : [1, 1.05, 1] }} style={styles.timerBadge}>
          {cooldownTimer > 0 ? `${cooldownTimer}s` : "READY"}
        </motion.div>
      </motion.div>

      {/* WELCOME / CONTROLS MODAL */}
      <AnimatePresence>
        {showIntro && (
            <div style={styles.modalOverlay}>
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} style={styles.introCard}>
                    <h2 style={styles.modalTitle}>WELCOME TO BIT PLACE</h2>
                    <div style={styles.controlsList}>
                        <div style={styles.controlItem}>
                            <span>🖱️</span> <strong>Left Click + Drag</strong> to PAN
                        </div>
                        <div style={styles.controlItem}>
                            <span>🔍</span> <strong>Scroll / Pinch</strong> to ZOOM
                        </div>
                        <div style={styles.controlItem}>
                            <span>🎨</span> <strong>Left Click</strong> to PLACE
                        </div>
                        <div style={styles.controlItem}>
                            <span>📱</span> <strong>Touch & Hold</strong> to PLACE (Mobile)
                        </div>
                    </div>
                    <button onClick={() => setShowIntro(false)} style={styles.confirmBtn}>START CREATING</button>
                </motion.div>
            </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPicker && (
            <motion.div initial={{ opacity: 0, y: -20, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20, scale: 0.9 }} style={styles.floatingPicker}>
                <HexColorPicker color={currentColorHex} onChange={setCurrentColorHex} />
            </motion.div>
        )}
      </AnimatePresence>

      {/* CONFIRMATION MODAL */}
      <AnimatePresence>
        {pendingPixel && (
            <div style={styles.modalOverlay} className="modal-overlay">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} style={styles.modalBox}>
                    <h3 style={styles.modalTitle}>Confirm Pixel?</h3>
                    <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', justifyContent: 'center'}}>
                        <div style={{width: '30px', height: '30px', background: pendingPixel.colorHex, border: '2px solid white', borderRadius: '4px'}}></div>
                        <span>at ({pendingPixel.x}, {pendingPixel.y})</span>
                    </div>
                    <div style={styles.modalButtons}>
                        <button onClick={() => setPendingPixel(null)} style={styles.cancelBtn}>CANCEL</button>
                        <button onClick={confirmPlacement} style={styles.confirmBtn}>CONFIRM</button>
                    </div>
                </motion.div>
            </div>
        )}
      </AnimatePresence>

      <div 
        ref={containerRef} 
        style={styles.canvasContainer} 
        onWheel={handleWheel} 
        onMouseDown={handleMouseDown} 
        onMouseUp={handleMouseUp} 
        onMouseMove={handleMouseMove} 
        onMouseLeave={() => { setIsDragging(false); setHoverCoords(null); }}
        
        // Touch Events
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 120, damping: 15 }} style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{
                ...styles.canvasWrapper,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
                aspectRatio: aspectRatio, 
                width: 'auto', height: '85vmin',
                cursor: isDragging ? 'grabbing' : (cooldownTimer > 0 ? 'not-allowed' : 'crosshair')
            }}>
                <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={styles.canvas} />
                {showGrid && (
                    <svg width="100%" height="100%" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} xmlns="http://www.w3.org/2000/svg" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}>
                        <defs>
                            <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
                                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="0.05"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                )}
                {hoverCoords && !isDragging && !pendingPixel && (
                    <div style={{
                        position: 'absolute',
                        left: `${(hoverCoords.x / CANVAS_WIDTH) * 100}%`,
                        top: `${(hoverCoords.y / CANVAS_HEIGHT) * 100}%`,
                        width: `${(1 / CANVAS_WIDTH) * 100}%`,
                        height: `${(1 / CANVAS_HEIGHT) * 100}%`,
                        pointerEvents: 'none', zIndex: 10, boxSizing: 'border-box',
                        border: `${1 / transform.k}px solid black`, boxShadow: `0 0 0 ${1 / transform.k}px white`
                    }} />
                )}
            </div>
        </motion.div>
      </div>
    </div>
  );
}

const styles = {
    fontImport: "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Press+Start+2P&display=swap');",
    toastOptions: { style: { background: '#222', color: '#fff', border: '1px solid #444', fontFamily: '"Inter", sans-serif' }, containerStyle: { zIndex: 99999 } },
    loginContainer: { height: '100vh', width: '100vw', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#0f0f0f', color: 'white', fontFamily: '"Inter", sans-serif', overflow: 'hidden', position: 'relative' },
    loginCard: { background: 'rgba(20, 20, 20, 0.8)', padding: '40px 60px', borderRadius: '20px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', zIndex: 10, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' },
    title: { fontFamily: '"Press Start 2P", cursive', fontSize: '2.5rem', marginBottom: '10px', background: 'linear-gradient(to right, #4ade80, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    subtitle: { color: '#888', marginBottom: '30px' },
    blob: { position: 'absolute', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(29,78,216,0.15) 0%, rgba(0,0,0,0) 70%)', borderRadius: '50%', zIndex: 0 },
    errorBox: { marginTop: '20px', color: '#ff6b6b', fontSize: '0.9rem', padding: '10px', background: 'rgba(255,0,0,0.1)', borderRadius: '5px' },
    appContainer: { height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#111', fontFamily: '"Inter", sans-serif', overflow: 'hidden', userSelect: 'none', position: 'relative' },
    header: { position: 'fixed', top: 0, left: 0, width: '100%', boxSizing: 'border-box', padding: '15px 30px', background: 'rgba(25, 25, 25, 0.9)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 100, boxShadow: '0 4px 30px rgba(0,0,0,0.3)' },
    logoGroup: { display: 'flex', flexDirection: 'column', gap: '5px' },
    logoText: { fontFamily: '"Press Start 2P", cursive', margin: 0, fontSize: '1rem', color: '#fff' },
    btn: { background: '#333', border: '1px solid #444', color: '#aaa', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold', transition: 'all 0.2s' },
    floatingPicker: { position: 'fixed', top: '85px', left: '160px', zIndex: 200 },
    palette: { display: 'flex', gap: '6px', background: '#222', padding: '6px', borderRadius: '10px', border: '1px solid #333' },
    colorSwatch: { width: '24px', height: '24px', borderRadius: '50%', cursor: 'pointer' },
    timerBadge: { padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem', fontFamily: 'monospace', border: '1px solid rgba(255,255,255,0.05)' },
    canvasContainer: { flex: 1, marginTop: '80px', overflow: 'hidden', background: 'radial-gradient(circle at center, #222 0%, #111 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1, touchAction: 'none' }, // Added touchAction none
    canvasWrapper: { position: 'relative', boxShadow: '0 0 50px rgba(0,0,0,0.5)', backgroundColor: '#fff', transition: 'transform 0.05s ease-out' },
    canvas: { display: 'block', width: '100%', height: '100%', imageRendering: 'pixelated', background: 'white' },
    modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
    modalBox: { background: '#222', border: '2px solid #444', borderRadius: '12px', padding: '30px', textAlign: 'center', color: 'white', boxShadow: '0 20px 50px rgba(0,0,0,0.8)', fontFamily: '"Press Start 2P", cursive' },
    modalTitle: { marginTop: 0, color: '#4ade80', fontSize: '1rem', marginBottom: '20px' },
    modalButtons: { display: 'flex', gap: '20px', marginTop: '20px', justifyContent: 'center' },
    confirmBtn: { background: '#3b82f6', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 'bold' },
    cancelBtn: { background: 'transparent', color: '#888', border: '1px solid #888', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem' },
    
    // INTRO CARD STYLES
    introCard: { background: '#1a1a1a', border: '1px solid #333', borderRadius: '16px', padding: '40px', maxWidth: '500px', width: '90%', textAlign: 'center', color: 'white', boxShadow: '0 25px 60px rgba(0,0,0,0.9)' },
    controlsList: { textAlign: 'left', margin: '30px 0', display: 'flex', flexDirection: 'column', gap: '15px', fontSize: '0.9rem', color: '#ccc' },
    controlItem: { display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }
};

export default App;