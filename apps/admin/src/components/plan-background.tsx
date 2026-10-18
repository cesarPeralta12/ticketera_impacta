import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@ticketera/core";

/** Imagen del plano real del recinto, de fondo en los editores para calcar (el comprador no la ve). */
export type PlanBackgroundInfo = { url: string; opacity: number } | null;

export function PlanBackground({ background }: { background?: PlanBackgroundInfo }) {
  if (!background) return null;
  return (
    <image
      href={background.url}
      x={0}
      y={0}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      preserveAspectRatio="xMidYMid meet"
      opacity={background.opacity / 100}
      pointerEvents="none"
    />
  );
}
