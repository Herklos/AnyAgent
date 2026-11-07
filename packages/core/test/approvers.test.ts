import { describe, expect, it } from "vitest";
import { resolveApprovers } from "../src/approvers.js";

describe("T-V1-WP3-01 resolveApprovers (spike 011)", () => {
  it("table: person, owner fallback, agent refused, left member, unknown, empty→owners", () => {
    const cases: Array<{
      name: string;
      settingsApprovers: string;
      owners: string[];
      agentAccounts: string[];
      members?: string[];
      expectApprovers: string[];
      expectRefused?: Array<{ id: string; reason: string }>;
    }> = [
      {
        name: "person in list",
        settingsApprovers: "alice",
        owners: ["owner"],
        agentAccounts: ["bot"],
        members: ["alice", "owner", "bot"],
        expectApprovers: ["alice"],
      },
      {
        name: "empty list falls back to owners",
        settingsApprovers: "",
        owners: ["owner-a", "owner-b"],
        agentAccounts: ["bot"],
        members: ["owner-a", "owner-b", "bot"],
        expectApprovers: ["owner-a", "owner-b"],
      },
      {
        name: "agent account refused",
        settingsApprovers: "bot,alice",
        owners: ["owner"],
        agentAccounts: ["bot"],
        members: ["bot", "alice", "owner"],
        expectApprovers: ["alice"],
        expectRefused: [{ id: "bot", reason: "agent-account" }],
      },
      {
        name: "member who left the space",
        settingsApprovers: "gone,alice",
        owners: ["owner"],
        agentAccounts: [],
        members: ["alice", "owner"],
        expectApprovers: ["alice"],
        expectRefused: [{ id: "gone", reason: "not-in-space" }],
      },
      {
        name: "id not in the space",
        settingsApprovers: "stranger",
        owners: ["owner"],
        agentAccounts: [],
        members: ["owner"],
        expectApprovers: ["owner"],
        expectRefused: [{ id: "stranger", reason: "not-in-space" }],
      },
      {
        name: "owner who is also an agent refused in fallback",
        settingsApprovers: "",
        owners: ["bot-owner"],
        agentAccounts: ["bot-owner"],
        members: ["bot-owner"],
        expectApprovers: [],
        expectRefused: [{ id: "bot-owner", reason: "agent-account" }],
      },
    ];

    for (const c of cases) {
      const r = resolveApprovers({
        settingsApprovers: c.settingsApprovers,
        owners: c.owners,
        agentAccounts: c.agentAccounts,
        ...(c.members ? { members: c.members } : {}),
      });
      expect(r.approvers, c.name).toEqual(c.expectApprovers);
      if (c.expectRefused) {
        for (const refused of c.expectRefused) {
          expect(
            r.refused.some((x) => x.id === refused.id && x.reason === refused.reason),
            `${c.name}: missing refuse ${refused.id}`,
          ).toBe(true);
        }
      }
    }
  });
});
