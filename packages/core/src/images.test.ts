import { describe, expect, it } from "vitest";
import { normalizeImageUrl } from "./images";

describe("normalizeImageUrl", () => {
  it("extrae la imagen real de un enlace de Google Imágenes", () => {
    const google =
      "https://www.google.com/imgres?q=luck%20ra&imgurl=https%3A%2F%2Fi0.wp.com%2Fsitio.com%2Ffoto.jpg%3Fresize%3D696%252C515%26ssl%3D1&imgrefurl=https%3A%2F%2Fsitio.com%2Fnota&w=696";
    expect(normalizeImageUrl(google)).toBe("https://i0.wp.com/sitio.com/foto.jpg?resize=696%2C515&ssl=1");
  });

  it("también funciona con dominios de Google de otros países", () => {
    expect(normalizeImageUrl("https://www.google.com.bo/imgres?imgurl=https%3A%2F%2Fa.com%2Fb.png")).toBe(
      "https://a.com/b.png",
    );
  });

  it("extrae la imagen real de un enlace de Bing", () => {
    expect(
      normalizeImageUrl("https://www.bing.com/images/search?view=detailV2&mediaurl=https%3A%2F%2Fa.com%2Fc.jpg"),
    ).toBe("https://a.com/c.jpg");
  });

  it("deja intactas las URL directas", () => {
    expect(normalizeImageUrl("https://images.unsplash.com/photo-1?w=1200")).toBe("https://images.unsplash.com/photo-1?w=1200");
  });
});
