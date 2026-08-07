import { NextRequest, NextResponse } from "next/server";
import { geocodeLondonAddress } from "@/app/lib/geocode";

export async function POST(req: NextRequest) {
  const { addresses, purpose } = await req.json();
  const resolvedPurpose = purpose === "start-location" ? "start-location" : "property";

  const results = await Promise.all(
    addresses.map((address: string) =>
      geocodeLondonAddress(address, { purpose: resolvedPurpose })
    )
  );

  return NextResponse.json({ results });
}
