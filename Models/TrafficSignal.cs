namespace TrafficSignalAlertWeb.Models;

public class TrafficSignal
{
    public int ObjectId { get; set; }
    public int GeoId { get; set; }
    public string IntersectionName { get; set; } = string.Empty;
    public string IntersectionType { get; set; } = string.Empty;
    public string Municipality { get; set; } = string.Empty;
    public string Settlement { get; set; } = string.Empty;
    public string OwnedBy { get; set; } = string.Empty;
    public string MaintainedBy { get; set; } = string.Empty;
    public string StreetNames { get; set; } = string.Empty;
    public string LifeStatus { get; set; } = string.Empty;
    public string Rmwid { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
