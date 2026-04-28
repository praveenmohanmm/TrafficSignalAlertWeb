/* ── Traffic alert audio ─────────────────────────────────────────────
   Strategy: synchronous PCM synthesis → WAV data URI → HTMLAudioElement
   ────────────────────────────────────────────────────────────────────
   All previous approaches (AudioContext, OfflineAudioContext + blob)
   failed because:
   • Live AudioContext auto-suspends after ~30 s of silence on Chrome/iOS
   • Async rendering inside unlock() broke the synchronous user-gesture
     chain required by iOS Safari to allow Audio.play()

   This implementation:
   1. Synthesises every tone with pure JS maths (no AudioContext at all)
   2. Encodes to a WAV data URI — fully synchronous, no Promises
   3. Creates HTMLAudioElement objects and calls play()+pause() while
      still in the synchronous Start-button click handler
   4. play() simply resets currentTime and fires — nothing can suspend
─────────────────────────────────────────────────────────────────────── */
window.trafficAudio = (function () {
    const _audio = {};   // tone id → HTMLAudioElement
    const SR     = 44100;

    /* ── PCM helpers ─────────────────────────────────────────────────── */
    function _sq(buf, freq, t0, t1, vol) {   // square wave with exponential decay
        const i0 = Math.floor(t0 * SR), i1 = Math.min(Math.ceil(t1 * SR), buf.length);
        const span = t1 - t0;
        for (let i = i0; i < i1; i++) {
            const t   = (i - i0) / SR;
            const wav = ((freq * t % 1) < 0.5) ? 1 : -1;
            buf[i]   += wav * vol * Math.exp(-9 * t / span);
        }
    }
    function _sn(buf, freq, t0, t1, vol) {   // sine wave with exponential decay
        const i0 = Math.floor(t0 * SR), i1 = Math.min(Math.ceil(t1 * SR), buf.length);
        const span = t1 - t0;
        for (let i = i0; i < i1; i++) {
            const t   = (i - i0) / SR;
            buf[i]   += Math.sin(2 * Math.PI * freq * t) * vol * Math.exp(-7 * t / span);
        }
    }

    /* ── WAV encoder ─────────────────────────────────────────────────── */
    function _toDataUri(buf) {
        const len = buf.length;
        const ab  = new ArrayBuffer(44 + len * 2);
        const v   = new DataView(ab);
        let   p   = 0;
        const s4  = w => { for (let i = 0; i < w.length; i++) v.setUint8(p++, w.charCodeAt(i)); };
        const u16 = n => { v.setUint16(p, n, true); p += 2; };
        const u32 = n => { v.setUint32(p, n, true); p += 4; };

        s4('RIFF'); u32(36 + len * 2); s4('WAVE');
        s4('fmt '); u32(16); u16(1); u16(1);        // PCM, mono
        u32(SR); u32(SR * 2); u16(2); u16(16);      // sampleRate → bitsPerSample
        s4('data'); u32(len * 2);

        for (let i = 0; i < len; i++) {
            const x = Math.max(-1, Math.min(1, buf[i]));
            v.setInt16(p, x < 0 ? x * 32768 : x * 32767, true); p += 2;
        }
        // Build binary string in 8 KB chunks (avoids call-stack limit on large arrays)
        const bytes = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192)
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        return 'data:audio/wav;base64,' + btoa(bin);
    }

    /* ── Tone definitions ────────────────────────────────────────────── */
    function _build(id) {
        let buf;
        if (id === 'single-beep') {
            buf = new Float32Array(Math.ceil(SR * 0.30));
            _sq(buf, 1047, 0.01, 0.20, 0.9);                          // C6
        } else if (id === 'alert-chime') {
            buf = new Float32Array(Math.ceil(SR * 1.05));
            _sn(buf, 1319, 0.01, 0.29, 0.7);                          // E6
            _sn(buf, 1047, 0.31, 0.59, 0.7);                          // C6
            _sn(buf,  784, 0.61, 0.96, 0.7);                          // G5
        } else {                                                        // triple-beep
            buf = new Float32Array(Math.ceil(SR * 0.75));
            _sq(buf, 1047, 0.01, 0.20, 0.9);
            _sq(buf, 1047, 0.26, 0.45, 0.9);
            _sq(buf, 1047, 0.51, 0.70, 0.9);
        }
        return _toDataUri(buf);
    }

    return {
        /* unlock ── MUST be called synchronously inside the Start button
           click handler (user gesture).  Builds all tones via pure JS
           maths — no Promises, no awaits — then calls play()+pause() on
           each Audio element while still in the gesture call stack.
           iOS Safari requires play() to be in the synchronous path. */
        unlock: function () {
            for (const id of ['triple-beep', 'single-beep', 'alert-chime']) {
                if (_audio[id]) continue;
                const a = new Audio(_build(id));
                a.preload = 'auto';
                // Synchronous play call → unlocks the element on iOS
                a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
                _audio[id] = a;
            }
        },

        /* play ── resets the pre-built Audio element and plays it.
           Fire-and-forget: no await, so Blazor interop returns instantly.
           Nothing to suspend, nothing to re-lock between alerts. */
        play: function (tone) {
            tone       = tone || 'triple-beep';
            const a    = _audio[tone] || _audio['triple-beep'];
            if (!a) { console.warn('trafficAudio.play: call unlock() first'); return; }
            a.currentTime = 0;
            a.play().catch(e => console.warn('trafficAudio.play failed:', e));
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
