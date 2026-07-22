// Global State
let state = {
    timeOfDay: 'day',      // 'day' | 'night'
    frequency: 14.0,       // MHz (2.0 - 30.0)
    angle: 30,             // degrees (5 - 85)
    solarActivity: 70,     // SSN (10 - 200)
    activeTab: 'simulator', // 'simulator' | 'guide'
    rxAngle: -Math.PI/2 + 0.15, // Receiver angular position
    highlightedLayer: null  // For educational panel highlights
};

// Physics Constants & Geometry Settings
const Cx_offset = 0;      // Earth center X offset relative to canvas center
const R_earth = 1100;     // Earth radius in pixels
let Cx, Cy;               // Earth center coordinate (calculated dynamically)
let txAngle = -Math.PI/2 - 0.2; // Transmitter angular position (fixed to the left)
let txX, txY;             // Transmitter coordinates

// Canvas Setup
const canvas = document.getElementById('simulation-canvas');
const ctx = canvas.getContext('2d');

// UI Element References
const freqSlider = document.getElementById('freq-slider');
const freqVal = document.getElementById('freq-val');
const angleSlider = document.getElementById('angle-slider');
const angleVal = document.getElementById('angle-val');
const solarSlider = document.getElementById('solar-slider');
const solarVal = document.getElementById('solar-val');

const telemetryOutcome = document.getElementById('signal-outcome');
const telemetryOutcomeDesc = document.getElementById('outcome-desc');
const telemetryLayer = document.getElementById('refracting-layer');
const telemetrySkip = document.getElementById('skip-distance');
const telemetryCritFreq = document.getElementById('crit-freq');
const telemetryMuf = document.getElementById('muf-val');

// Initialize Application
function init() {
    setupEventListeners();
    resizeCanvas();
    updateTelemetry();
    requestAnimationFrame(animationLoop);
}

// Window Resize Handling
function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // Recalculate Earth center based on canvas size
    // We want the top of the Earth to be about 100px above the bottom of the canvas
    Cx = rect.width / 2 + Cx_offset;
    Cy = rect.height + R_earth - 110;

    // Recalculate Transmitter coordinates
    txX = Cx + R_earth * Math.cos(txAngle);
    txY = Cy + R_earth * Math.sin(txAngle);
}

// Event Listeners Setup
function setupEventListeners() {
    window.addEventListener('resize', resizeCanvas);

    // Inputs
    freqSlider.addEventListener('input', (e) => {
        state.frequency = parseFloat(e.target.value);
        freqVal.textContent = `${state.frequency.toFixed(1)} MHz`;
        updateTelemetry();
    });

    angleSlider.addEventListener('input', (e) => {
        state.angle = parseInt(e.target.value);
        angleVal.textContent = `${state.angle}°`;
        updateTelemetry();
    });

    solarSlider.addEventListener('input', (e) => {
        state.solarActivity = parseInt(e.target.value);
        let status = 'Medium';
        if (state.solarActivity < 40) status = 'Low (Solar Min)';
        else if (state.solarActivity > 130) status = 'High (Solar Max)';
        solarVal.textContent = `${status} (SSN ${state.solarActivity})`;
        updateTelemetry();
    });

    // Mouse/Touch Drag for Receiver
    let isDragging = false;

    function handlePointerMove(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
        const clientY = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
        
        // Calculate angle relative to Earth center
        const angle = Math.atan2(clientY - (Cy / (window.devicePixelRatio || 1)), clientX - (Cx / (window.devicePixelRatio || 1)));
        
        // Clamp receiver angle so it stays on the right side of transmitter
        const minAngle = txAngle + 0.02;
        const maxAngle = -Math.PI/2 + 0.6;
        if (angle > minAngle && angle < maxAngle) {
            state.rxAngle = angle;
        }
    }

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        handlePointerMove(e);
    });

    window.addEventListener('mousemove', (e) => {
        if (isDragging) handlePointerMove(e);
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    canvas.addEventListener('touchstart', (e) => {
        isDragging = true;
        handlePointerMove(e);
    });

    window.addEventListener('touchmove', (e) => {
        if (isDragging) handlePointerMove(e);
    });

    window.addEventListener('touchend', () => {
        isDragging = false;
    });
}

// Tab Switching
function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    
    if (tabId === 'simulator') {
        document.getElementById('tab-btn-simulator').classList.add('active');
        document.getElementById('simulator-tab').classList.remove('hidden');
    } else {
        document.getElementById('tab-btn-guide').classList.add('active');
        document.getElementById('guide-tab').classList.remove('hidden');
    }
}

// Day / Night Setter
function setTimeOfDay(time) {
    state.timeOfDay = time;
    document.getElementById('day-btn').classList.remove('active');
    document.getElementById('night-btn').classList.remove('active');
    
    if (time === 'day') {
        document.getElementById('day-btn').classList.add('active');
    } else {
        document.getElementById('night-btn').classList.add('active');
    }
    updateTelemetry();
}

// Highlight layers from side panel clicks
function highlightLayer(layerName) {
    if (state.highlightedLayer === layerName) {
        state.highlightedLayer = null;
        document.querySelectorAll('.layer-card').forEach(c => c.classList.remove('active-layer'));
    } else {
        state.highlightedLayer = layerName;
        document.querySelectorAll('.layer-card').forEach(c => c.classList.remove('active-layer'));
        document.getElementById(`layer-card-${layerName}`).classList.add('active-layer');
    }
}

// Ionospheric Physics Calculations
// Returns the plasma frequency in MHz at a given altitude
function getPlasmaFrequency(alt, solarActivity, timeOfDay) {
    let fpSq = 0;
    const solarFactor = solarActivity / 70; // normalize around medium

    // Define Layer parameters: [peakAltitude, criticalFreq, layerWidth]
    let layers = [];

    if (timeOfDay === 'day') {
        // E-Layer: peak 110km, fc ~2.5 to 4 MHz
        layers.push({ peak: 115, fc: 2.2 + 1.2 * solarFactor, width: 15 });
        // F1-Layer: peak 180km, fc ~3.5 to 5.5 MHz
        layers.push({ peak: 185, fc: 3.5 + 1.5 * solarFactor, width: 22 });
        // F2-Layer: peak 270km, fc ~5.5 to 11 MHz
        layers.push({ peak: 280, fc: 5.2 + 5.0 * solarFactor, width: 45 });
    } else {
        // Nighttime: D & E decay, F1 and F2 merge into a single F-layer
        // Residual E-layer (extremely weak)
        layers.push({ peak: 115, fc: 0.35, width: 12 });
        // F-Layer: peak 250km, fc ~2.5 to 5.5 MHz
        layers.push({ peak: 260, fc: 2.5 + 2.5 * solarFactor, width: 50 });
    }

    for (let layer of layers) {
        let diff = alt - layer.peak;
        let expTerm = Math.exp(-(diff * diff) / (2 * layer.width * layer.width));
        fpSq += (layer.fc * layer.fc) * expTerm;
    }

    return Math.sqrt(fpSq);
}

// Identify layer name at a specific altitude
function getLayerName(alt, timeOfDay) {
    if (alt >= 55 && alt < 90) return 'D';
    if (alt >= 90 && alt < 140) return 'E';
    if (timeOfDay === 'day') {
        if (alt >= 140 && alt < 210) return 'F1';
        if (alt >= 210 && alt < 380) return 'F2';
    } else {
        if (alt >= 140 && alt < 380) return 'F (Night)';
    }
    return 'None';
}

// Ray Tracing Routine
// Calculates coordinates and details of a single ray path
function traceRay(elevationAngle, freq, solarActivity, timeOfDay) {
    let x = txX;
    let y = txY;
    let theta = elevationAngle * Math.PI / 180;
    
    // Bouguer's Law Invariant for Spherical Geometry: mu * r * cos(phi) = const
    // At start: alt = 0, r = R_earth, mu = 1.
    let constVal = R_earth * Math.cos(theta);
    
    let radAngle = txAngle;
    let localHorizAngle = radAngle + Math.PI/2;
    let absAngle = localHorizAngle - theta; // Absolute angle in canvas (y-down) coords
    
    let path = [{ x: x, y: y, intensity: 1.0, alt: 0 }];
    let intensity = 1.0;
    let isUpward = true;
    let status = "escaped";
    let refractionLayer = "None";
    let skipDist = 0;
    let hops = 0;
    
    const stepSize = 3.5;
    const maxSteps = 500;
    
    for (let step = 0; step < maxSteps; step++) {
        // Compute proposed position
        let nextX = x + stepSize * Math.cos(absAngle);
        let nextY = y + stepSize * Math.sin(absAngle);
        
        let dx = nextX - Cx;
        let dy = nextY - Cy;
        let dist = Math.sqrt(dx*dx + dy*dy);
        let alt = dist - R_earth;
        
        // Earth intersection
        if (alt <= 0 && step > 8) {
            hops++;
            // Calculate coordinates of ground strike
            let normalAngle = Math.atan2(dy, dx);
            x = Cx + R_earth * Math.cos(normalAngle);
            y = Cy + R_earth * Math.sin(normalAngle);
            
            // Reflect: angle of reflection equals angle of incidence relative to local tangent
            absAngle = 2 * normalAngle - absAngle + Math.PI;
            
            // Adjust loop parameters for reflection
            radAngle = normalAngle;
            localHorizAngle = radAngle + Math.PI/2;
            let relAngle = absAngle - localHorizAngle;
            theta = relAngle;
            constVal = R_earth * Math.cos(theta);
            isUpward = true;
            
            // Reflected signal loss
            intensity *= 0.65;
            
            path.push({ x: x, y: y, intensity: intensity, alt: 0 });
            
            if (intensity < 0.1) {
                status = "attenuated";
                break;
            }
            continue;
        }
        
        // Update positions
        x = nextX;
        y = nextY;
        
        // Check D-layer absorption (Daytime, alt 60-90km)
        if (timeOfDay === 'day' && alt >= 55 && alt <= 90) {
            // D-layer absorption rate increases at lower frequencies
            let absorptionFactor = (0.014 * (solarActivity / 70)) / (freq * freq);
            intensity -= absorptionFactor;
            if (intensity <= 0.05) {
                intensity = 0;
                status = "absorbed";
                path.push({ x: x, y: y, intensity: intensity, alt: alt });
                break;
            }
        }
        
        // Calculate plasma frequency
        let fp = getPlasmaFrequency(alt, solarActivity, timeOfDay);
        let muSq = 1.0 - (fp * fp) / (freq * freq);
        let mu = muSq > 0 ? Math.sqrt(muSq) : 0;
        
        // Bouguer reflection/refraction check
        let refractionTrigger = (mu * dist < constVal) || (mu === 0);
        
        if (refractionTrigger && isUpward) {
            isUpward = false;
            refractionLayer = getLayerName(alt, timeOfDay);
            status = "refracted";
        }
        
        // Calculate new ray direction
        radAngle = Math.atan2(dy, dx);
        let cosPhi = constVal / (mu * dist);
        // Clamp to avoid numerical float errors
        if (cosPhi > 1) cosPhi = 1;
        if (cosPhi < -1) cosPhi = -1;
        
        let phi = Math.acos(cosPhi);
        let relAngle = isUpward ? phi : -phi;
        
        // Update canvas absolute angle
        absAngle = radAngle + Math.PI/2 - relAngle;
        
        path.push({ x: x, y: y, intensity: intensity, alt: alt });
        
        // If ray goes too high into deep space
        if (alt > 400) {
            status = "escaped";
            break;
        }
    }
    
    return {
        path: path,
        status: status,
        refractionLayer: refractionLayer,
        intensity: intensity,
        hops: hops
    };
}

// Update Telemetry Display
function updateTelemetry() {
    // 1. Critical Frequency (foF2)
    const solarFactor = state.solarActivity / 70;
    const f_critical = state.timeOfDay === 'day' 
        ? (5.2 + 5.0 * solarFactor) 
        : (2.5 + 2.5 * solarFactor);
    
    telemetryCritFreq.textContent = `${f_critical.toFixed(2)} MHz`;
    
    // 2. Maximum Usable Frequency (MUF) for the current elevation angle
    // MUF = f_critical / sin(elevationAngle)
    const angleRad = state.angle * Math.PI / 180;
    const muf = f_critical / Math.sin(angleRad);
    telemetryMuf.textContent = `${muf.toFixed(1)} MHz`;
    
    // 3. Lowest Usable Frequency (LUF) - D-layer absorption limit
    const luf = state.timeOfDay === 'day' 
        ? (1.8 + 2.5 * solarFactor) 
        : 1.0;
        
    // 4. Trace the primary ray and calculate skip/outcome
    const primaryRay = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
    
    // Calculate skip distance: find where the first skywave lands
    let firstLandX = null;
    let firstLandAngle = null;
    
    for (let pt of primaryRay.path) {
        if (pt.alt === 0 && pt.x !== txX) {
            firstLandX = pt.x;
            firstLandAngle = Math.atan2(pt.y - Cy, pt.x - Cx);
            break;
        }
    }
    
    if (firstLandAngle !== null) {
        // Angular distance in kilometers (approx 1 deg = 111km on Earth)
        let deltaAngle = firstLandAngle - txAngle;
        if (deltaAngle < 0) deltaAngle += 2 * Math.PI;
        let km = deltaAngle * 6371; // Earth radius in km
        telemetrySkip.textContent = `${Math.round(km)} km`;
    } else {
        telemetrySkip.textContent = `-- km`;
    }

    // Set Refracting Layer
    telemetryLayer.textContent = primaryRay.status === 'refracted' ? `${primaryRay.refractionLayer} Layer` : 'None';

    // 5. Determine Receiver status
    // Receiver angular position relative to TX
    let rxDeltaAngle = state.rxAngle - txAngle;
    if (rxDeltaAngle < 0) rxDeltaAngle += 2 * Math.PI;
    const rxDistanceKm = rxDeltaAngle * 6371;
    
    // Ground Wave Limit is around 120km at HF
    const groundWaveLimit = 120;
    
    let receiverStatus = "No Signal";
    let receiverDesc = "The receiver is out of range.";
    let outcomeColor = "var(--text-secondary)";
    
    // Detailed analysis of outcomes
    if (state.frequency < luf && state.timeOfDay === 'day') {
        receiverStatus = "Absorbed (D-Layer)";
        receiverDesc = `At ${state.frequency.toFixed(1)} MHz, the frequency is below the LUF (${luf.toFixed(1)} MHz). The D-Layer absorbs it completely.`;
        outcomeColor = "var(--accent-red)";
    } else if (primaryRay.status === 'escaped' && state.angle > 45) {
        receiverStatus = "Space Escape (Steep Angle)";
        receiverDesc = `At ${state.angle}°, the elevation angle is too steep. The wave penetrates the ionosphere and escapes.`;
        outcomeColor = "var(--accent-amber)";
    } else if (state.frequency > muf) {
        receiverStatus = "Space Escape (Above MUF)";
        receiverDesc = `The frequency (${state.frequency.toFixed(1)} MHz) is higher than the MUF (${muf.toFixed(1)} MHz). Wave escapes into space.`;
        outcomeColor = "var(--accent-amber)";
    } else {
        // It successfully refracted. Let's see where the receiver sits.
        let skipDistKm = 0;
        if (firstLandAngle !== null) {
            let delta = firstLandAngle - txAngle;
            skipDistKm = delta * 6371;
        }
        
        if (rxDistanceKm <= groundWaveLimit) {
            receiverStatus = "Ground Wave Reception";
            receiverDesc = `Strong, stable line-of-sight signal received directly along the Earth's surface (distance ${Math.round(rxDistanceKm)} km).`;
            outcomeColor = "var(--accent-blue)";
        } else if (firstLandAngle !== null && rxDistanceKm < skipDistKm) {
            receiverStatus = "Skip Zone (Silence)";
            receiverDesc = `Inside the Skip Zone (${Math.round(groundWaveLimit)} km - ${Math.round(skipDistKm)} km). Ground waves faded, and Skywaves landed farther out.`;
            outcomeColor = "rgba(239, 68, 68, 0.85)";
        } else {
            // Find if receiver is near any landing point
            // Let's check matching ray paths
            let rxMatched = false;
            let checkRay = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
            
            // Check points on Earth surface for this ray
            let landDistances = [];
            let rAngle = txAngle;
            for (let pt of checkRay.path) {
                if (pt.alt === 0 && pt.x !== txX) {
                    let ptAngle = Math.atan2(pt.y - Cy, pt.x - Cx);
                    let delta = ptAngle - txAngle;
                    if (delta < 0) delta += 2 * Math.PI;
                    landDistances.push(delta * 6371);
                }
            }
            
            // Check if rxDistanceKm falls within tolerance of any hop landing
            const tolerance = 180; // km tolerance for signal footprint
            let hopIdx = -1;
            
            for (let i = 0; i < landDistances.length; i++) {
                if (Math.abs(rxDistanceKm - landDistances[i]) <= tolerance) {
                    rxMatched = true;
                    hopIdx = i + 1;
                    break;
                }
            }
            
            if (rxMatched) {
                receiverStatus = `Skywave Received (${hopIdx}-Hop)`;
                let signalStrength = hopIdx === 1 ? "Strong" : "Weak/Fluttering";
                receiverDesc = `${signalStrength} skywave signal reflected by the ${primaryRay.refractionLayer} layer. Total path: ${hopIdx} bounce(s).`;
                outcomeColor = hopIdx === 1 ? "var(--accent-green)" : "var(--accent-teal)";
            } else {
                receiverStatus = "Out of Phase / Sky Skip";
                receiverDesc = `The receiver (${Math.round(rxDistanceKm)} km) lies in between skywave footprints (1-hop landed at ${Math.round(landDistances[0] || 0)} km).`;
                outcomeColor = "rgba(255,255,255,0.4)";
            }
        }
    }
    
    telemetryOutcome.textContent = receiverStatus;
    telemetryOutcome.style.color = outcomeColor;
    telemetryOutcomeDesc.textContent = receiverDesc;
}

// Core Simulation Drawing Loop
let wavePulseOffset = 0;

function animationLoop() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
    
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    
    // Draw space stars background
    drawStars(W, H);
    
    // Draw Atmosphere glow / Ionosphere layers
    drawIonosphereLayers(W, H);
    
    // Draw Earth surface
    drawEarth(W, H);
    
    // Draw Transmitter and Receiver stations
    drawStations(W, H);
    
    // Trace and draw adjacent beams (the beam spread)
    drawBeamSpread();
    
    // Trace and draw primary active ray
    drawPrimaryRay();
    
    // Update wave animation offset
    wavePulseOffset = (wavePulseOffset + 0.35) % 40;
    
    requestAnimationFrame(animationLoop);
}

// Background star generator
let stars = [];
function drawStars(w, h) {
    if (stars.length === 0) {
        for (let i = 0; i < 60; i++) {
            stars.push({
                x: Math.random() * w,
                y: Math.random() * (h - 200),
                size: Math.random() * 1.2 + 0.4,
                alpha: Math.random() * 0.5 + 0.3
            });
        }
    }
    
    ctx.save();
    for (let star of stars) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

// Draw the glowing arcs representing Ionosphere Layers
function drawIonosphereLayers(w, h) {
    ctx.save();
    
    const solarFactor = state.solarActivity / 70;
    
    // Helper to draw a layer arc
    function drawLayerArc(altMin, altMax, color, label, isActive, isHighlighted) {
        let rMin = R_earth + altMin;
        let rMax = R_earth + altMax;
        
        ctx.beginPath();
        // Outer arc (from left to right)
        ctx.arc(Cx, Cy, rMax, -Math.PI/2 - 0.4, -Math.PI/2 + 0.7);
        // Inner arc (from right to left)
        ctx.arc(Cx, Cy, rMin, -Math.PI/2 + 0.7, -Math.PI/2 - 0.4, true);
        ctx.closePath();
        
        // Layer styling
        let alpha = isActive ? 0.08 : 0.01;
        if (isHighlighted) alpha = 0.22;
        
        ctx.fillStyle = color.replace('ALPHA', alpha);
        ctx.fill();
        
        // Draw dashed boundaries
        ctx.strokeStyle = color.replace('ALPHA', isHighlighted ? 0.5 : 0.15);
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.setLineDash([6, 8]);
        
        ctx.beginPath();
        ctx.arc(Cx, Cy, (rMin + rMax)/2, -Math.PI/2 - 0.38, -Math.PI/2 + 0.65);
        ctx.stroke();
        
        // Draw Label on the left edge
        if (isActive || isHighlighted) {
            ctx.fillStyle = color.replace('ALPHA', isHighlighted ? 1.0 : 0.7);
            ctx.font = `600 11px ${state.highlightedLayer === label ? 'var(--font-heading)' : 'var(--font-body)'}`;
            ctx.textAlign = 'right';
            ctx.setLineDash([]);
            
            let labelAngle = -Math.PI/2 - 0.25; // near TX
            let lx = Cx + ((rMin + rMax)/2) * Math.cos(labelAngle) - 15;
            let ly = Cy + ((rMin + rMax)/2) * Math.sin(labelAngle);
            ctx.fillText(`${label} Layer (${altMin}-${altMax} km)`, lx, ly + 3);
        }
    }
    
    // 1. D-Layer (60 - 90km) - Day only
    const dActive = state.timeOfDay === 'day';
    drawLayerArc(55, 90, 'rgba(239, 68, 68, ALPHA)', 'D', dActive, state.highlightedLayer === 'D');
    
    // 2. E-Layer (90 - 140km) - Active in day, trace residual in night
    const eActive = true; 
    const eColor = state.timeOfDay === 'day' ? 'rgba(20, 184, 166, ALPHA)' : 'rgba(20, 184, 166, 0.02)';
    drawLayerArc(90, 135, eColor, 'E', eActive, state.highlightedLayer === 'E');
    
    if (state.timeOfDay === 'day') {
        // 3. F1-Layer (140 - 210km) - Day only
        drawLayerArc(145, 205, 'rgba(245, 158, 11, ALPHA)', 'F1', true, state.highlightedLayer === 'F1');
        // 4. F2-Layer (210 - 340km) - Primary Day reflector
        drawLayerArc(210, 330, 'rgba(139, 92, 246, ALPHA)', 'F2', true, state.highlightedLayer === 'F2');
    } else {
        // Night F-Layer (180 - 320km) - Combined F1 and F2
        drawLayerArc(180, 310, 'rgba(139, 92, 246, ALPHA)', 'F', true, state.highlightedLayer === 'F1' || state.highlightedLayer === 'F2');
    }
    
    ctx.restore();
}

// Draw the Earth surface curvature
function drawEarth(w, h) {
    ctx.save();
    
    // Create elegant gradient for Earth core/crust
    let earthGrad = ctx.createRadialGradient(Cx, Cy, R_earth - 60, Cx, Cy, R_earth);
    earthGrad.addColorStop(0, '#04070E');
    earthGrad.addColorStop(0.85, '#0E1726');
    earthGrad.addColorStop(1, '#1E293B');
    
    ctx.fillStyle = earthGrad;
    ctx.beginPath();
    ctx.arc(Cx, Cy, R_earth, 0, Math.PI * 2);
    ctx.fill();
    
    // Crust top boundary highlight
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(Cx, Cy, R_earth, -Math.PI/2 - 0.5, -Math.PI/2 + 0.7);
    ctx.stroke();
    
    // Draw Ground Wave region shading around Transmitter
    // Ground wave reaches ~120km. Convert 120km to angular distance.
    const gwAngleDist = 120 / 6371; // angle in radians
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(Cx, Cy, R_earth + 2, txAngle, txAngle + gwAngleDist);
    ctx.stroke();
    
    // Ground wave label
    ctx.fillStyle = 'rgba(59, 130, 246, 0.7)';
    ctx.font = '500 9px var(--font-mono)';
    let gwLabelAngle = txAngle + gwAngleDist / 2;
    let lx = Cx + (R_earth + 12) * Math.cos(gwLabelAngle);
    let ly = Cy + (R_earth + 12) * Math.sin(gwLabelAngle);
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(gwLabelAngle + Math.PI/2);
    ctx.textAlign = 'center';
    ctx.fillText("Ground Wave", 0, 0);
    ctx.restore();
    
    // Draw Skip Zone shading
    // Find where the first skywave returns from the primary ray
    const primaryRay = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
    let skipAngle = null;
    for (let pt of primaryRay.path) {
        if (pt.alt === 0 && pt.x !== txX) {
            skipAngle = Math.atan2(pt.y - Cy, pt.x - Cx);
            break;
        }
    }
    
    if (skipAngle !== null && skipAngle > txAngle + gwAngleDist) {
        // Shade skip zone red
        ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
        ctx.beginPath();
        ctx.moveTo(Cx, Cy);
        ctx.arc(Cx, Cy, R_earth, txAngle + gwAngleDist, skipAngle);
        ctx.closePath();
        ctx.fill();
        
        // Draw Skip Zone outline on crust
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(Cx, Cy, R_earth, txAngle + gwAngleDist, skipAngle);
        ctx.stroke();
        
        // Label in the middle of Skip Zone
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.font = '600 10px var(--font-heading)';
        let skipMidAngle = (txAngle + gwAngleDist + skipAngle) / 2;
        let sx = Cx + (R_earth + 12) * Math.cos(skipMidAngle);
        let sy = Cy + (R_earth + 12) * Math.sin(skipMidAngle);
        
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(skipMidAngle + Math.PI/2);
        ctx.textAlign = 'center';
        ctx.fillText("SKIP ZONE", 0, 0);
        ctx.restore();
    }
    
    ctx.restore();
}

// Draw Transmitter and Receiver stations
function drawStations(w, h) {
    ctx.save();
    
    // 1. Transmitter
    let txAngleDeg = txAngle + Math.PI/2;
    ctx.save();
    ctx.translate(txX, txY);
    ctx.rotate(txAngle); // align vertically on Earth surface curve
    
    // Tower body
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-8, -25);
    ctx.lineTo(8, -25);
    ctx.closePath();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(0, -25);
    ctx.lineTo(0, -32);
    ctx.stroke();
    
    // Beacon dot
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(0, -33, 2, 0, Math.PI * 2);
    ctx.fill();
    
    // TX Label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 9px var(--font-heading)';
    ctx.textAlign = 'center';
    ctx.fillText("TX STATION", 0, 14);
    
    ctx.restore();
    
    // 2. Receiver
    let rxX = Cx + R_earth * Math.cos(state.rxAngle);
    let rxY = Cy + R_earth * Math.sin(state.rxAngle);
    
    ctx.save();
    ctx.translate(rxX, rxY);
    ctx.rotate(state.rxAngle);
    
    // Small dish or antenna structure
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(0, -18);
    ctx.lineTo(5, 0);
    ctx.stroke();
    
    // Dish loop
    ctx.beginPath();
    ctx.arc(0, -18, 5, Math.PI, 0);
    ctx.stroke();
    
    // RX Label
    ctx.fillStyle = '#A5B4FC';
    ctx.font = 'bold 9px var(--font-heading)';
    ctx.textAlign = 'center';
    ctx.fillText("RX STATION", 0, 14);
    
    // Signal indicator dot
    // Determine receiver signal status for glowing dot color
    const primaryRay = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
    let dotColor = '#94A3B8'; // gray default
    
    // Get receiver status parameters
    let rxDelta = state.rxAngle - txAngle;
    if (rxDelta < 0) rxDelta += 2 * Math.PI;
    let rxDist = rxDelta * 6371;
    const luf = state.timeOfDay === 'day' ? (1.8 + 2.5 * (state.solarActivity / 70)) : 1.0;
    const angleRad = state.angle * Math.PI / 180;
    const solarFactor = state.solarActivity / 70;
    const f_critical = state.timeOfDay === 'day' ? (5.2 + 5.0 * solarFactor) : (2.5 + 2.5 * solarFactor);
    const muf = f_critical / Math.sin(angleRad);
    
    if (state.frequency >= luf && state.frequency <= muf) {
        let isRxInSkip = false;
        let skipDistKm = 0;
        let skipAngle = null;
        for (let pt of primaryRay.path) {
            if (pt.alt === 0 && pt.x !== txX) {
                skipAngle = Math.atan2(pt.y - Cy, pt.x - Cx);
                break;
            }
        }
        if (skipAngle !== null) {
            let delta = skipAngle - txAngle;
            skipDistKm = delta * 6371;
        }
        
        if (rxDist <= 120) {
            dotColor = '#3B82F6'; // ground wave
        } else if (skipAngle !== null && rxDist < skipDistKm) {
            dotColor = '#EF4444'; // skip silence
        } else {
            // Check hops
            let rxMatched = false;
            let checkRay = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
            let landDistances = [];
            for (let pt of checkRay.path) {
                if (pt.alt === 0 && pt.x !== txX) {
                    let ptAngle = Math.atan2(pt.y - Cy, pt.x - Cx);
                    let delta = ptAngle - txAngle;
                    if (delta < 0) delta += 2 * Math.PI;
                    landDistances.push(delta * 6371);
                }
            }
            
            for (let d of landDistances) {
                if (Math.abs(rxDist - d) <= 180) {
                    rxMatched = true;
                    break;
                }
            }
            dotColor = rxMatched ? '#10B981' : '#F59E0B'; // green if received, yellow if out of phase
        }
    } else if (state.frequency < luf && state.timeOfDay === 'day') {
        dotColor = '#EF4444'; // absorbed
    } else {
        dotColor = '#F59E0B'; // space escape / no match
    }
    
    ctx.fillStyle = dotColor;
    ctx.shadowBlur = 12;
    ctx.shadowColor = dotColor;
    ctx.beginPath();
    ctx.arc(0, -25, 3.5, 0, Math.PI*2);
    ctx.fill();
    
    ctx.restore();
}

// Draw the main ray representing the user's selected parameters
function drawPrimaryRay() {
    const ray = traceRay(state.angle, state.frequency, state.solarActivity, state.timeOfDay);
    
    ctx.save();
    
    // Draw the glow behind the ray path
    ctx.beginPath();
    ctx.moveTo(ray.path[0].x, ray.path[0].y);
    for (let i = 1; i < ray.path.length; i++) {
        ctx.lineTo(ray.path[i].x, ray.path[i].y);
    }
    
    let rayGlowColor = 'rgba(99, 102, 241, 0.4)';
    if (ray.status === 'absorbed') rayGlowColor = 'rgba(239, 68, 68, 0.35)';
    else if (ray.status === 'escaped') rayGlowColor = 'rgba(245, 158, 11, 0.35)';
    
    ctx.strokeStyle = rayGlowColor;
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // Draw core ray path
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    
    // Draw flowing wave pulses/particles along the path
    drawWavePulses(ray.path, '#E0E7FF');
    
    ctx.restore();
}

// Draw a cluster of neighboring rays to simulate beam dispersion/focusing
function drawBeamSpread() {
    ctx.save();
    
    // Draw 4 adjacent rays
    const angles = [state.angle - 2.5, state.angle - 1.2, state.angle + 1.2, state.angle + 2.5];
    
    for (let a of angles) {
        if (a < 5 || a > 85) continue;
        
        const ray = traceRay(a, state.frequency, state.solarActivity, state.timeOfDay);
        
        ctx.beginPath();
        ctx.moveTo(ray.path[0].x, ray.path[0].y);
        for (let i = 1; i < ray.path.length; i++) {
            ctx.lineTo(ray.path[i].x, ray.path[i].y);
        }
        
        let strokeCol = 'rgba(129, 140, 248, 0.09)'; // light blue-violet translucent
        if (ray.status === 'absorbed') strokeCol = 'rgba(239, 68, 68, 0.08)';
        else if (ray.status === 'escaped') strokeCol = 'rgba(245, 158, 11, 0.08)';
        
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.0;
        ctx.stroke();
    }
    
    ctx.restore();
}

// Draw moving pulse nodes along the ray coordinates to represent radio waves flowing
function drawWavePulses(path, color) {
    ctx.save();
    ctx.fillStyle = color;
    
    // Draw pulses spaced out along the path array
    let stepCount = path.length;
    let spacing = 35; // px spacing between pulses
    
    // We calculate cumulative distance along the path to animate smoothly
    let cumDistance = 0;
    let distances = [0];
    
    for (let i = 1; i < stepCount; i++) {
        let dx = path[i].x - path[i-1].x;
        let dy = path[i].y - path[i-1].y;
        cumDistance += Math.sqrt(dx*dx + dy*dy);
        distances.push(cumDistance);
    }
    
    // Draw pulses
    for (let d = wavePulseOffset; d < cumDistance; d += spacing) {
        // Find corresponding point index on path
        let pt = getPointAtDistance(path, distances, d);
        if (pt) {
            // Draw a glowing node
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.shadowBlur = 6;
            ctx.shadowColor = color;
            
            // Pulse sizes diminish as intensity decreases (e.g. after hops/absorption)
            let size = 2.2 * pt.intensity;
            if (size > 0.3) {
                ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    ctx.restore();
}

// Linear interpolation to find point coordinate at exact distance along ray path
function getPointAtDistance(path, distances, targetD) {
    if (targetD <= 0) return { x: path[0].x, y: path[0].y, intensity: path[0].intensity };
    
    for (let i = 1; i < distances.length; i++) {
        if (distances[i] >= targetD) {
            let ratio = (targetD - distances[i-1]) / (distances[i] - distances[i-1]);
            let pPrev = path[i-1];
            let pNext = path[i];
            
            return {
                x: pPrev.x + ratio * (pNext.x - pPrev.x),
                y: pPrev.y + ratio * (pNext.y - pPrev.y),
                intensity: pPrev.intensity + ratio * (pNext.intensity - pPrev.intensity)
            };
        }
    }
    return null;
}

// Boot application
window.onload = init;
