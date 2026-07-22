import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

function hasCompleteUKPostcode(address: string | null): boolean {
  if (!address) return false;
  const fullPostcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i;
  return fullPostcodeRegex.test(address);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    address: { type: SchemaType.STRING, nullable: true },
    agentName: { type: SchemaType.STRING, nullable: true },
    agentEmail: { type: SchemaType.STRING, nullable: true },
    agentPhone: { type: SchemaType.STRING, nullable: true },
  },
  required: ["address", "agentName", "agentEmail", "agentPhone"],
};

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

const BATCH_SIZE = 2;
const DELAY_BETWEEN_BATCHES_MS = 8000;
const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractOne(file: File, attempt = 1): Promise<any> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const result = await model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: base64 } },
      {
        text: "Extract the property address and the listing agent's contact details (name, email, phone) from this brochure. The address MUST include the full UK postcode (e.g. EC4N 8AD, not just EC4) if it appears anywhere in the document - check headers, footers, small print, and contact sections carefully, as postcodes are often printed separately from the main address. If a complete postcode genuinely cannot be found anywhere in the document, return the address with whatever partial postcode is available, but prioritize finding the full one. If a field genuinely isn't present, return null for it - do not guess or invent values.",
      },
    ]);

    const rawText = result.response.text();
    console.log(`Raw Gemini response for ${file.name}:`, rawText);
    const parsed = JSON.parse(rawText);

    return {
      sourcePdfName: file.name,
      address: parsed.address,
      agentName: parsed.agentName,
      agentEmail: parsed.agentEmail,
      agentPhone: parsed.agentPhone,
      needsReview: !parsed.address || !parsed.agentEmail || !hasCompleteUKPostcode(parsed.address),
      error: null,
    };
  } catch (err: any) {
    console.error(`Extraction error for ${file.name}:`, err);
    const isRetryable =
      err?.status === 429 ||
      err?.status === 503 ||
      err?.message?.includes("429") ||
      err?.message?.includes("503") ||
      err?.message?.includes("overloaded") ||
      err?.message?.includes("high demand");

    if (isRetryable && attempt <= MAX_RETRIES) {
      const backoff = 10000 * attempt;
      await sleep(backoff);
      return extractOne(file, attempt + 1);
    }

    return {
      sourcePdfName: file.name,
      address: null,
      agentName: null,
      agentEmail: null,
      agentPhone: null,
      needsReview: true,
      error: isRetryable
        ? "Gemini's servers are temporarily overloaded or rate-limited — try again in a minute, or enter manually."
        : "Extraction failed — enter details manually.",
    };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  const results: any[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((f) => extractOne(f)));
    results.push(...batchResults);

    if (i + BATCH_SIZE < files.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return NextResponse.json({ results });
}