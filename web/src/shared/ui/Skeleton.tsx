import { color, layout, space } from "../theme/tokens";

export function SkeletonBar({ width, height = 14 }: { width: string; height?: number }) {
  return (
    <span
      aria-hidden
      style={{ display: "block", width, height, background: color.skeleton, borderRadius: layout.radius, marginBottom: space.s }}
      className="pulse"
    />
  );
}
