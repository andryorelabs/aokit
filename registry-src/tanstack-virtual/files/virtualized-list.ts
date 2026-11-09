import { useVirtualizer } from "@tanstack/react-virtual";

const ROW_HEIGHT_ESTIMATE = 36;

export function useVirtualList(scrollElement: object | null, count: number) {
  return useVirtualizer({
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
  });
}
