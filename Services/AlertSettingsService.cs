using System.Text.Json;
using Microsoft.JSInterop;
using TrafficSignalAlertWeb.Models;

namespace TrafficSignalAlertWeb.Services;

public class AlertSettingsService(IJSRuntime js)
{
    private const string StorageKey = "tsa-settings";

    public AlertSettings Settings { get; private set; } = new();

    public event Action? SettingsChanged;

    public async Task LoadAsync()
    {
        try
        {
            var json = await js.InvokeAsync<string?>("localStorage.getItem", StorageKey);
            if (!string.IsNullOrWhiteSpace(json))
                Settings = JsonSerializer.Deserialize<AlertSettings>(json) ?? new();
        }
        catch { /* ignore – first run or private browsing */ }
    }

    public async Task SaveAsync()
    {
        try
        {
            var json = JsonSerializer.Serialize(Settings);
            await js.InvokeVoidAsync("localStorage.setItem", StorageKey, json);
        }
        catch { }
        SettingsChanged?.Invoke();
    }

    public async Task ResetAsync()
    {
        Settings = new();
        await SaveAsync();
    }
}
