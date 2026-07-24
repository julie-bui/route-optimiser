import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { addresses } = await req.json();

  const results = await Promise.all(
    addresses.map(async (address: string) => {
      const searchAddress = address.toLowerCase().includes("uk") || address.toLowerCase().includes("united kingdom")
        ? address
        : `${address}, UK`;

      const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
        searchAddress
      )}&key=${process.env.OPENCAGE_API_KEY}&limit=1&no_annotations=1&countrycode=gb&bounds=-0.5103,51.2868,0.3340,51.6919`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        console.log(
          `OpenCage response for "${address}":`,
          JSON.stringify(data.status),
          data.results?.[0]?.geometry,
          "confidence:",
          data.results?.[0]?.confidence
        );

        if (data.status.code !== 200 || !data.results[0]) {
          return {
            address,
            lat: null,
            lng: null,
            confidence: null,
            error: `Geocoding failed: ${data.status.message || "no match found"}`,
          };
        }

        const location = data.results[0].geometry;
        const confidence = data.results[0].confidence ?? null;
        const resolvedFormatted = data.results[0].formatted || null;
        return {
          address,
          lat: location.lat,
          lng: location.lng,
          confidence,
          resolvedFormatted,
          error: null,
        };
      } catch (err) {
        return { address, lat: null, lng: null, error: "Geocoding request failed" };
      }
    })
  );

  return NextResponse.json({ results });
}
