import { useTranslation } from "react-i18next";
import type { ThemePalette } from "@nonet/shared";

const FILLED_CELLS = new Set([0, 1, 5, 6, 11, 12, 13, 17, 18, 19, 23]);

/** A small static mock of the board + score HUD, painted with a candidate palette — lets the Shop show what a theme looks like before purchase (§19), without mounting the real game. */
export function ThemePreviewMock({ palette }: { readonly palette: ThemePalette }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-lg border" style={{ background: palette.bg, borderColor: palette.blockDivider }}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: palette.textDim }}>
          {t("scoreHud.score")}
        </span>
        <span className="text-sm font-bold" style={{ color: palette.text }}>
          2,966
        </span>
      </div>
      <div className="flex justify-center pb-3">
        <div
          className="grid grid-cols-5 gap-[2px] rounded-md p-1.5"
          style={{ background: palette.board }}
        >
          {Array.from({ length: 25 }, (_, i) => (
            <div
              key={i}
              className="h-6 w-6 rounded-[3px]"
              style={{ background: FILLED_CELLS.has(i) ? palette.cellFilled : palette.cellEmpty }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-center gap-2 pb-3">
        {[palette.accent, palette.cellFilled, palette.accent].map((color, i) => (
          <div key={i} className="h-4 w-4 rounded-[3px]" style={{ background: color }} />
        ))}
      </div>
    </div>
  );
}
