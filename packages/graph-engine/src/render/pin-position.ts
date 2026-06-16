import type { PinCoordinateSpace, PinPosition } from "../types";
import { GRAPH_WORLD_SIZE } from "./geometry";

export const WORLD_PIN_COORDINATE_SPACE = "world";
export const LEGACY_PERCENT_PIN_COORDINATE_SPACE = "legacy-percent";

export interface WorldPinPoint {
  x: number;
  y: number;
}

export function normalizeStoredPinPosition(position: PinPosition): PinPosition {
  const normalized: PinPosition = {
    x: finitePositionCoordinate(position.x),
    y: finitePositionCoordinate(position.y)
  };
  if (isPinCoordinateSpace(position.coordinateSpace)) {
    normalized.coordinateSpace = position.coordinateSpace;
  }
  return normalized;
}

export function normalizeWorldPinPosition(position: PinPosition): PinPosition {
  return {
    x: finitePositionCoordinate(position.x),
    y: finitePositionCoordinate(position.y),
    coordinateSpace: WORLD_PIN_COORDINATE_SPACE
  };
}

export function pinPositionToWorldPoint(position: PinPosition): WorldPinPoint {
  const normalized = normalizeStoredPinPosition(position);
  const coordinateSpace = normalized.coordinateSpace || inferLegacyCoordinateSpace(normalized);
  if (coordinateSpace === LEGACY_PERCENT_PIN_COORDINATE_SPACE) {
    return {
      x: normalized.x / 100 * GRAPH_WORLD_SIZE.width,
      y: normalized.y / 100 * GRAPH_WORLD_SIZE.height
    };
  }
  return {
    x: normalized.x,
    y: normalized.y
  };
}

export function isPinCoordinateSpace(value: unknown): value is PinCoordinateSpace {
  return value === WORLD_PIN_COORDINATE_SPACE || value === LEGACY_PERCENT_PIN_COORDINATE_SPACE;
}

function inferLegacyCoordinateSpace(position: PinPosition): PinCoordinateSpace {
  if (position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100) {
    return LEGACY_PERCENT_PIN_COORDINATE_SPACE;
  }
  return WORLD_PIN_COORDINATE_SPACE;
}

function finitePositionCoordinate(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
