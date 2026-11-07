/**
 * Temporal wiring for AgentCore. Deterministic: no Date, Math.random, I/O, or Node imports.
 */
import {
  ApplicationFailure,
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  defineUpdate,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import { AdmissionQueue } from "./admission.js";
import type {
  Admission,
  AgentCore,
  ChatInput,
  CoreStatus,
  RotationHint,
  TurnHandler,
} from "./types.js";
import { CHAT_UPDATE, CLOSE_SIGNAL, ROTATION_QUERY, STATUS_QUERY } from "./types.js";

export const chatUpdate = defineUpdate<Admission, [ChatInput]>(CHAT_UPDATE);
export const closeSignal = defineSignal(CLOSE_SIGNAL);
export const statusQuery = defineQuery<CoreStatus>(STATUS_QUERY);
export const rotationQuery = defineQuery<RotationHint>(ROTATION_QUERY);

function validateChatInput(input: unknown): asserts input is ChatInput {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof (input as ChatInput).key !== "string" ||
    typeof (input as ChatInput).text !== "string" ||
    !(input as ChatInput).key
  ) {
    throw ApplicationFailure.nonRetryable("BadInput", "BadInput");
  }
}

export function createOwnCore(opts?: { rotateAfterAccepted?: number }): AgentCore {
  const queue = new AdmissionQueue(opts);

  return {
    async run(handler: TurnHandler): Promise<void> {
      setHandler(
        chatUpdate,
        (input) => {
          validateChatInput(input);
          return queue.admit(input);
        },
        {
          validator: (input) => {
            if (queue.isClosing) {
              throw ApplicationFailure.nonRetryable("AgentClosed", "AgentClosed");
            }
            validateChatInput(input);
          },
        },
      );
      setHandler(closeSignal, () => {
        queue.requestClose();
      });
      setHandler(statusQuery, () => {
        queue.setHistoryLength(workflowInfo().historyLength);
        queue.setContinueAsNewSuggested(workflowInfo().continueAsNewSuggested);
        return queue.snapshot();
      });
      setHandler(rotationQuery, () => {
        queue.setHistoryLength(workflowInfo().historyLength);
        queue.setContinueAsNewSuggested(workflowInfo().continueAsNewSuggested);
        return queue.rotation();
      });

      for (;;) {
        await condition(() => queue.hasWork || queue.isClosing);
        while (true) {
          const item = queue.next();
          if (!item) break;
          queue.begin(item.input);
          try {
            await handler(item.input, { turnNumber: item.turnNumber });
            queue.finish(true);
          } catch {
            queue.finish(false);
          }
        }
        if (queue.isClosing && !queue.hasWork) {
          await condition(allHandlersFinished);
          return;
        }
      }
    },
  };
}
