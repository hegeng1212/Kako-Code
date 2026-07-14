import { useEffect, useState, type RefObject } from "react";

/** Flip dropdown above the trigger when there is not enough viewport space below. */
export function useDropdownPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
): boolean {
  const [dropUp, setDropUp] = useState(false);

  useEffect(() => {
    if (!open) {
      setDropUp(false);
      return;
    }

    const measure = () => {
      const anchor = anchorRef.current;
      const list = listRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const menuHeight = list?.getBoundingClientRect().height ?? 200;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      setDropUp(spaceBelow < menuHeight && spaceAbove > spaceBelow);
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef, listRef]);

  return dropUp;
}
