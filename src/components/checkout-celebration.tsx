import type { CSSProperties } from "react";
import { Sparkles } from "lucide-react";

// Decorative only: mounted after a confirmed, valid checkout, never on page load.
export function CheckoutCelebration({ goalReached }: { goalReached: boolean }) {
  const count = goalReached ? 28 : 18;
  return (
    <span
      aria-hidden="true"
      data-testid="checkout-celebration"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
    >
      <Sparkles className="checkout-static-sparkle absolute right-2 top-2 h-5 w-5 text-emerald-700" />
      {Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        const distance = (goalReached ? 100 : 75) + (index % 3) * 12;
        return (
          <span
            key={index}
            className="checkout-confetti absolute left-1/2 top-1/2 h-2 w-1.5 rounded-sm"
            style={
              {
                backgroundColor: ["#2563eb", "#eab308", "#0d9488"][index % 3],
                "--burst-x": `${Math.cos(angle) * distance}px`,
                "--burst-y": `${Math.sin(angle) * 42 - 12}px`,
                "--burst-spin": `${index % 2 ? 240 : -240}deg`,
                animationDelay: `${(index % 3) * 35}ms`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
