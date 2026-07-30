import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import {
  limaNetworkArguments,
  limaPortForwardExpression,
} from "../../src/lib/vm-network";

const rulesFromExpression = (expression: string): readonly unknown[] =>
  JSON.parse(expression.slice(".portForwards = ".length));

describe("vm network", () => {
  it("removes directly routable networks", () => {
    expect(limaNetworkArguments([])[0]).toBe("--set=.networks = []");
  });

  it("denies every application port by default", () => {
    expect(rulesFromExpression(limaPortForwardExpression([]))).toEqual([
      {
        guestIP: "0.0.0.0",
        guestIPMustBeZero: false,
        guestPortRange: [1, 65_535],
        ignore: true,
        proto: "any",
      },
    ]);
  });

  it("places explicit localhost TCP mappings before the deny rule", () => {
    expect(
      rulesFromExpression(
        limaPortForwardExpression([
          { guestPort: 3000, hostPort: 8080 },
          { guestPort: 3001, hostPort: 8081 },
        ])
      )
    ).toEqual([
      {
        guestIP: "127.0.0.1",
        guestPort: 3000,
        hostIP: "127.0.0.1",
        hostPort: 8080,
        proto: "tcp",
        static: true,
      },
      {
        guestIP: "127.0.0.1",
        guestPort: 3001,
        hostIP: "127.0.0.1",
        hostPort: 8081,
        proto: "tcp",
        static: true,
      },
      {
        guestIP: "0.0.0.0",
        guestIPMustBeZero: false,
        guestPortRange: [1, 65_535],
        ignore: true,
        proto: "any",
      },
    ]);
  });
});
