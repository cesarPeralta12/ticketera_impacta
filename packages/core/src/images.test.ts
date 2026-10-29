import { describe, expect, it } from "vitest";
import { eventImagePath, eventImageType, normalizeImageUrl } from "./images";

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

describe("fotos de eventos subidas", () => {
  const bytes = (...head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)]);
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

  it("reconoce JPG, PNG y WebP por su contenido, no por el nombre", () => {
    expect(eventImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(eventImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(eventImageType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe("image/webp");
  });

  it("rechaza lo que no es una foto (un SVG puede llevar código)", () => {
    expect(eventImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(eventImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(eventImageType(new Uint8Array())).toBeNull();
  });

  it("su dirección en el sitio", () => {
    expect(eventImagePath("abc123")).toBe("/imagenes/abc123");
  });
});
