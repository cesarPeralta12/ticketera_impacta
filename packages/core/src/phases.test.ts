import { describe, expect, it } from "vitest";
import { phaseStates, saleState, withPhases } from "./index";

const day = (n: number) => new Date(Date.UTC(2027, 0, n, 12));
const now = day(10);
const phase = (id: string, order: number, startsAt: Date | null = null) => ({
  id,
  sectionId: "general",
  phaseOrder: order,
  phaseStartsAt: startsAt,
  salesStartAt: null as Date | null,
  salesEndAt: null as Date | null,
});
const types = [phase("hot", 1), phase("f1", 2), phase("f2", 3, day(20)), { ...phase("vip", 1), sectionId: "vip", phaseOrder: null }];
const stock = (used: Record<string, number>, remaining: Record<string, number>) => ({
  used: new Map(Object.entries(used)),
  remaining: new Map(Object.entries(remaining)),
});
const states = (s: ReturnType<typeof stock>, at = now) => Object.fromEntries([...phaseStates(types, s, at)].map(([id, p]) => [id, p.state]));

describe("fases de venta", () => {
  it("al principio se vende solo la primera; los precios comunes no son fases", () => {
    expect(states(stock({}, { hot: 300, f1: 800, f2: 800 }))).toEqual({ hot: "active", f1: "upcoming", f2: "upcoming" });
  });

  it("al agotarse una fase pasa a la siguiente (y si esa también está agotada, a la otra)", () => {
    expect(states(stock({ hot: 300 }, { hot: 0, f1: 800, f2: 800 }))).toEqual({ hot: "done", f1: "active", f2: "upcoming" });
    expect(states(stock({ hot: 300, f1: 800 }, { hot: 0, f1: 0, f2: 800 }))).toEqual({ hot: "done", f1: "done", f2: "active" });
  });

  it("la fecha de una fase la abre aunque la anterior no se haya agotado", () => {
    expect(states(stock({ hot: 10 }, { hot: 290, f1: 800, f2: 800 }), day(21))).toEqual({ hot: "done", f1: "done", f2: "active" });
  });

  it("no vuelve atrás: con ventas en una fase, una reserva vencida no reabre la anterior", () => {
    expect(states(stock({ hot: 299, f1: 3 }, { hot: 1, f1: 797, f2: 800 }))).toEqual({ hot: "done", f1: "active", f2: "upcoming" });
  });

  it("la última fase agotada queda activa (agotada), no se pasa de largo", () => {
    expect(states(stock({ hot: 300, f1: 800, f2: 800 }, { hot: 0, f1: 0, f2: 0 }), day(21))).toEqual({ hot: "done", f1: "done", f2: "active" });
  });

  it("ajusta la ventana: la terminada queda cerrada y la que espera, programada", () => {
    const [hot, f1, f2, vip] = withPhases(types, stock({ hot: 300 }, { hot: 0, f1: 800, f2: 800 }), now);
    expect([hot, f1, f2, vip].map((t) => saleState(t!, now))).toEqual(["closed", "open", "scheduled", "open"]);
    expect(f2!.salesStartAt).toEqual(day(20));
    expect(f1!.phase).toMatchObject({ state: "active", position: 2, total: 3 });
    expect(vip!.phase).toBeNull();
    // Sin fecha, la que espera a que se agote la anterior figura como programada "para nunca".
    const [, waiting] = withPhases(types, stock({}, { hot: 300, f1: 800, f2: 800 }), now);
    expect(saleState(waiting!, day(400))).toBe("scheduled");
  });
});
