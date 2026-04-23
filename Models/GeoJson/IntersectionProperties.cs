using System.Text.Json.Serialization;

namespace TrafficSignalAlertWeb.Models.GeoJson;

internal sealed class IntersectionProperties
{
    [JsonPropertyName("OBJECTID")]
    public int ObjectId { get; set; }

    [JsonPropertyName("GeoID")]
    public int GeoId { get; set; }

    [JsonPropertyName("IntersectionName")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? IntersectionName { get; set; }

    [JsonPropertyName("IntersectionType")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? IntersectionType { get; set; }

    [JsonPropertyName("Municipality")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? Municipality { get; set; }

    [JsonPropertyName("Settlement")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? Settlement { get; set; }

    [JsonPropertyName("OwnedBy")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? OwnedBy { get; set; }

    [JsonPropertyName("MaintainedBy")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? MaintainedBy { get; set; }

    [JsonPropertyName("TraffcSystemAddress")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? TrafficSystemAddress { get; set; }

    [JsonPropertyName("StreetName1")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? StreetName1 { get; set; }

    [JsonPropertyName("StreetName2")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? StreetName2 { get; set; }

    [JsonPropertyName("StreetName3")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? StreetName3 { get; set; }

    [JsonPropertyName("StreetName4")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? StreetName4 { get; set; }

    [JsonPropertyName("StreetName5")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? StreetName5 { get; set; }

    [JsonPropertyName("LifeStatus")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? LifeStatus { get; set; }

    [JsonPropertyName("RMWID")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? Rmwid { get; set; }

    [JsonPropertyName("LucityIntersectionType")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? LucityIntersectionType { get; set; }

    [JsonPropertyName("LucityIntersectionStatus")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? LucityIntersectionStatus { get; set; }

    [JsonPropertyName("LastEditDate")]
    [JsonConverter(typeof(FlexibleStringConverter))]
    public string? LastEditDate { get; set; }
}
