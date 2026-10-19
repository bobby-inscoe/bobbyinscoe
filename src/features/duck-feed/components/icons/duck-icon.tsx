import type React from 'react';
import ducky from '@/assets/duck.svg';

interface DuckIconProps extends Omit<React.SVGProps<SVGSVGElement>, 'size'> {
  size?: number | string;
  /** Renders the full-colour duck instead of the line-art icon. */
  useOriginalArt?: boolean;
}

/**
 * A rubber-duck-shaped icon hand-drawn to match lucide-react's conventions
 * (24x24 viewBox, round caps/joins, `currentColor` stroke) since lucide has
 * no duck icon of its own — keeps the duck avatar visually consistent with
 * the Snail/Leaf/Wheat icons used elsewhere in this feature.
 */
export function DuckIcon({
  size = 24,
  strokeWidth = 2,
  color = 'currentColor',
  useOriginalArt = false,
  className,
  ...props
}: DuckIconProps): React.JSX.Element {
  if (useOriginalArt) {
    return (
      <img
        src={ducky}
        alt=""
        className={className}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M11.5 9.5C6.5 10 2.5 12.5 2.3 16 2.1 19.5 6.5 21.8 12 21.8s9.5-2.6 9-6.3c-.4-3-3-5.2-5.5-5.7-1.5-.3-2.8-.5-4-.3Z" />
      <circle cx="15.2" cy="6.3" r="3.8" />
      <circle cx="16.5" cy="5.3" r="0.5" fill={color} stroke="none" />
      <path d="M11 6.9C8.3 6.6 6.8 7.1 6.1 8c.9.6 2.9.6 4.4 0" />
      <path d="M7 13.2c3 .4 5.3 1.8 4.8 4.4" />
    </svg>
  );
}
