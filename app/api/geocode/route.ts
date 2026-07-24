import { NextRequest, NextResponse } from "next/server";

function extractQueryHouseNumber(address: string): string | null {
  const match = address.match(/^(\d+[a-zA-Z]?)/);
  return match ? match[1].toLowerCase() : null;
}

async function geocodeWithGoogle(queryAddress: string) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    queryAddress
  )}&key=${process.env.GOOGLE_MAPS_API_KEY}&components=country:GB&bounds=51.2868,-0.5103|51.6919,0.3340`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" || !data.results[0]) {
    return {
      lat: null,
      lng: null,
      resolvedFormatted: null,
      resolvedHouseNumber: null,
      locationType: null,
    };
  }

  const result = data.results[0];
  const houseNumberComponent = result.address_components?.find((c: any) =>
    c.types.includes("street_number")
  );

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    resolvedFormatted: result.formatted_address || null,
    resolvedHouseNumber: houseNumberComponent?.long_name || null,
    locationType: result.geometry.location_type || null,
  };
}

export async function POST(req: NextRequest) {
  const { addresses } = await req.json();

  const results = await Promise.all(
    addresses.map(async (address: string) => {
      const searchAddress = address.toLowerCase().includes("uk") || address.toLowerCase().includes("united kingdom")
        ? address
        : `${address}, UK`;

      try {
        const attempt = await geocodeWithGoogle(searchAddress);

        console.log(
          `Geocode for "${address}": resolved=${attempt.resolvedFormatted}, locationType=${attempt.locationType}, houseNumber=${attempt.resolvedHouseNumber}`
        );

        if (attempt.lat === null || attempt.lng === null) {
          return {
            address,
            lat: null,
            lng: null,
            verified: false,
            error: "Geocoding failed: no match found",
          };
        }

        const queryHouseNumber = extractQueryHouseNumber(address);
        const houseNumberMatches =
          !queryHouseNumber ||
          !attempt.resolvedHouseNumber ||
          queryHouseNumber === attempt.resolvedHouseNumber.toLowerCase();

        const isRooftop = attempt.locationType === "ROOFTOP";
        const verified = houseNumberMatches && (isRooftop || attempt.locationType === "RANGE_INTERPOLATED");

        return {
          address,
          lat: attempt.lat,
          lng: attempt.lng,
          resolvedFormatted: attempt.resolvedFormatted,
          verified,
          error: null,
        };
      } catch (err: any) {
        return {
          address,
          lat: null,
          lng: null,
          verified: false,
          error: "Geocoding request failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
