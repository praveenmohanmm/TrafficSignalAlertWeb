using Microsoft.JSInterop;

namespace TrafficSignalAlertWeb.Services;

public record LocationResult(double Latitude, double Longitude, double Accuracy, double Speed);

public class GeolocationService : IAsyncDisposable
{
    private readonly IJSRuntime _js;
    private DotNetObjectReference<GeolocationService>? _selfRef;

    public event Action<LocationResult>? LocationChanged;
    public event Action<string>? ErrorOccurred;

    public bool IsTracking { get; private set; }
    public bool IsSupported { get; private set; } = true;

    public GeolocationService(IJSRuntime js) => _js = js;

    public async Task StartAsync()
    {
        IsSupported = await _js.InvokeAsync<bool>("geolocationInterop.isSupported");
        if (!IsSupported)
        {
            ErrorOccurred?.Invoke("Geolocation is not supported by this browser.");
            return;
        }

        _selfRef ??= DotNetObjectReference.Create(this);
        await _js.InvokeVoidAsync("geolocationInterop.startWatching", _selfRef);
        IsTracking = true;
    }

    public async Task StopAsync()
    {
        if (!IsTracking) return;
        await _js.InvokeVoidAsync("geolocationInterop.stopWatching");
        IsTracking = false;
    }

    [JSInvokable]
    public void OnPositionChanged(LocationResult location)
    {
        LocationChanged?.Invoke(location);
    }

    [JSInvokable]
    public void OnPositionError(string message)
    {
        IsTracking = false;
        ErrorOccurred?.Invoke(message);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _selfRef?.Dispose();
        _selfRef = null;   // must be nulled so StartAsync creates a fresh reference next time
    }
}
