declare module "@tanstack/react-table" {
  import type { ComponentType, ReactNode } from "react";

  export interface TableFeatures {
    readonly kind: "table-features";
  }

  export interface ColumnDef<_Features, Row> {
    accessorKey?: keyof Row & string;
    header?: string | (() => ReactNode);
  }

  export interface HeaderCell {
    id: string;
    isPlaceholder: boolean;
  }

  export interface BodyCell {
    id: string;
  }

  export interface TableInstance {
    FlexRender: ComponentType<{ header?: HeaderCell; cell?: BodyCell }>;
    getHeaderGroups(): { id: string; headers: HeaderCell[] }[];
    getRowModel(): { rows: { id: string; getAllCells(): BodyCell[] }[] };
  }

  export function tableFeatures(features: object): TableFeatures;

  export function useTable<Row>(options: {
    features: TableFeatures;
    columns: ColumnDef<TableFeatures, Row>[];
    data: Row[];
  }): TableInstance;
}
