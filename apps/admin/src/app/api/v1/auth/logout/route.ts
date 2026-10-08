import { endDeviceSession } from "@ticketera/db";
import { json } from "@/lib/mobile-auth";

export async function POST(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (token) await endDeviceSession(token);
  return json({ ok: true });
}
