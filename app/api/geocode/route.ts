import { NextRequest, NextResponse } from "next/server";

function extractTrailingPartialPostcode(address: string): {
  strippedAddress: string;
  partialCode: string | null;
} {
  const withoutCountry = address
    .replace(/,\s*(UK|United Kingdom)\s*$/i, "")
    .trim();
  const match = withoutCountry.match(/,?\s*([A-Z]{1,2}\d[A-Z\d]?)\s*$/i);
  if (match) {
    const partialCode = match[1].toUpperCase();
    const strippedAddress = withoutCountry
      .slice(0, match.index ?? withoutCountry.length)
      .trim()
      .replace(/,$/, "");
    return { strippedAddress, partialCode };
  }

  return { strippedAddress: address, partialCode: null };
}

function resultSeemsToMatchStreet(
  queryAddress: string,
  resolvedFormatted: string | null
): boolean {
  if (!resolvedFormatted) return false;

  const ignoredTokens = new Set([
    "the",
    "and",
    "road",
    "street",
    "lane",
    "avenue",
    "place",
    "square",
    "court",
    "way",
    "drive",
    "close",
    "london",
    "uk",
    "united",
    "kingdom",
    "england",
  ]);
  const tokensFor = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !ignoredTokens.has(token) &&
          !/^[a-z]{1,2}\d[a-z\d]?$/.test(token) &&
          !/^\d+$/.test(token)
      );

  const queryTokens = tokensFor(queryAddress);
  const resolvedTokens = new Set(tokensFor(resolvedFormatted));
  return queryTokens.some((token) => resolvedTokens.has(token));
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
        let streetQuery = searchAddress;

        const attemptMatchesStreet = resultSeemsToMatchStreet(
          searchAddress,
          attempt.resolvedFormatted
        );

        if (
          (!attemptMatchesStreet ||
            attempt.confidence === null ||
            attempt.confidence < LOW_CONFIDENCE_THRESHOLD) &&
          attempt.lat
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
                streetQuery = strippedAddress;
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
            verified: false,
            error: "Geocoding failed: no match found",
          };
        }

        const finalMatchesStreet = resultSeemsToMatchStreet(
          streetQuery,
          attempt.resolvedFormatted
        );
        const verified =
          finalMatchesStreet &&
          (attempt.confidence === null ||
            attempt.confidence >= LOW_CONFIDENCE_THRESHOLD ||
            usedStrippedQuery);

        return {
          address,
          lat: attempt.lat,
          lng: attempt.lng,
          confidence: attempt.confidence,
          resolvedFormatted: attempt.resolvedFormatted,
          verified,
          error: null,
        };
      } catch {
        return {
          address,
          lat: null,
          lng: null,
          confidence: null,
          resolvedFormatted: null,
          verified: false,
          error: "Geocoding request failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
