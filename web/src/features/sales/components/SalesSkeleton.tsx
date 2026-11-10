import { SkeletonBar } from "../../../shared/ui/Skeleton";
import { size, skeletonRows, space } from "../../../shared/theme/tokens";

export function SalesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the sales report" style={{ paddingTop: space.xl }}>
      <SkeletonBar width="40%" />
      <SkeletonBar width="55%" height={size.figure} />
      <SkeletonBar width="70%" />
      {(["operators", "rules", "refusals"] as const).map((k) => (
        <div key={k} style={{ marginTop: space.xxl }}>
          <SkeletonBar width="20%" height={size.heading} />
          {Array.from({ length: skeletonRows[k] }, (_, i) => (
            <SkeletonBar key={i} width="100%" />
          ))}
        </div>
      ))}
    </div>
  );
}
