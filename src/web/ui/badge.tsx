import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        success: 'badge-success',
        warning: 'badge-warning',
        danger: 'badge-danger',
        neutral: 'badge-neutral',
        info: 'badge-info',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeBaseProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function BadgeBase({ className, variant, ...props }: BadgeBaseProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
