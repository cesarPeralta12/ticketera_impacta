/**
 * Límite de intentos: cuenta por ventana de tiempo, sin bloquear a otros y sin contar de más.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomCode } from "@ticketera/core";
import { prisma } from "../src/client";
import { hit, isLimited, recordHit } from "../src/operations/rate-limit";

afterAll(() => prisma.$disconnect());

const key = () => `prueba:${randomCode(8)}`;
const rule = { limit: 3, windowSeconds: 60 };

describe("límite de intentos", () => {
  it("permite hasta el límite y rechaza el siguiente sin anotarlo", async () => {
    const k = key();
    expect(await hit(k, rule)).toBe(true);
    expect(await hit(k, rule)).toBe(true);
    expect(await hit(k, rule)).toBe(true);
    expect(await hit(k, rule)).toBe(false);
    expect(await prisma.rateLimitHit.count({ where: { key: k } })).toBe(3);
  });

  it("cada clave tiene su propio contador", async () => {
    const [a, b] = [key(), key()];
    for (let i = 0; i < 3; i++) await hit(a, rule);
    expect(await hit(a, rule)).toBe(false);
    expect(await hit(b, rule)).toBe(true);
  });

  it("al pasar la ventana vuelve a permitir", async () => {
    const k = key();
    const start = new Date(Date.now() - 120_000);
    for (let i = 0; i < 3; i++) await recordHit(k, start);
    expect(await isLimited(k, rule, new Date(start.getTime() + 30_000))).toBe(true);
    expect(await isLimited(k, rule)).toBe(false); // ahora: los intentos tienen 2 minutos
    expect(await hit(k, rule)).toBe(true);
  });

  it("solo contar los fallos: consultar no anota, anotar sí", async () => {
    const k = key();
    expect(await isLimited(k, rule)).toBe(false);
    expect(await prisma.rateLimitHit.count({ where: { key: k } })).toBe(0);
    for (let i = 0; i < 3; i++) await recordHit(k);
    expect(await isLimited(k, rule)).toBe(true);
  });
});
