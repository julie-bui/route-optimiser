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
      )}&key=${process.env.OPENCAGE_API_KEY}&limit=1&no_annotations=1&countrycode=gb`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        console.log(`OpenCage response for "${address}":`, JSON.stringify(data.status), data.results?.[0]?.geometry);

        if (data.status.code !== 200 || !data.results[0]) {
          return {
            address,
            lat: null,
            lng: null,
            error: `Geocoding failed: ${data.status.message || "no match found"}`,
          };
        }

        const location = data.results[0].geometry;
        return { address, lat: location.lat, lng: location.lng, error: null };
      } catch (err) {
        return { address, lat: null, lng: null, error: "Geocoding request failed" };
      }
    })
  );

  return NextResponse.json({ results });
}
