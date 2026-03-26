export interface StepActivity {
  findings: number;
  newControls: number;
  edges: number;
}

export class StagnationTracker {
  private consecutiveIdle = 0;

  constructor(private readonly threshold: number) {}

  recordStep(activity: StepActivity): void {
    const productive =
      activity.findings > 0 ||
      activity.newControls > 0 ||
      activity.edges > 0;

    if (productive) {
      this.consecutiveIdle = 0;
    } else {
      this.consecutiveIdle++;
    }
  }

  isStagnant(): boolean {
    return this.consecutiveIdle >= this.threshold;
  }

  get idleSteps(): number {
    return this.consecutiveIdle;
  }
}
