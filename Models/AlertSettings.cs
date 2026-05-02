namespace TrafficSignalAlertWeb.Models;

public class AlertSettings
{
    /// <summary>
    /// Alert tone identifier. One of: "triple-beep", "single-beep", "alert-chime".
    /// </summary>
    public string AlertTone { get; set; } = "triple-beep";

    public double MinSpeedKmh    { get; set; } = 17;
    public double MaxSpeedKmh    { get; set; } = 100;

    // Speed band break points (km/h)
    public double SpeedBreak1Kmh { get; set; } = 30;   // band 1 → 2
    public double SpeedBreak2Kmh { get; set; } = 50;   // band 2 → 3
    public double SpeedBreak3Kmh { get; set; } = 60;   // band 3 → 4
    public double SpeedBreak4Kmh { get; set; } = 70;   // band 4 → 5

    // Alert radii per band (metres)
    public double RadiusBand1M   { get; set; } = 40;   // 17–30 km/h
    public double RadiusBand2M   { get; set; } = 50;   // 30–50 km/h
    public double RadiusBand3M   { get; set; } = 90;   // 50–60 km/h
    public double RadiusBand4M   { get; set; } = 100;  // 60–70 km/h
    public double RadiusBand5M   { get; set; } = 130;  // 70–100 km/h

    /// <summary>
    /// Returns the alert radius in metres, or null when speed is outside
    /// the alertable range.
    /// </summary>
    public double? GetAlertRadius(double speedKmh)
    {
        if (speedKmh < MinSpeedKmh || speedKmh > MaxSpeedKmh) return null;
        if (speedKmh < SpeedBreak1Kmh) return RadiusBand1M;
        if (speedKmh < SpeedBreak2Kmh) return RadiusBand2M;
        if (speedKmh < SpeedBreak3Kmh) return RadiusBand3M;
        if (speedKmh < SpeedBreak4Kmh) return RadiusBand4M;
        return RadiusBand5M;
    }
}
