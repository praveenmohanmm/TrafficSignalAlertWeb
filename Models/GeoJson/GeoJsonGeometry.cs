using System.Text.Json.Serialization;

namespace TrafficSignalAlertWeb.Models.GeoJson;

internal sealed class GeoJsonGeometry
{
    /// <summary>GeoJSON Point coordinates are [longitude, latitude].</summary>
    [JsonPropertyName("coordinates")]
    public double[] Coordinates { get; set; } = [];

    public double Longitude => Coordinates.Length > 0 ? Coordinates[0] : 0;
    public double Latitude  => Coordinates.Length > 1 ? Coordinates[1] : 0;
}
