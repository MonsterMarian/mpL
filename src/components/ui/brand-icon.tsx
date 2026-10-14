import { BRAND_MARK } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * Značka appky jako ikona - místo noty všude, kde se ukazuje hudba.
 *
 * Obrázek značky slouží jen jako maska a barvu bere z textu (`bg-current`),
 * takže se chová jako ikona lucide: velikost z `className` (`size-4`),
 * barva podle okolí - ztlumená v seznamu, oranžová na aktivním tlačítku.
 */
export function BrandIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      style={{
        maskImage: `url("${BRAND_MARK}")`,
        WebkitMaskImage: `url("${BRAND_MARK}")`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
