namespace TrafficSignalAlertWeb.Models;

public class AlertSettings
{
    public double MinSpeedKmh    { get; set; } = 17;
    public double MaxSpeedKmh    { get; set; } = 100;
    public double SpeedBreak1Kmh { get; set; } = 50;   // low  → mid
    public double SpeedBreak2Kmh { get; set; } = 60;   // mid  → high
    public double LowRadiusM     { get; set; } = 80;    // 17–50 km/h
    public double MidRadiusM     { get; set; } = 125;   // 50–60 km/h
    public double HighRadiusM    { get; set; } = 200;   // 60–100 km/h

    /// <summary>
    /// Returns the alert radius in metres, or null when speed is outside
    /// the alertable range.
    /// </summary>
    public double? GetAlertRadius(double speedKmh)
    {
        if (speedKmh < MinSpeedKmh || speedKmh > MaxSpeedKmh) return null;
        if (speedKmh < SpeedBreak1Kmh) return LowRadiusM;
        if (speedKmh < SpeedBreak2Kmh) return MidRadiusM;
        return HighRadiusM;
    }
}
