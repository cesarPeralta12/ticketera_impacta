import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getQueueStatus, joinQueue, prisma, type QueueStatus } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { QUEUE_COOKIE_MAX_AGE, queueCookieName } from "@/lib/queue-cookie";

type Params = { params: Promise<{ sessionId: string }> };

async function queueSession(sessionId: string) {
  return prisma.eventSession.findFirst({
    where: { id: sessionId, cancelledAt: null, event: { status: "PUBLISHED", mode: "TICKETING", organization: { status: "ACTIVE" } } },
    select: { id: true, queueEnabled: true },
  });
}

function json(status: QueueStatus | { state: "open" }) {
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}

const loginRequired = () => Response.json({ error: "Inicia sesión para entrar a la fila." }, { status: 401 });

/**
 * Entrar a la fila. Exige cuenta (comprar exige cuenta con carnet): una persona, un lugar. El token lo
 * genera el servidor (no el navegador) y viaja en cookie httpOnly.
 */
export async function POST(_request: Request, { params }: Params) {
  const account = await auth();
  if (!account?.user?.id) return loginRequired();
  const session = await queueSession((await params).sessionId);
  if (!session) return Response.json({ error: "Función no encontrada." }, { status: 404 });
  if (!session.queueEnabled) return json({ state: "open" });

  const jar = await cookies();
  let token = jar.get(queueCookieName(session.id))?.value;
  if (!token) {
    token = randomUUID();
    jar.set(queueCookieName(session.id), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: QUEUE_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  await joinQueue(session.id, token, new Date(), account.user.id);
  return json(await getQueueStatus(session.id, token));
}

/** Consultar el turno (la sala de espera pregunta cada pocos segundos). */
export async function GET(_request: Request, { params }: Params) {
  if (!(await auth())?.user?.id) return loginRequired();
  const session = await queueSession((await params).sessionId);
  if (!session) return Response.json({ error: "Función no encontrada." }, { status: 404 });
  if (!session.queueEnabled) return json({ state: "open" });

  const token = (await cookies()).get(queueCookieName(session.id))?.value;
  return json(token ? await getQueueStatus(session.id, token) : { state: "not_joined" });
}
