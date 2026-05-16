import { BarChart3 } from 'lucide-react';

interface EmptyChartProps {
  message: string;
  /** Optional override icon. Defaults to a generic chart glyph. */
  icon?: React.ReactNode;
  height?: number;
}

/**
 * Shared "no data" stand-in for the chart wrappers. Domain components
 * call this when their data array is empty so the layout doesn't
 * collapse and the user knows the chart is intentional but quiet.
 *
 * Keep it dumb — no animations, no CTAs. Empty-state CTAs live in the
 * domain card containing the chart (see /reputation cards).
 */
export function EmptyChart({
  message,
  icon,
  height = 240,
}: EmptyChartProps): React.ReactElement {
  return (
    <div
      className="flex w-full items-center justify-center rounded-md border border-dashed bg-card/30 text-xs text-muted-foreground"
      style={{ height }}
      role="status"
    >
      <div className="flex flex-col items-center gap-2 px-4 text-center">
        {icon ?? <BarChart3 className="h-5 w-5 text-muted-foreground/60" aria-hidden />}
        <span>{message}</span>
      </div>
    </div>
  );
}
