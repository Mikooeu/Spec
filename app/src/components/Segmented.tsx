import { useLayoutEffect, useRef, useState, type HTMLAttributes } from "react";

/**
 * Groupe d'onglets (classe .segmented) dont le fond de l'onglet actif glisse d'un onglet à l'autre.
 * Les boutons restent ceux de l'appelant : l'onglet actif est celui qui a la classe « is-active ».
 */
export function Segmented({ className = "segmented", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const active = el.querySelector<HTMLElement>(":scope > button.is-active");
      if (!active) { setBox(null); return; }
      setBox({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const mo = new MutationObserver(place);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true, characterData: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  // pas de glissement au premier affichage : l'indicateur apparaît directement à sa place
  const animate = !first.current;
  useLayoutEffect(() => { if (box) first.current = false; }, [box]);

  return (
    <div ref={ref} className={`${className} segmented--slide`} {...rest}>
      {box && (
        <span className={`segmented__ind${animate ? " is-animated" : ""}`} aria-hidden
              style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }} />
      )}
      {children}
    </div>
  );
}
