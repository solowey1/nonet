import { Bomb, Eraser, PaintBucket, Pencil, Rocket, type LucideIcon } from "lucide-react";
import type { PowerupKind } from "@nonet/shared";

/** One icon per power-up kind, shared everywhere a kind is rendered (inventory bar, shop, main menu) so a choice only lives in one place. */
export const POWERUP_ICON: Record<PowerupKind, LucideIcon> = {
  pencil: Pencil,
  eraser: Eraser,
  rocket: Rocket,
  bomb: Bomb,
  fill: PaintBucket,
};
