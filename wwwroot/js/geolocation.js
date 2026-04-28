/* ── Traffic alert audio ─────────────────────────────────────────────
   Strategy: OfflineAudioContext → WAV blob → HTMLAudioElement
   ────────────────────────────────────────────────────────────────────
   AudioContext (live) auto-suspends after ~30 s of silence and cannot
   be resumed programmatically on iOS — making it unreliable for driving.

   Instead we:
   1. Render each tone OFFLINE (OfflineAudioContext never suspends) into
      a WAV blob during the Start button tap (user gesture).
   2. Pre-load each blob into an HTMLAudioElement and call play()+pause()
      once during the gesture to unlock it on iOS.
   3. For every subsequent alert, just reset currentTime and call play().
      HTMLAudioElement.play() works at any time after the initial unlock,
      with no AudioContext to suspend — fully reliable between alerts.
─────────────────────────────────────────────────────────────────────── */
window.trafficAudio = (function () {
    // Pre-rendered Audio elements, keyed by tone id
    const _audio = {};
    let   _unlocked = false;

    /* Convert a mono AudioBuffer to a 16-bit PCM WAV ArrayBuffer */
    function _toWav(buf) {
        const sr  = buf.sampleRate;
        const len = buf.length;
        const ab  = new ArrayBuffer(44 + len * 2);
        const v   = new DataView(ab);
        let   p   = 0;

        function str(s) { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); }
        function u16(n) { v.setUint16(p, n, true); p += 2; }
        function u32(n) { v.setUint32(p, n, true); p += 4; }

        str('RIFF'); u32(36 + len * 2); str('WAVE');
        str('fmt '); u32(16); u16(1); u16(1);   // PCM, mono
        u32(sr); u32(sr * 2); u16(2); u16(16);  // sampleRate, byteRate, blockAlign, bitsPerSample
        str('data'); u32(len * 2);

        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const s = Math.max(-1, Math.min(1, ch[i]));
            v.setInt16(p, s < 0 ? s * 32768 : s * 32767, true);
            p += 2;
        }
        return ab;
    }

    /* Synthesise a tone entirely offline (no user gesture required) */
    async function _renderTone(toneId) {
        const sr  = 44100;
        const dur = toneId === 'alert-chime' ? 1.1 : 0.85;
        const ctx = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);

        function beep(t) {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(1047, t);       // C6
            g.gain.setValueAtTime(0.9, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.start(t); osc.stop(t + 0.19);
        }
        function note(t, hz, d) {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(hz, t);
            g.gain.setValueAtTime(0.7, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + d);
            osc.start(t); osc.stop(t + d + 0.01);
        }

        if      (toneId === 'single-beep')  { beep(0.01); }
        else if (toneId === 'alert-chime')  { note(0.01, 1319, 0.28); note(0.31, 1047, 0.28); note(0.61, 784, 0.35); }
        else /* triple-beep */              { beep(0.01); beep(0.26); beep(0.51); }

        const rendered = await ctx.startRendering();
        const blob = new Blob([_toWav(rendered)], { type: 'audio/wav' });
        return URL.createObjectURL(blob);
    }

    return {
        /* ── unlock ───────────────────────────────────────────────────
           MUST be called inside the Start button click (user gesture).
           Renders all three tones offline then pre-unlocks each Audio
           element with a silent play+pause so iOS allows future plays. */
        unlock: async function () {
            if (_unlocked) return;
            try {
                for (const id of ['triple-beep', 'single-beep', 'alert-chime']) {
                    const url = await _renderTone(id);
                    const a   = new Audio(url);
                    a.preload = 'auto';
                    // play+pause inside user gesture → unlocks the element on iOS
                    try { await a.play(); a.pause(); a.currentTime = 0; } catch (_) {}
                    _audio[id] = a;
                }
                _unlocked = true;
            } catch (e) { console.warn('trafficAudio.unlock failed:', e); }
        },

        /* ── play ─────────────────────────────────────────────────────
           Resets the pre-rendered Audio element to the start and plays.
           Works at any time after unlock() — no AudioContext involved,
           no suspension risk, no user gesture required. */
        play: async function (tone) {
            tone = tone || 'triple-beep';
            const a = _audio[tone] || _audio['triple-beep'];
            if (!a) { console.warn('trafficAudio.play: call unlock() first'); return; }
            try { a.currentTime = 0; await a.play(); }
            catch (e) { console.warn('trafficAudio.play failed:', e); }
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
