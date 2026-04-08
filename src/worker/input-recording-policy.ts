export type InputRecordingPolicy = 'safe' | 'secret';

const INPUT_RECORDING_POLICY = Symbol('dramaturge.input-recording-policy');

type InputRecordingPolicyHost = {
  [INPUT_RECORDING_POLICY]?: Map<string, InputRecordingPolicy>;
};

function getPolicyStore(
  target: object | undefined,
  create: boolean
): Map<string, InputRecordingPolicy> | undefined {
  if (!target) {
    return undefined;
  }

  const host = target as InputRecordingPolicyHost;
  if (!host[INPUT_RECORDING_POLICY] && create) {
    Object.defineProperty(host, INPUT_RECORDING_POLICY, {
      value: new Map<string, InputRecordingPolicy>(),
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return host[INPUT_RECORDING_POLICY];
}

export function setInputRecordingPolicy(
  target: object | undefined,
  selector: string,
  policy: InputRecordingPolicy
): void {
  const key = selector?.trim();
  if (!key) {
    return;
  }

  getPolicyStore(target, true)?.set(key, policy);
}

export function getInputRecordingPolicy(
  target: object | undefined,
  selector: string
): InputRecordingPolicy | undefined {
  const key = selector?.trim();
  if (!key) {
    return undefined;
  }

  return getPolicyStore(target, false)?.get(key);
}
