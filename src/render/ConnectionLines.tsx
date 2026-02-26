import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from "three";
import type { BuildSystem } from "../layered-shuffle/build-system";

const LINE_COLOR = 0xffffff;
const LINE_OPACITY = 0.3;

type ConnectionLinesProps = {
  buildSystem: BuildSystem;
};

export function ConnectionLines({ buildSystem }: ConnectionLinesProps) {
  const objRef = useRef(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: LINE_COLOR,
        transparent: true,
        opacity: LINE_OPACITY,
        depthWrite: false,
      }),
    ),
  );

  useEffect(() => {
    objRef.current.renderOrder = 20;
  }, []);

  useFrame(() => {
    const lines = buildSystem.getConnectionLines();
    const positions: number[] = [];

    for (const line of lines) {
      positions.push(
        line.from[0], line.from[1], line.from[2],
        line.to[0], line.to[1], line.to[2],
      );
    }

    const geo = objRef.current.geometry;
    if (positions.length > 0) {
      const attr = geo.getAttribute("position") as Float32BufferAttribute | undefined;
      if (attr && attr.array.length === positions.length) {
        (attr.array as Float32Array).set(positions);
        attr.needsUpdate = true;
      } else {
        geo.setAttribute(
          "position",
          new Float32BufferAttribute(new Float32Array(positions), 3),
        );
      }
    } else if (geo.hasAttribute("position")) {
      geo.deleteAttribute("position");
    }
  });

  return <primitive object={objRef.current} />;
}
