/* ── Traffic alert audio ─────────────────────────────────────────────
   Uses the Web Audio API to synthesise beeps — no audio files needed.
   unlock() must be called inside a user-gesture (button click) so that
   iOS Safari allows the AudioContext to run.
─────────────────────────────────────────────────────────────────────── */
window.trafficAudio = (function () {
    let _ctx = null;

    function ctx() {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (_ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    function beep(ac, freq, start, dur) {
        const osc  = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.type = 'square';                               // harsh, cuts through noise
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.9, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.start(start);
        osc.stop(start + dur + 0.01);
    }

    return {
        // Call once during the Start button click to unlock iOS audio
        unlock: function () { try { ctx(); } catch (e) {} },

        // distanceM — distance to the nearest signal in metres
        play: function (distanceM) {
            try {
                const ac = ctx();
                const t  = ac.currentTime;
                if (distanceM <= 30) {
                    // Very close: 4 rapid high beeps (C6 = 1047 Hz)
                    for (let i = 0; i < 4; i++) beep(ac, 1047, t + i * 0.20, 0.16);
                } else {
                    // ≤ 50 m: 3 beeps (A5 = 880 Hz)
                    for (let i = 0; i < 3; i++) beep(ac, 880,  t + i * 0.27, 0.21);
                }
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
    let watchId    = null;
    let _intervalId = null;
    let _dotNetRef = null;
    let _lastPos   = null;
    let _prevLat   = null;
    let _prevLon   = null;
    let _prevTime  = null;

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

            // Re-send the last known position twice per second so proximity
            // is checked at 2 Hz even when the device GPS fires at 1 Hz.
            _intervalId = setInterval(function () {
                if (_lastPos && _dotNetRef) {
                    _dotNetRef.invokeMethodAsync('OnPositionChanged', _lastPos);
                }
            }, 500);

            watchId = navigator.geolocation.watchPosition(
                function (pos) {
                    _lastPos = {
                        latitude:  pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy:  pos.coords.accuracy,
                        speed:     resolveSpeed(pos)
                    };
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
        }
    };
})();
