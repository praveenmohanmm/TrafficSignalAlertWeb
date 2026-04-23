using System.Text.Json.Serialization;

namespace TrafficSignalAlertWeb.Models.GeoJson;

internal sealed class IntersectionProperties
{
    [JsonPropertyName("OBJECTID")]
    public int ObjectId { get; set; }

    [JsonPropertyName("GeoID")]
    public int GeoId { get; set; }

    [JsonPropertyName("IntersectionName")]
    public string? IntersectionName { get; set; }

    [JsonPropertyName("IntersectionType")]
    public string? IntersectionType { get; set; }

    [JsonPropertyName("Municipality")]
    public string? Municipality { get; set; }

    [JsonPropertyName("Settlement")]
    public string? Settlement { get; set; }

    [JsonPropertyName("OwnedBy")]
    public string? OwnedBy { get; set; }

    [JsonPropertyName("MaintainedBy")]
    public string? MaintainedBy { get; set; }

    [JsonPropertyName("TraffcSystemAddress")]
    public string? TrafficSystemAddress { get; set; }

    [JsonPropertyName("StreetName1")]
    public string? StreetName1 { get; set; }

    [JsonPropertyName("StreetName2")]
    public string? StreetName2 { get; set; }

    [JsonPropertyName("StreetName3")]
    public string? StreetName3 { get; set; }

    [JsonPropertyName("StreetName4")]
    public string? StreetName4 { get; set; }

    [JsonPropertyName("StreetName5")]
    public string? StreetName5 { get; set; }

    [JsonPropertyName("LifeStatus")]
    public string? LifeStatus { get; set; }

    [JsonPropertyName("RMWID")]
    public string? Rmwid { get; set; }

    [JsonPropertyName("LucityIntersectionType")]
    public string? LucityIntersectionType { get; set; }

    [JsonPropertyName("LucityIntersectionStatus")]
    public string? LucityIntersectionStatus { get; set; }

    [JsonPropertyName("LastEditDate")]
    public string? LastEditDate { get; set; }
}
