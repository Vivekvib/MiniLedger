/** Access to the mocked Expo Router defined in tests/setup.ts. */

export interface MockRouter {
  push: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
}

export const getRouter = (): MockRouter => jest.requireMock('expo-router').__router;

/** Replaces the route params that useLocalSearchParams() returns. */
export function setParams(params: Record<string, string | undefined>): void {
  const live = jest.requireMock('expo-router').__params as Record<string, string | undefined>;
  for (const key of Object.keys(live)) delete live[key];
  Object.assign(live, params);
}
