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

window.geolocationInterop = (function () {
    let watchId = null;

    return {
        isSupported: function () {
            return !!navigator.geolocation;
        },

        startWatching: function (dotNetRef) {
            if (!navigator.geolocation) {
                dotNetRef.invokeMethodAsync('OnPositionError', 'Geolocation is not supported by this browser.');
                return;
            }

            watchId = navigator.geolocation.watchPosition(
                function (pos) {
                    dotNetRef.invokeMethodAsync('OnPositionChanged', {
                        latitude:  pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy:  pos.coords.accuracy
                    });
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
                    maximumAge: 5000,
                    timeout: 15000
                }
            );
        },

        stopWatching: function () {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
        }
    };
})();
