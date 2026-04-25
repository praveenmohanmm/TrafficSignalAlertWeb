using System.Net.Http.Json;
using System.Text.Json;
using TrafficSignalAlertWeb.Models;
using TrafficSignalAlertWeb.Models.GeoJson;

namespace TrafficSignalAlertWeb.Services;

public class TrafficSignalService
{
    public const double NormalRadiusMetres   = 100.0;
    public const double HighSpeedRadiusMetres = 200.0;
    public const double HighSpeedThresholdKmh = 50.0;

    private readonly HttpClient _http;
    private List<TrafficSignal>? _signals;

    public TrafficSignalService(HttpClient http) => _http = http;

    public async Task<List<TrafficSignal>> LoadSignalsAsync()
    {
        if (_signals is not null)
            return _signals;

        var collection = await _http.GetFromJsonAsync<GeoJsonFeatureCollection>(
            "data.json",
            new JsonSerializerOptions { PropertyNameCaseInsensitive = false }
        );

        _signals = collection?.Features
            .Where(f => f.Geometry is not null)
            .Select(MapFeature)
            .ToList() ?? [];

        return _signals;
    }

    public async Task<IReadOnlyList<(TrafficSignal Signal, double DistanceMetres)>>
        GetNearbySignalsAsync(double latitude, double longitude, double radiusMetres)
    {
        var signals = await LoadSignalsAsync();
        return signals
            .Select(s => (Signal: s, Distance: HaversineMetres(latitude, longitude, s.Latitude, s.Longitude)))
            .Where(x => x.Distance <= radiusMetres)
            .OrderBy(x => x.Distance)
            .ToList();
    }

    public async Task<(TrafficSignal? Signal, double DistanceMetres)>
        GetClosestSignalAsync(double latitude, double longitude)
    {
        var signals = await LoadSignalsAsync();
        if (signals.Count == 0) return (null, double.MaxValue);

        return signals
            .Select(s => (Signal: s, Distance: HaversineMetres(latitude, longitude, s.Latitude, s.Longitude)))
            .OrderBy(x => x.Distance)
            .First();
    }

    private static TrafficSignal MapFeature(GeoJsonFeature feature)
    {
        var p = feature.Properties;
        var g = feature.Geometry!;

        var streets = new[] { p.StreetName1, p.StreetName2, p.StreetName3, p.StreetName4, p.StreetName5 }
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!)
            .ToList();

        return new TrafficSignal
        {
            ObjectId         = p.ObjectId,
            GeoId            = p.GeoId,
            IntersectionName = p.IntersectionName ?? string.Empty,
            IntersectionType = p.IntersectionType ?? string.Empty,
            Municipality     = p.Municipality ?? string.Empty,
            Settlement       = p.Settlement ?? string.Empty,
            OwnedBy          = p.OwnedBy ?? string.Empty,
            MaintainedBy     = p.MaintainedBy ?? string.Empty,
            StreetNames      = string.Join(" @ ", streets),
            LifeStatus       = p.LifeStatus ?? string.Empty,
            Rmwid            = p.Rmwid ?? string.Empty,
            Longitude        = g.Longitude,
            Latitude         = g.Latitude,
        };
    }

    public static double HaversineMetres(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6_371_000;
        double dLat = ToRad(lat2 - lat1);
        double dLon = ToRad(lon2 - lon1);
        double a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                 + Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2))
                 * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private static double ToRad(double d) => d * Math.PI / 180.0;
}
