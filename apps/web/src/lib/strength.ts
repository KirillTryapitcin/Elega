import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';

// Same dictionary and threshold as the API (apps/api/src/modules/auth/passwords.ts).
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary },
  graphs: common.adjacencyGraphs,
});

export async function strength(password: string, inputs: string[]): Promise<number> {
  const result = await zxcvbn.checkAsync(password, inputs.filter(Boolean));
  return result.score;
}
