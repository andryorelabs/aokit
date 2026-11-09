declare module "@tanstack/react-virtual" {
  export interface VirtualItem {
    index: number;
    key: string | number;
    start: number;
    size: number;
  }

  export function useVirtualizer(options: {
    count: number;
    getScrollElement: () => object | null;
    estimateSize: (index: number) => number;
  }): { getVirtualItems(): VirtualItem[]; getTotalSize(): number };
}
