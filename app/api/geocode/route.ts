import { NextRequest, NextResponse } from "next/server";

function extractTrailingPartialPostcode(address: string): {
  strippedAddress: string;
  partialCode: string | null;
} {
  const match = address.match(/,?\s*([A-Z]{1,2}\d[A-Z\d]?)\s*$/i);
  if (match) {
    const partialCode = match[1].toUpperCase();
    const strippedAddress = address
      .slice(0, match.index ?? address.length)
      .trim()
      .replace(/,$/, "");
    return { strippedAddress, partialCode };
  }

  return { strippedAddress: address, partialCode: null };
}

async function geocodeOnce(queryAddress: string) {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(
    queryAddress
  )}&key=${process.env.OPENCAGE_API_KEY}&limit=1&no_annotations=1&countrycode=gb&bounds=-0.5103,51.2868,0.3340,51.6919`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status.code !== 200 || !data.results[0]) {
    return {
      lat: null,
      lng: null,
      confidence: null,
      resolvedFormatted: null,
      resolvedPostcode: null,
    };
  }

  const result = data.results[0];
  return {
    lat: result.geometry.lat,
    lng: result.geometry.lng,
    confidence: result.confidence ?? null,
    resolvedFormatted: result.formatted || null,
    resolvedPostcode: result.components?.postcode || null,
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
        const LOW_CONFIDENCE_THRESHOLD = 6;
        let attempt = await geocodeOnce(searchAddress);
        let usedStrippedQuery = false;

        if (
          (attempt.confidence === null ||
            attempt.confidence < LOW_CONFIDENCE_THRESHOLD) &&
          attempt.lat !== null
        ) {
          // Strip from the original address: searchAddress may end with ", UK".
          const { strippedAddress, partialCode } =
            extractTrailingPartialPostcode(address);

          if (partialCode && strippedAddress !== address) {
            const strippedSearchAddress =
              strippedAddress.toLowerCase().includes("uk") ||
              strippedAddress.toLowerCase().includes("united kingdom")
                ? strippedAddress
                : `${strippedAddress}, UK`;
            const retryAttempt = await geocodeOnce(strippedSearchAddress);

            if (
              retryAttempt.lat !== null &&
              retryAttempt.confidence !== null &&
              retryAttempt.confidence >= LOW_CONFIDENCE_THRESHOLD
            ) {
              const resolvedPostcodeStart = retryAttempt.resolvedPostcode
                ?.toUpperCase()
                .replace(/\s/g, "")
                .slice(0, partialCode.length);
              const partialCodeNormalized = partialCode.replace(/\s/g, "");

              if (resolvedPostcodeStart === partialCodeNormalized) {
                attempt = retryAttempt;
                usedStrippedQuery = true;
              }
            }
          }
        }

        console.log(
          `Geocode for "${address}": confidence=${attempt.confidence}, usedStrippedQuery=${usedStrippedQuery}, resolved=${attempt.resolvedFormatted}`
        );

        if (attempt.lat === null || attempt.lng === null) {
          return {
            address,
            lat: null,
            lng: null,
            confidence: null,
            error: "Geocoding failed: no match found",
          };
        }

        return {
          address,
          lat: attempt.lat,
          lng: attempt.lng,
          confidence: attempt.confidence,
          resolvedFormatted: attempt.resolvedFormatted,
          error: null,
        };
      } catch {
        return {
          address,
          lat: null,
          lng: null,
          confidence: null,
          resolvedFormatted: null,
          error: "Geocoding request failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
