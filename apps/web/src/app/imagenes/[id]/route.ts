import { prisma } from "@ticketera/db";

type Props = { params: Promise<{ id: string }> };

/**
 * Foto de un evento subida desde el panel (la dirección que queda en `imageUrl`). Cada subida es una foto nueva y nunca
 * cambia, así que el navegador la guarda en caché para siempre. Solo hay JPG, PNG o WebP (el panel no acepta SVG, que
 * podría llevar código).
 */
export async function GET(_req: Request, { params }: Props) {
  const image = await prisma.eventImage.findUnique({ where: { id: (await params).id }, select: { data: true, mimeType: true } });
  if (!image) return new Response("Foto no encontrada.", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
