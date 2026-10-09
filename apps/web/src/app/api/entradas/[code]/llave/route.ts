import { LIMITS, hit, issueTicketKey } from "@ticketera/db";
import { auth } from "@/lib/auth";
import { requestContext } from "@/lib/client-ip";

type Params = { params: Promise<{ code: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Llave del QR dinámico de una entrada, para el celular de su dueño: con ella la página de la entrada
 * calcula el QR sin internet. Solo la recibe quien tiene la entrada ahora; cada entrega queda registrada.
 */
export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "Inicia sesión para abrir tu entrada." }, 401);
  if (!(await hit(`ticketkey:${session.user.id}`, LIMITS.ticketKeyByAccount))) {
    return json({ error: "Demasiados intentos. Espera unos minutos y vuelve a intentar." }, 429);
  }
  const { code } = await params;
  const result = await issueTicketKey(session.user.id, code.trim().toUpperCase(), await requestContext());
  if (result.ok) return json(result);
  if (result.reason === "NOT_DYNAMIC") return json({ error: "Esta entrada tiene un QR fijo.", reason: result.reason }, 409);
  if (result.reason === "NOT_AVAILABLE") return json({ error: "Esta entrada ya no está disponible (anulada o el evento terminó).", reason: result.reason }, 410);
  return json({ error: "No encontramos esa entrada en tu cuenta.", reason: result.reason }, 404);
}
