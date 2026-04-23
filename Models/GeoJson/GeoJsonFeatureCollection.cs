using System.Text.Json.Serialization;

namespace TrafficSignalAlertWeb.Models.GeoJson;

/// <summary>Top-level GeoJSON FeatureCollection wrapper.</summary>
internal sealed class GeoJsonFeatureCollection
{
    [JsonPropertyName("features")]
    public List<GeoJsonFeature> Features { get; set; } = [];
}
