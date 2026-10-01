import { prisma } from "@ticketera/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, app: "admin", db: "up" });
  } catch {
    return Response.json({ ok: false, app: "admin", db: "down" }, { status: 503 });
  }
}
