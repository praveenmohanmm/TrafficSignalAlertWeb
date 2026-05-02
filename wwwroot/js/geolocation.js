/* ── Traffic alert audio ─────────────────────────────────────────────
   Strategy: ONE shared AudioContext, kept alive by a silent oscillator
   ────────────────────────────────────────────────────────────────────
   A single AudioContext is created during the Start button tap (user
   gesture) so it starts in 'running' state.  A permanent inaudible
   oscillator (1 Hz, gain 0.001) prevents the browser from ever
   auto-suspending it.  Every play() call reuses that same context —
   no resume(), no suspension, no timing issues between alerts.
─────────────────────────────────────────────────────────────────────── */
window.trafficAudio = (function () {
    let _ctx = null;

    /* ── helpers that use the shared context ─────────────────────────── */
    function _sq(t0, t1) {                   // square beep at C6 (1047 Hz)
        const osc = _ctx.createOscillator(), g = _ctx.createGain();
        osc.connect(g); g.connect(_ctx.destination);
        osc.type = 'square';
        osc.frequency.value = 1047;
        g.gain.setValueAtTime(0.9, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t1);
        osc.start(t0); osc.stop(t1);
    }
    function _sn(t0, t1, hz) {               // sine note
        const osc = _ctx.createOscillator(), g = _ctx.createGain();
        osc.connect(g); g.connect(_ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = hz;
        g.gain.setValueAtTime(0.7, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t1);
        osc.start(t0); osc.stop(t1);
    }

    /* ── keep-alive: permanent inaudible oscillator ──────────────────── */
    function _keepAlive() {
        const osc = _ctx.createOscillator(), g = _ctx.createGain();
        g.gain.value = 0.001;       // inaudible but above silence-detection threshold
        osc.frequency.value = 1;    // 1 Hz — way below human hearing
        osc.connect(g); g.connect(_ctx.destination);
        osc.start();                // runs until the page unloads
    }

    // Re-resume after switching apps and back
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && _ctx && _ctx.state !== 'running')
            _ctx.resume().catch(function () {});
    });

    return {
        /* unlock — called during a user gesture (e.g. Start button tap).
           Creates the AudioContext in 'running' state and starts the
           keep-alive oscillator.  Must remain synchronous. */
        unlock: function () {
            if (_ctx) return;
            try {
                _ctx = new (window.AudioContext || window.webkitAudioContext)();
                _keepAlive();
                console.log('[TSA] unlocked, ctx state: ' + _ctx.state);
            } catch (e) { console.warn('[TSA] unlock failed:', e); }
        },

        /* autoUnlock — called on page load (no user gesture available).
           On Android/Chrome the AudioContext usually starts 'running' right
           away.  On iOS Safari it starts 'suspended'; a one-time touch/click
           listener resumes it and notifies Blazor via dotNetRef so the
           "tap for audio" banner can be dismissed. */
        autoUnlock: function (dotNetRef) {
            // Try to create the context immediately (works on Android)
            if (!_ctx) {
                try {
                    _ctx = new (window.AudioContext || window.webkitAudioContext)();
                    _keepAlive();
                    console.log('[TSA] autoUnlock: ctx state=' + _ctx.state);
                } catch (e) { console.warn('[TSA] autoUnlock create failed:', e); }
            }

            // If already running, notify Blazor straight away
            if (_ctx && _ctx.state === 'running') {
                if (dotNetRef) dotNetRef.invokeMethodAsync('OnAudioUnlocked');
                return;
            }

            // iOS: resume on first user interaction, then notify Blazor
            const handler = function () {
                if (_ctx) {
                    _ctx.resume().then(function () {
                        console.log('[TSA] autoUnlock resumed: ctx state=' + _ctx.state);
                        if (dotNetRef) dotNetRef.invokeMethodAsync('OnAudioUnlocked');
                    }).catch(function (e) { console.warn('[TSA] resume failed:', e); });
                }
                document.removeEventListener('touchstart', handler);
                document.removeEventListener('click',      handler);
            };
            document.addEventListener('touchstart', handler, { once: true, passive: true });
            document.addEventListener('click',      handler, { once: true });
            console.log('[TSA] autoUnlock: waiting for first touch to resume');
        },

        /* play — schedules the tone on the already-running shared context.
           Context is guaranteed running (keep-alive prevents suspension). */
        play: function (tone) {
            tone = tone || 'triple-beep';
            console.log('[TSA] play: ' + tone + ' | ctx: ' + (_ctx ? _ctx.state : 'null'));
            if (!_ctx) { console.warn('[TSA] call unlock() first'); return; }

            const t = _ctx.currentTime;
            if (tone === 'single-beep') {
                _sq(t, t + 0.18);
            } else if (tone === 'alert-chime') {
                _sn(t,        t + 0.28, 1319);   // E6
                _sn(t + 0.30, t + 0.58, 1047);   // C6
                _sn(t + 0.61, t + 0.95,  784);   // G5
            } else {                               // triple-beep (default)
                _sq(t,        t + 0.18);
                _sq(t + 0.25, t + 0.43);
                _sq(t + 0.50, t + 0.68);
            }
            console.log('[TSA] scheduled at t=' + t.toFixed(3));
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
