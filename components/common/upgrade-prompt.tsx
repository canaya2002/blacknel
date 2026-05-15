import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLANS, type PlanCode } from '@/lib/plans/plans';

interface UpgradePromptProps {
  /** Plan tier that unlocks the feature. */
  unlocksOn: PlanCode;
  feature: string;
  description?: string;
}

/**
 * Inline upgrade prompt shown when the current plan blocks a feature.
 * Tone is informative — not pushy. Lands in module pages today and
 * gets reused by `<FeatureGate>` in later phases when feature gating
 * is enforced at the component boundary.
 */
export function UpgradePrompt({
  unlocksOn,
  feature,
  description,
}: UpgradePromptProps): React.ReactElement {
  const plan = PLANS[unlocksOn];
  const price = (plan.priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  return (
    <Card className="bg-muted/20">
      <CardHeader>
        <CardTitle className="text-base">
          Available on the {plan.name} plan
        </CardTitle>
        <CardDescription>
          {description ??
            `${feature} unlocks when your workspace moves to ${plan.name} (${price}/month).`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="sm" variant="outline">
          <Link href="/billing">
            Compare plans
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
