import {
  FacebookLogo,
  InstagramLogo,
  LinkedinLogo,
  WhatsappLogo,
  YoutubeLogo,
} from '@phosphor-icons/react';
import { PLATFORM_LABELS, type Platform } from '@growth-desk/contract';
import { Icon, type IconComponent } from '@/components/atoms/Icon';

const ICONS: Record<Platform, IconComponent> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
};

export interface PlatformIconProps {
  platform: Platform;
  size?: number;
  /** Set when the icon stands alone (no visible platform name next to it). */
  labelled?: boolean;
  className?: string;
}

/** Channel logo from Phosphor (the Figma uses the same icon set). */
export function PlatformIcon({
  platform,
  size = 22,
  labelled = false,
  className,
}: PlatformIconProps) {
  return (
    <Icon
      icon={ICONS[platform]}
      size={size}
      className={className}
      {...(labelled ? { label: PLATFORM_LABELS[platform] } : {})}
    />
  );
}
