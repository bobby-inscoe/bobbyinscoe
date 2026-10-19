import { Wheat } from 'lucide-react';
import type React from 'react';
import cereal from '@/features/duck-feed/assets/cereal.png';

interface WheatIconProps extends Omit<React.SVGProps<SVGSVGElement>, 'size'> {
  size?: number | string;
  /** Renders the original cereal.png artwork instead of lucide's Wheat icon. */
  useOriginalArt?: boolean;
}

/** Thin wrapper around lucide's Wheat icon that can fall back to the original cereal.png artwork. */
export function WheatIcon({
  size = 24,
  strokeWidth = 2,
  color = 'currentColor',
  useOriginalArt = false,
  className,
  ...props
}: WheatIconProps): React.JSX.Element {
  if (useOriginalArt) {
    return (
      <img
        src={cereal}
        alt=""
        className={className}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }

  return (
    <Wheat
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
      {...props}
    />
  );
}
