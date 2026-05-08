import type { BusOperator } from "../types";

export type VariantStyle = {
  color: string;
  weight: number;
  opacity: number;
  bringToFront: boolean;
};

export function busRouteColor(operator: BusOperator): string {
  if (operator === "buseireann") return "#d52b1e";
  if (operator === "goahead") return "#1e6bb8";
  return "#f9a825";
}

export function reconcileSelectedVariant(
  selectedShapeId: string | null,
  activeShapeIds: ReadonlySet<string>,
): string | null {
  if (!selectedShapeId) return null;
  return activeShapeIds.has(selectedShapeId) ? selectedShapeId : null;
}

export function variantStyleForShape(
  shapeId: string,
  selectedShapeId: string | null,
  activeShapeIds: ReadonlySet<string>,
  color: string,
): VariantStyle {
  const isSelected = shapeId === selectedShapeId;
  const isActive = activeShapeIds.has(shapeId);
  return {
    color,
    weight: isSelected ? 5 : 3,
    opacity: isSelected ? 0.95 : isActive ? 0.35 : 0,
    bringToFront: isSelected,
  };
}
