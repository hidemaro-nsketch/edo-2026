import { useMemo } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
} from "three";
import type { LayerState } from "../layered-shuffle/types";
import { getSlotWorldPos } from "../sakura/constants";
import type { SegmentInfo } from "../sakura/types";

const LINE_COLOR = 0xffffff;
const LINE_OPACITY = 0.3;

const lineMaterial = new LineBasicMaterial({
  color: LINE_COLOR,
  transparent: true,
  opacity: LINE_OPACITY,
  depthWrite: false,
});

type ConnectionLinesProps = {
  layers: LayerState[];
  segments: SegmentInfo[];
  layerSpacing: number;
};

export function ConnectionLines({
  layers,
  segments,
  layerSpacing,
}: ConnectionLinesProps) {
  const geometry = useMemo(() => {
    const positions: number[] = [];

    for (const layer of layers) {
      if (layer.gen === 0 || !layer.alive) continue;

      // Only draw lines if the previous layer is also alive
      const prevLayer = layers.find(
        (l) => l.gen === layer.gen - 1 && l.alive
      );
      if (!prevLayer) continue;

      const zFrom = prevLayer.z;
      const zTo = layer.z;

      for (const link of layer.linksFromPrev) {
        const [x, y] = getSlotWorldPos(segments, link.slotIndex);
        positions.push(x, y, zFrom, x, y, zTo);
      }
    }

    const geo = new BufferGeometry();
    if (positions.length > 0) {
      geo.setAttribute(
        "position",
        new Float32BufferAttribute(new Float32Array(positions), 3)
      );
    }
    return geo;
  }, [layers, segments, layerSpacing]);

  if (!geometry.attributes.position) return null;

  return <lineSegments geometry={geometry} material={lineMaterial} />;
}
