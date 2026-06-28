import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bindSigmaWheelZoomController,
  sigmaViewportCenter,
  sigmaWheelInputFromPayload,
  sigmaWheelTargetIsZoomControl
} from "../src/render/sigma-wheel-zoom";
import { sigmaWheelZoomRatio } from "../src/render/sigma-zoom";
import type { SigmaGlobalSigmaLike } from "../src/render/sigma-global-types";

describe("Sigma wheel zoom controller", () => {
  it("binds one wheel listener and unregisters the same listener on destroy", () => {
    const captor = fakeCaptor();

    const controller = bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => false,
      currentRatio: () => 1,
      onZoomAtPoint: () => undefined
    });

    assert.equal(captor.onCalls.length, 1);
    controller.destroy();
    assert.equal(captor.offCalls.length, 1);
    assert.equal(captor.offCalls[0]?.listener, captor.onCalls[0]?.listener);
  });

  it("makes late wheel events no-op after destroy even when captor still invokes the listener", () => {
    const captor = fakeCaptor();
    let zoomCalls = 0;
    let destroyed = false;
    bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => destroyed,
      currentRatio: () => 1,
      onZoomAtPoint: () => {
        zoomCalls += 1;
      }
    });

    destroyed = true;
    captor.emit({ original: { deltaY: 120 } });

    assert.equal(zoomCalls, 0);
  });

  it("ignores invalid payloads", () => {
    const captor = fakeCaptor();
    let zoomCalls = 0;
    bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => false,
      currentRatio: () => 1,
      onZoomAtPoint: () => {
        zoomCalls += 1;
      }
    });

    captor.emit({});

    assert.equal(zoomCalls, 0);
  });

  it("parses delta and pointer fallbacks consistently", () => {
    assert.deepEqual(
      sigmaWheelInputFromPayload({ x: 5, y: 6, delta: -10, original: { deltaY: 120, deltaMode: 1 } }, { x: 50, y: 60 }),
      { point: { x: 5, y: 6 }, delta: { deltaY: 120, deltaMode: 1 } }
    );
    assert.deepEqual(
      sigmaWheelInputFromPayload({ delta: -2 }, { x: 50, y: 60 }),
      { point: { x: 50, y: 60 }, delta: { deltaY: 240, deltaMode: 0 } }
    );
    assert.equal(sigmaWheelInputFromPayload({ original: { deltaY: Number.NaN } }, { x: 0, y: 0 }), null);
  });

  it("prevents zoom-control wheel events without zooming", () => {
    const captor = fakeCaptor();
    let zoomCalls = 0;
    let prevented = 0;
    bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => false,
      currentRatio: () => 1,
      onZoomAtPoint: () => {
        zoomCalls += 1;
      }
    });

    captor.emit({
      original: {
        deltaY: 120,
        target: { closest: (selector: string) => selector === "[data-control=\"sigma-zoom\"]" }
      },
      preventSigmaDefault: () => {
        prevented += 1;
      }
    });

    assert.equal(sigmaWheelTargetIsZoomControl(captor.lastPayload), true);
    assert.equal(prevented, 1);
    assert.equal(zoomCalls, 0);
  });

  it("uses viewport center and reports thrown zoom errors", () => {
    const captor = fakeCaptor();
    const errors: unknown[] = [];
    const points: Array<{ x: number; y: number }> = [];
    bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => false,
      currentRatio: () => 1,
      onZoomAtPoint: (point) => {
        points.push(point);
        throw new Error("zoom failed");
      },
      onFatalError: (error) => errors.push(error)
    });

    captor.emit({ original: { deltaY: 120 } });

    assert.deepEqual(sigmaViewportCenter(rootWithRect(200, 100)), { x: 100, y: 50 });
    assert.deepEqual(points, [{ x: 100, y: 50 }]);
    assert.equal((errors[0] as Error).message, "zoom failed");
  });

  it("passes the next wheel ratio to the zoom callback", () => {
    const captor = fakeCaptor();
    let nextRatio = 0;
    bindSigmaWheelZoomController({
      sigma: sigmaWithCaptor(captor),
      root: rootWithRect(200, 100),
      isDestroyed: () => false,
      currentRatio: () => 1.2,
      onZoomAtPoint: (_point, ratio) => {
        nextRatio = ratio;
      }
    });

    captor.emit({ original: { deltaY: 120 } });

    assert.equal(nextRatio, sigmaWheelZoomRatio(1.2, { deltaY: 120, deltaMode: 0 }));
  });
});

function fakeCaptor() {
  const state = {
    onCalls: [] as Array<{ event: "wheel"; listener: (payload?: unknown) => void }>,
    offCalls: [] as Array<{ event: "wheel"; listener: (payload?: unknown) => void }>,
    lastPayload: undefined as unknown,
    on(event: "wheel", listener: (payload?: unknown) => void) {
      state.onCalls.push({ event, listener });
    },
    off(event: "wheel", listener: (payload?: unknown) => void) {
      state.offCalls.push({ event, listener });
    },
    emit(payload: unknown) {
      state.lastPayload = payload;
      state.onCalls[0]?.listener(payload);
    }
  };
  return state;
}

function sigmaWithCaptor(captor: ReturnType<typeof fakeCaptor>): SigmaGlobalSigmaLike {
  return {
    getMouseCaptor: () => captor
  };
}

function rootWithRect(width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width, height })
  } as HTMLElement;
}
