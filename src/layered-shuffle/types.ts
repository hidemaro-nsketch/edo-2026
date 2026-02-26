/** Configuration for the layered shuffle system */
export type ShuffleConfig = {
  /** Maximum number of shuffle generations */
  maxGenerations: number;
  /** Duration of each generation's shuffle phase in seconds */
  shuffleDuration: number;
  /** Minimum interval between individual slot switches in seconds */
  switchIntervalMin: number;
  /** Maximum interval between individual slot switches in seconds */
  switchIntervalMax: number;
  /** Duration of fade-in/fade-out animations in seconds */
  fadeDuration: number;
  /** Z distance between adjacent layers */
  layerSpacing: number;
  /** Generation at which camera starts transitioning to oblique view */
  cameraRevealGen: number;
  /** Duration of each layer's fade-out during collapse in seconds */
  collapseDuration: number;
  /** Stagger delay between consecutive layer collapses in seconds */
  collapseStagger: number;
  /** Pause duration after collapse before loop restart in seconds */
  holdAfterComplete: number;
};

/** Represents the state of one layer (one generation snapshot) */
export type LayerState = {
  /** Generation index: 0 = original, 1..maxGenerations = shuffled */
  gen: number;
  /** Z position: gen * layerSpacing */
  z: number;
  /** Whether this layer should be rendered */
  alive: boolean;
  /** Current opacity for fade animation (0..1) */
  opacity: number;
  /** Mapping from slot index to segment ID (length = segmentCount) */
  slotToSegId: number[];
  /** Which slots changed compared to the previous layer (length = segmentCount) */
  changedSlots: boolean[];
  /** Connection line data linking changed slots to their previous values */
  linksFromPrev: Array<{
    /** Which slot changed */
    slotIndex: number;
    /** Segment ID shown in the previous layer */
    prevSegId: number;
    /** Segment ID shown in this layer */
    currSegId: number;
  }>;
};

/** Overall phase of the layered shuffle system */
export type SystemPhase =
  | "shuffling"   // actively shuffling current generation
  | "frozen"      // generation complete, waiting before next
  | "collapsing"  // layers fading out top-down
  | "holding";    // pause after collapse, before loop restart

/** Default configuration values */
export const DEFAULT_CONFIG: ShuffleConfig = {
  maxGenerations: 10,
  shuffleDuration: 2.0,
  switchIntervalMin: 0.2,
  switchIntervalMax: 0.5,
  fadeDuration: 0.6,
  layerSpacing: 0.5,
  cameraRevealGen: 5,
  collapseDuration: 0.5,
  collapseStagger: 0.3,
  holdAfterComplete: 1.0,
};
