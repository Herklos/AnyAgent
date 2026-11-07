import type { Admission, ChatInput } from "@anyagent/workflows";
import type { DeliveryClient, DeliveryTarget } from "../../src/delivery.js";

export class FakeDeliveryClient implements DeliveryClient {
  readonly delivered: Array<{ target: DeliveryTarget; input: ChatInput }> = [];
  failNext = 0;
  failWith: Error | undefined;
  /** When set, throw after N successful deliveries (for mid-batch). */
  failAfter = Infinity;
  acceptCalls = 0;

  async deliverChat(target: DeliveryTarget, input: ChatInput): Promise<Admission> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw this.failWith ?? new Error("delivery failed");
    }
    if (this.acceptCalls >= this.failAfter) {
      throw this.failWith ?? new Error("delivery failed mid-batch");
    }
    this.acceptCalls += 1;
    this.delivered.push({ target, input });
    return { disposition: "queued", turnNumber: this.acceptCalls };
  }
}

/** Accepts then leaves commit to the caller — used for crash-between tests. */
export class AcceptOnlyClient implements DeliveryClient {
  readonly accepted: ChatInput[] = [];
  async deliverChat(_target: DeliveryTarget, input: ChatInput): Promise<Admission> {
    this.accepted.push(input);
    return { disposition: "opened", turnNumber: this.accepted.length };
  }
}
