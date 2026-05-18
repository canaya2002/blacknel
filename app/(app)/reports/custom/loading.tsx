import { Card, CardContent } from '@/components/ui/card';

export default function CustomReportsLoading(): React.ReactElement {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted/40" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted/40" />
              <div className="h-3 w-full animate-pulse rounded bg-muted/40" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
