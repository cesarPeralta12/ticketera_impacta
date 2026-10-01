import { prisma } from "@ticketera/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, app: "web", db: "up" });
  } catch {
    return Response.json({ ok: false, app: "web", db: "down" }, { status: 503 });
  }
}
