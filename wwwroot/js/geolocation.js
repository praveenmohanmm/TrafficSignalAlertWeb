/* ── Traffic alert audio ─────────────────────────────────────────────
   Uses the Web Audio API to synthesise an attention-grabbing alert.
   unlock() must be called inside a user-gesture (button click) so that
   iOS Safari allows the AudioContext to run.

   Sound design — 3 up-chirp sweeps (880 → 1760 Hz, sawtooth wave):
   • Sawtooth is rich in harmonics → cuts through road noise and music
   • Rising frequency sweep (up-chirp) is physiologically more alerting
     than a flat tone (used in emergency PA systems for the same reason)
   • DynamicsCompressor maximises perceived loudness without clipping
   • Fires once per signal and then never again (handled by C#)
─────────────────────────────────────────────────────────────────────── */
window.trafficAudio = (function () {
    let _ctx = null;

    // Returns a Promise that resolves once the AudioContext is running.
    // MUST be awaited before scheduling any audio — the browser can
    // auto-suspend the context after a period of no user interaction.
    async function readyCtx() {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (_ctx.state !== 'running') await _ctx.resume();
        return _ctx;
    }

    return {
        // Call once during the Start button click to unlock iOS audio
        unlock: async function () {
            try { await readyCtx(); } catch (e) {}
        },

        // Single sharp beep — fires exactly once per signal location.
        // Returns a Promise so Blazor's InvokeVoidAsync waits for context resume.
        play: async function () {
            try {
                const ac   = await readyCtx();
                const osc  = ac.createOscillator();
                const gain = ac.createGain();

                osc.connect(gain);
                gain.connect(ac.destination);

                osc.type = 'square';
                osc.frequency.setValueAtTime(1047, ac.currentTime);   // C6

                gain.gain.setValueAtTime(0.9, ac.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.20);

                osc.start(ac.currentTime);
                osc.stop(ac.currentTime + 0.21);

            } catch (e) { console.warn('trafficAudio.play failed:', e); }
        }
    };
})();

/* ── Screen Wake Lock ────────────────────────────────────────────────
   Keeps the screen on while tracking so the browser doesn't suspend.
   Automatically re-acquires if the user switches apps and comes back.
─────────────────────────────────────────────────────────────────────── */
window.wakeLock = (function () {
    let _lock = null;

    async function acquire() {
        if (!('wakeLock' in navigator)) return;
        try {
            _lock = await navigator.wakeLock.request('screen');
            // Re-acquire when the page becomes visible again (e.g. after tab switch)
            _lock.addEventListener('release', () => { _lock = null; });
        } catch (e) { console.warn('Wake lock failed:', e); }
    }

    // If the page was hidden and is now visible again, re-acquire
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && _lock === null) {
            await acquire();
        }
    });

    return {
        request: acquire,
        release: async function () {
            if (_lock) { await _lock.release(); _lock = null; }
        }
    };
})();

window.geolocationInterop = (function () {
    let watchId     = null;
    let _intervalId = null;
    let _intervalMs = 500;   // current interval delay
    let _dotNetRef  = null;
    let _lastPos    = null;
    let _prevLat    = null;
    let _prevLon    = null;
    let _prevTime   = null;

    function sendLastPos() {
        if (_lastPos && _dotNetRef)
            _dotNetRef.invokeMethodAsync('OnPositionChanged', _lastPos);
    }

    // 3 Hz (333 ms) when 60–100 km/h, 2 Hz (500 ms) for all other speeds
    function adjustInterval(speedMs) {
        const kmh    = speedMs * 3.6;
        const needed = (kmh >= 60 && kmh <= 100) ? 333 : 500;
        if (needed !== _intervalMs) {
            _intervalMs = needed;
            clearInterval(_intervalId);
            _intervalId = setInterval(sendLastPos, _intervalMs);
        }
    }

    // Haversine distance in metres — used as speed fallback when
    // coords.speed is null (common on desktop browsers and some iOS configs)
    function haversineM(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const toRad = d => d * Math.PI / 180;
        const dLat  = toRad(lat2 - lat1);
        const dLon  = toRad(lon2 - lon1);
        const a     = Math.sin(dLat / 2) ** 2
                    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
                    * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function resolveSpeed(pos) {
        const now  = Date.now();
        let speed  = pos.coords.speed; // m/s from device, may be null/NaN

        if (speed == null || isNaN(speed) || speed < 0) {
            // Fall back to displacement ÷ elapsed time between fixes
            if (_prevLat !== null) {
                const dt = (now - _prevTime) / 1000; // seconds
                speed    = dt > 0
                    ? haversineM(_prevLat, _prevLon, pos.coords.latitude, pos.coords.longitude) / dt
                    : 0;
            } else {
                speed = 0;
            }
        }

        _prevLat  = pos.coords.latitude;
        _prevLon  = pos.coords.longitude;
        _prevTime = now;
        return speed;
    }

    return {
        isSupported: function () {
            return !!navigator.geolocation;
        },

        startWatching: function (dotNetRef) {
            if (!navigator.geolocation) {
                dotNetRef.invokeMethodAsync('OnPositionError', 'Geolocation is not supported by this browser.');
                return;
            }

            _dotNetRef = dotNetRef;
            _prevLat = _prevLon = _prevTime = null;
            _lastPos = null;

            // Start at 2 Hz; adjustInterval() will switch to 3 Hz if speed > 50 km/h
            _intervalMs = 500;
            _intervalId = setInterval(sendLastPos, _intervalMs);

            watchId = navigator.geolocation.watchPosition(
                function (pos) {
                    const speed = resolveSpeed(pos);
                    _lastPos = {
                        latitude:  pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy:  pos.coords.accuracy,
                        speed:     speed
                    };
                    adjustInterval(speed);          // update scan rate if speed crossed threshold
                    _dotNetRef.invokeMethodAsync('OnPositionChanged', _lastPos);
                },
                function (err) {
                    let msg;
                    switch (err.code) {
                        case err.PERMISSION_DENIED:
                            msg = 'Location permission was denied. Please allow access in your browser settings.';
                            break;
                        case err.POSITION_UNAVAILABLE:
                            msg = 'Location information is unavailable.';
                            break;
                        case err.TIMEOUT:
                            msg = 'Location request timed out.';
                            break;
                        default:
                            msg = 'An unknown location error occurred.';
                    }
                    dotNetRef.invokeMethodAsync('OnPositionError', msg);
                },
                {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 15000
                }
            );
        },

        stopWatching: function () {
            if (_intervalId !== null) { clearInterval(_intervalId); _intervalId = null; }
            if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
            _dotNetRef = null;
            _lastPos   = null;
            _prevLat = _prevLon = _prevTime = null;
        },

        /* ── DEV / TESTING ONLY ──────────────────────────────────────────────
           Inject a fake GPS position from the browser console without leaving
           your desk. Call this AFTER clicking "Start Tracking" in the app.

           Usage:
             // Single position update (speed in m/s — 13.9 m/s ≈ 50 km/h)
             geolocationInterop.injectPosition(-27.470, 153.026, 13.9);

             // Simulate driving along a route (2-second intervals)
             geolocationInterop.simulateDrive([
               { lat: -27.4700, lon: 153.0260, speed: 13.9 },
               { lat: -27.4710, lon: 153.0270, speed: 13.9 },
               { lat: -27.4720, lon: 153.0280, speed: 13.9 },
             ], 2000);

           Speed reference:
             0       m/s = stationary
             4.7     m/s = 17 km/h  (lower alert threshold)
             13.9    m/s = 50 km/h
             27.8    m/s = 100 km/h (upper alert threshold)
        ─────────────────────────────────────────────────────────────────── */
        injectPosition: function (lat, lon, speedMs) {
            if (!_dotNetRef) {
                console.warn('[injectPosition] Start Tracking first — _dotNetRef is null.');
                return;
            }
            const pos = { latitude: lat, longitude: lon, accuracy: 5, speed: speedMs ?? 13.9 };
            _lastPos = pos;
            _dotNetRef.invokeMethodAsync('OnPositionChanged', pos);
            console.log(`[injectPosition] lat=${lat}, lon=${lon}, speed=${pos.speed} m/s (${(pos.speed * 3.6).toFixed(1)} km/h)`);
        },

        simulateDrive: function (waypoints, intervalMs) {
            if (!Array.isArray(waypoints) || waypoints.length === 0) {
                console.warn('[simulateDrive] Pass an array of {lat, lon, speed} objects.');
                return;
            }
            intervalMs = intervalMs ?? 2000;
            let i = 0;
            console.log(`[simulateDrive] Starting — ${waypoints.length} waypoints, ${intervalMs} ms apart.`);
            const tick = () => {
                if (i >= waypoints.length) {
                    console.log('[simulateDrive] Route complete.');
                    return;
                }
                const wp = waypoints[i++];
                geolocationInterop.injectPosition(wp.lat, wp.lon, wp.speed ?? 13.9);
                setTimeout(tick, intervalMs);
            };
            tick();
        }
    };
})();
