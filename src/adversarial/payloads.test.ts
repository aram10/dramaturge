import { describe, expect, it } from 'vitest';
import { listAdversarialPayloadFamilies } from './payloads.js';

describe('listAdversarialPayloadFamilies', () => {
  it('returns low-risk boundary and formatting payloads in safe mode', () => {
    const families = listAdversarialPayloadFamilies({ safeMode: true });

    expect(families.map((family) => family.id)).toContain('boundary-text');
    expect(families.map((family) => family.id)).toContain('format-edge-cases');
    expect(families.map((family) => family.id)).not.toContain('injection-probes');
  });

  it('includes stronger injection-style payloads when safe mode is disabled', () => {
    const families = listAdversarialPayloadFamilies({ safeMode: false });

    expect(families.map((family) => family.id)).toContain('injection-probes');
    expect(families.find((family) => family.id === 'injection-probes')?.values).toContain(
      '<script>alert(1)</script>'
    );
  });
});
