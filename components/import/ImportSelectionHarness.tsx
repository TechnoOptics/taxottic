"use client";

import { ImportSelection } from "./ImportSelection";

/**
 * Test-only wrapper for ImportSelection.
 *
 * Nothing in the app imports this. It exists because Playwright component
 * tests serialize props across the browser boundary and a Map does not
 * survive that trip (it arrives as a plain object and `catById.get` is not a
 * function). Rather than reshape the production prop to suit the test, the
 * harness takes the same data as entries and rebuilds the Map on the browser
 * side, so the component under test is exercised with exactly the props the
 * review page passes it.
 */

type Props = Omit<React.ComponentProps<typeof ImportSelection>, "catById"> & {
  catEntries: [string, React.ComponentProps<typeof ImportSelection> extends {
    catById: Map<string, infer V>;
  }
    ? V
    : never][];
};

export function ImportSelectionHarness({ catEntries, ...rest }: Props) {
  return <ImportSelection {...rest} catById={new Map(catEntries)} />;
}
