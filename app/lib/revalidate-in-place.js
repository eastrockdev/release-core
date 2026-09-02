export async function revalidateInPlace(revalidator) {
  const scrollingElement = typeof document !== "undefined" ? document.scrollingElement : null;
  const scrollX = typeof window !== "undefined" ? window.scrollX : 0;
  const scrollY = scrollingElement?.scrollTop ?? (typeof window !== "undefined" ? window.scrollY : 0);

  await revalidator.revalidate();

  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY);
      if (scrollingElement) scrollingElement.scrollTop = scrollY;
    });
  });
}
